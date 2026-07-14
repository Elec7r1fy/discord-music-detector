import { normalizeText } from "./activity.js";
import { fetchDebuggingTabs } from "./browserInspector.js";
import { delay, evaluateInTab, navigateTab } from "./devtoolsClient.js";

const YOUTUBE_MUSIC_ORIGIN = "https://music.youtube.com";

export class YouTubeMusicBrowserPlayer {
  constructor({
    debuggingPorts = [9222, 9223],
    driftToleranceMs = 3000,
    searchTimeoutMs = 12000,
    logger = console,
    fetchImpl = globalThis.fetch,
    now = Date.now
  } = {}) {
    this.debuggingPorts = debuggingPorts;
    this.driftToleranceMs = driftToleranceMs;
    this.searchTimeoutMs = searchTimeoutMs;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.currentSourceKey = "";
    this.currentVideoUrl = "";
    this.controlledTabId = "";
    this.controlledTabWebSocketUrl = "";
  }

  async load(track, { signal } = {}) {
    const tab = await this.findTab();
    throwIfAborted(signal);

    const searchUrl = buildYouTubeMusicSearchUrl(track);
    this.logger.info?.(`YouTube Music: searching for ${track.title} / ${track.artist}`);
    await navigateTab(tab.webSocketDebuggerUrl, searchUrl);

    const candidates = await this.waitForCandidates(tab.webSocketDebuggerUrl, searchUrl, signal);
    const candidate = chooseYouTubeMusicCandidate(candidates, track);
    if (!candidate) {
      throw new Error(`No confident YouTube Music match for ${track.title} / ${track.artist}.`);
    }

    throwIfAborted(signal);
    await navigateTab(tab.webSocketDebuggerUrl, candidate.href);
    const loadedState = await this.waitForPlayer(tab.webSocketDebuggerUrl, signal, candidate.href);
    throwIfAborted(signal);

    const positionMs = expectedTrackPositionMs(track, this.now());
    if (!loadedState.adPlaying) {
      await setPlaybackState(tab.webSocketDebuggerUrl, {
        playing: true,
        positionMs
      });
    }

    this.currentSourceKey = getTrackKey(track);
    this.currentVideoUrl = candidate.href;
    this.logger.info?.(`YouTube Music: following ${track.title} / ${track.artist}`);
    return candidate;
  }

  async sync(track) {
    if (this.currentSourceKey !== getTrackKey(track)) {
      return false;
    }

    const tab = await this.findTab();
    const state = await readPlaybackState(tab.webSocketDebuggerUrl);
    // Do not seek through or otherwise interfere with YouTube's ads. Once the
    // advertised track begins, the next sync tick will align its position.
    const expectedMs = expectedTrackPositionMs(track, this.now());
    if (!sameYouTubeMusicVideo(state?.url, this.currentVideoUrl)) {
      if (state?.adPlaying) {
        return true;
      }
      await navigateTab(tab.webSocketDebuggerUrl, this.currentVideoUrl);
      const restoredState = await this.waitForPlayer(
        tab.webSocketDebuggerUrl,
        undefined,
        this.currentVideoUrl
      );
      if (!restoredState.adPlaying) {
        await setPlaybackState(tab.webSocketDebuggerUrl, {
          playing: true,
          positionMs: expectedMs
        });
      }
      return true;
    }

    if (!state?.ready) {
      return false;
    }

    if (state.adPlaying) {
      return true;
    }

    const actualMs = state.currentTime * 1000;
    const driftMs = Math.abs(expectedMs - actualMs);
    if (state.paused || driftMs > this.driftToleranceMs) {
      await setPlaybackState(tab.webSocketDebuggerUrl, {
        playing: true,
        positionMs: driftMs > this.driftToleranceMs ? expectedMs : null
      });
    }

    return true;
  }

  async pause() {
    let tab;
    try {
      tab = await this.findTab({ allowFallback: false });
    } catch {
      this.currentSourceKey = "";
      return;
    }

    const state = await readPlaybackState(tab.webSocketDebuggerUrl);
    if (state?.ready) {
      await setPlaybackState(tab.webSocketDebuggerUrl, { playing: false });
    }
    this.currentSourceKey = "";
  }

