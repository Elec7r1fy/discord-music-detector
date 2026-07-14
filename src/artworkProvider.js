import { normalizeText } from "./activity.js";

const cache = new Map();

export async function resolveArtworkUrl(values, config, logger = console, fetchImpl = globalThis.fetch) {
  if (config.artworkMode !== "itunes") {
    return "";
  }

  if (typeof fetchImpl !== "function") {
    logger.warn?.("Artwork mode is enabled, but this Node runtime does not provide fetch().");
    return "";
  }

  const artist = normalizeText(values.artist);
  const title = normalizeText(values.title);
  if (!artist || !title) {
    return "";
  }

  const cacheKey = normalizeCacheKey([config.artworkCountry, artist, title, values.album, config.artworkSize]);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < config.artworkCacheTtlMs) {
    return cached.url;
  }

  try {
    const url = buildSearchUrl(values, config);
    const response = await fetchImpl(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "local-apple-music-discord-presence/0.1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Apple artwork search returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = chooseBestResult(Array.isArray(data.results) ? data.results : [], values);
    const artworkUrl = upscaleArtworkUrl(result?.artworkUrl100, config.artworkSize);

    cache.set(cacheKey, {
      createdAt: Date.now(),
      url: artworkUrl
    });

    return artworkUrl;
  } catch (error) {
    logger.warn?.(`Could not resolve automatic artwork: ${error.message}`);
    cache.set(cacheKey, {
      createdAt: Date.now(),
      url: ""
    });
    return "";
  }
}

export function buildSearchUrl(values, config) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", [values.artist, values.title].filter(Boolean).join(" "));
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("country", config.artworkCountry);
  url.searchParams.set("limit", String(config.artworkSearchLimit));
  return url;
}

export function chooseBestResult(results, values) {
  let best = null;
  let bestScore = 0;

  for (const result of results) {
    const score = scoreResult(result, values);
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return bestScore >= 5 ? best : null;
}

export function scoreResult(result, values) {
  const wantedTitle = normalizeForMatch(values.title);
  const wantedArtist = normalizeForMatch(values.artist);
  const wantedAlbum = normalizeForMatch(values.album);
  const resultTitle = normalizeForMatch(result?.trackName);
  const resultArtist = normalizeForMatch(result?.artistName);
  const resultAlbum = normalizeForMatch(result?.collectionName);
  let score = 0;

  if (wantedTitle && resultTitle === wantedTitle) {
    score += 5;
  } else if (wantedTitle && resultTitle.includes(wantedTitle)) {
    score += 3;
  }

  if (wantedArtist && resultArtist === wantedArtist) {
    score += 5;
  } else if (wantedArtist && resultArtist.includes(wantedArtist)) {
    score += 3;
  }

  if (wantedAlbum && resultAlbum === wantedAlbum) {
    score += 2;
  }

  return score;
}

export function upscaleArtworkUrl(url, size) {
  const text = normalizeText(url);
  if (!text) {
    return "";
  }

  const safeSize = Math.min(3000, Math.max(100, Math.round(Number(size) || 600)));
  return text.replace(/\/\d+x\d+bb\.(jpg|jpeg|png|webp)$/i, `/${safeSize}x${safeSize}bb.$1`);
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCacheKey(values) {
  return values.map((value) => normalizeText(value).toLowerCase()).join("|");
}