  async findTab({ allowFallback = true } = {}) {
    const availableTabs = [];
    for (const port of this.debuggingPorts) {
      const tabs = await fetchDebuggingTabs(port, this.fetchImpl, this.logger);
      availableTabs.push(...tabs.filter(isYouTubeMusicTab));
    }

    const pinnedTab = availableTabs.find((tab) =>
      (this.controlledTabId && tab.id === this.controlledTabId)
      || (this.controlledTabWebSocketUrl && tab.webSocketDebuggerUrl === this.controlledTabWebSocketUrl)
    );
    if (pinnedTab) {
      this.rememberTab(pinnedTab);
      return pinnedTab;
    }

    if (allowFallback && availableTabs.length) {
      this.rememberTab(availableTabs[0]);
      return availableTabs[0];
    }

    throw new Error(
      "No controllable YouTube Music tab found. Start Chrome/Brave with scripts/start-browser-debugging.ps1, open music.youtube.com, and sign in."
    );
  }

  rememberTab(tab) {
    this.controlledTabId = normalizeText(tab?.id);
    this.controlledTabWebSocketUrl = normalizeText(tab?.webSocketDebuggerUrl);
  }

  async waitForCandidates(webSocketUrl, searchUrl, signal) {
    const deadline = this.now() + this.searchTimeoutMs;
    let candidates = [];
    const expectedQuery = new URL(searchUrl).searchParams.get("q") ?? "";
    const expression = buildSearchResultsExpression(expectedQuery);

    while (this.now() < deadline) {
      throwIfAborted(signal);
      try {
        candidates = await evaluateInTab(webSocketUrl, expression) ?? [];
      } catch (error) {
        this.logger.debug?.(`YouTube Music search page is still loading: ${error.message}`);
        candidates = [];
      }
      if (Array.isArray(candidates) && candidates.length) {
        return candidates;
      }
      await delay(350, signal);
    }

    return candidates;
  }

  async waitForPlayer(webSocketUrl, signal, expectedUrl = "") {
    const deadline = this.now() + this.searchTimeoutMs;
    while (this.now() < deadline) {
      throwIfAborted(signal);
      let state = null;
      try {
        state = await readPlaybackState(webSocketUrl);
      } catch (error) {
        this.logger.debug?.(`YouTube Music player is still loading: ${error.message}`);
      }
      if (state?.ready && (!expectedUrl || sameYouTubeMusicVideo(state.url, expectedUrl))) {
        return state;
      }
      await delay(300, signal);
    }

    throw new Error("YouTube Music did not load the selected track in time.");
  }
}

export function isYouTubeMusicTab(tab) {
  if (!tab?.webSocketDebuggerUrl || tab.type && tab.type !== "page") {
    return false;
  }

  try {
    return new URL(tab.url).hostname.toLowerCase() === "music.youtube.com";
  } catch {
    return false;
  }
}

export function buildYouTubeMusicSearchUrl(track) {
  const query = [normalizeText(track?.title), normalizeText(track?.artist)].filter(Boolean).join(" ");
  const url = new URL("/search", YOUTUBE_MUSIC_ORIGIN);
  url.searchParams.set("q", query);
  return url.href;
}

export function chooseYouTubeMusicCandidate(candidates, track) {
  let best = null;
  let bestScore = 0;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const score = scoreYouTubeMusicCandidate(candidate, track);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 8 ? best : null;
}

export function scoreYouTubeMusicCandidate(candidate, track) {
  if (!isSafeYouTubeMusicWatchUrl(candidate?.href)) {
    return 0;
  }

  const wantedTitle = normalizeForCatalogMatch(track?.title);
  const wantedArtist = normalizeForCatalogMatch(track?.artist);
  const wantedAlbum = normalizeForCatalogMatch(track?.album);
  const candidateTitle = normalizeForCatalogMatch(candidate?.title);
  const candidateText = normalizeForCatalogMatch(
    [candidate?.title, candidate?.byline, candidate?.text].filter(Boolean).join(" ")
  );
  let score = 0;

  if (wantedTitle && candidateTitle === wantedTitle) {
    score += 7;
  } else if (wantedTitle && candidateTitle.includes(wantedTitle)) {
    score += 5;
  } else if (wantedTitle && candidateText.includes(wantedTitle)) {
    score += 3;
  }

  if (wantedArtist && candidateText.includes(wantedArtist)) {
    score += 5;
  }

  if (wantedAlbum && candidateText.includes(wantedAlbum)) {
    score += 1;
  }

  const unwantedVersions = ["karaoke", "tribute", "cover", "instrumental"];
  for (const version of unwantedVersions) {
    if (candidateText.includes(version) && !wantedTitle.includes(version)) {
      score -= 4;
    }
  }

  return score;
}

export function expectedTrackPositionMs(track, nowMs = Date.now()) {
  const capturedAt = Number(track?.capturedAt);
  const positionMs = Number(track?.positionMs);
  let expected = Number.isFinite(positionMs) ? positionMs : 0;

  if (track?.playing !== false && Number.isFinite(capturedAt)) {
    expected += Math.max(0, nowMs - capturedAt);
  }

  const durationMs = Number(track?.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    expected = Math.min(expected, Math.max(0, durationMs - 250));
  }

  return Math.max(0, expected);
}

export function getTrackKey(track) {
  if (!track) {
    return "";
  }

  return normalizeText(track?.key)
    || [track?.title, track?.artist, track?.album].map(normalizeForCatalogMatch).join("|");
}

async function readPlaybackState(webSocketUrl) {
  return evaluateInTab(webSocketUrl, `
    (() => {
      const media = document.querySelector('video, audio');
      return {
        ready: Boolean(media && Number.isFinite(media.duration) && media.duration > 0),
        currentTime: media ? media.currentTime : 0,
        duration: media ? media.duration : 0,
        paused: media ? media.paused : true,
        adPlaying: Boolean(document.querySelector('#movie_player.ad-showing, .ad-showing')),
        url: location.href
      };
    })()
  `);
}

async function setPlaybackState(webSocketUrl, { playing, positionMs = null }) {
  const safePositionSeconds = normalizePlaybackPositionSeconds(positionMs);

  const result = await evaluateInTab(webSocketUrl, `
    (async () => {
      const media = document.querySelector('video, audio');
      if (!media) {
        return { ok: false, reason: 'No media element is available.' };
      }
      const position = ${JSON.stringify(safePositionSeconds)};
      if (Number.isFinite(position) && Math.abs(media.currentTime - position) > 0.75) {
        media.currentTime = Math.min(position, Math.max(0, (media.duration || position) - 0.25));
      }
      if (${playing ? "true" : "false"}) {
        try {
          await media.play();
        } catch (error) {
          return { ok: false, reason: error?.message || 'Autoplay was blocked.' };
        }
      } else {
        media.pause();
      }
      return { ok: true, paused: media.paused, currentTime: media.currentTime };
    })()
  `);

  if (!result?.ok) {
    throw new Error(result?.reason ?? "Could not control YouTube Music playback.");
  }
  return result;
}

function normalizeForCatalogMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\b(feat|featuring|ft)\.?\s+[^()[\]-]+/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isSafeYouTubeMusicWatchUrl(value) {
  try {
    const url = new URL(value, YOUTUBE_MUSIC_ORIGIN);
    return url.protocol === "https:"
      && url.hostname === "music.youtube.com"
      && url.pathname === "/watch"
      && Boolean(url.searchParams.get("v"));
  } catch {
    return false;
  }
}

export function sameYouTubeMusicVideo(left, right) {
  try {
    const leftUrl = new URL(left, YOUTUBE_MUSIC_ORIGIN);
    const rightUrl = new URL(right, YOUTUBE_MUSIC_ORIGIN);
    return isSafeYouTubeMusicWatchUrl(leftUrl.href)
      && isSafeYouTubeMusicWatchUrl(rightUrl.href)
      && leftUrl.searchParams.get("v") === rightUrl.searchParams.get("v");
  } catch {
    return false;
  }
}

export function normalizePlaybackPositionSeconds(positionMs) {
  if (positionMs === null || positionMs === undefined || positionMs === "") {
    return null;
  }

  const numericPosition = Number(positionMs);
  return Number.isFinite(numericPosition) ? Math.max(0, numericPosition / 1000) : null;
}

export function buildSearchResultsExpression(expectedQuery) {
  return `
    (() => {
      const currentQuery = new URLSearchParams(location.search).get('q') || '';
      if (location.hostname !== 'music.youtube.com' || location.pathname !== '/search') return [];
      if (currentQuery !== ${JSON.stringify(normalizeText(expectedQuery))}) return [];
      return Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer')).map((row, index) => {
        const links = Array.from(row.querySelectorAll('a[href*="watch?v="]'));
        const link = links.find((item) => item.closest('.title, [class*="title"]')) || links[0];
        if (!link) return null;
        const titleNode = row.querySelector('.title, yt-formatted-string.title, [class*="title"]');
        const bylineNode = row.querySelector('.secondary-flex-columns, .byline, [class*="secondary"]');
        return {
          href: new URL(link.getAttribute('href'), location.origin).href,
          title: (titleNode?.textContent || link.textContent || '').trim(),
          byline: (bylineNode?.textContent || '').trim(),
          text: (row.innerText || '').trim(),
          index
        };
      }).filter(Boolean);
    })()
  `;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Operation was cancelled.");
  }
}
