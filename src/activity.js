const DISCORD_TEXT_LIMIT = 128;

export function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

export function truncateDiscordText(value, limit = DISCORD_TEXT_LIMIT) {
  const text = normalizeText(value);
  if (text.length <= limit) {
    return text;
  }

  return text.slice(0, Math.max(0, limit - 3)).trimEnd() + "...";
}

export function isAppleMusicSession(session, patterns = []) {
  const haystack = [
    session?.sourceAppUserModelId,
    session?.sourceAppDisplayName,
    session?.appName
  ]
    .map(normalizeText)
    .join(" ")
    .toLowerCase();

  return patterns.some((pattern) => haystack.includes(normalizeText(pattern).toLowerCase()));
}

export function hasUsableMetadata(session) {
  return Boolean(normalizeText(session?.title) || normalizeText(session?.artist));
}

export function isPlaying(session) {
  return normalizeText(session?.playbackStatus).toLowerCase() === "playing";
}

export function isPaused(session) {
  return normalizeText(session?.playbackStatus).toLowerCase() === "paused";
}

export function selectSession(sessions, config) {
  const candidates = (Array.isArray(sessions) ? sessions : []).filter(hasUsableMetadata);
  const appleMusicSessions = candidates.filter((session) =>
    isAppleMusicSession(session, config.playerPatterns)
  );

  const pool = config.onlyAppleMusic ? appleMusicSessions : appleMusicSessions.concat(
    candidates.filter((session) => !appleMusicSessions.includes(session))
  );

  return pool.sort((left, right) => Number(isPlaying(right)) - Number(isPlaying(left)))[0] ?? null;
}

export function renderTemplate(template, values) {
  return normalizeText(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    normalizeText(values[key])
  );
}

export function buildActivity(session, config, nowMs = Date.now()) {
  if (!session || !hasUsableMetadata(session)) {
    return null;
  }

  if (!isPlaying(session) && (!config.showPaused || !isPaused(session))) {
    return null;
  }

  const values = getDisplayValues(session, config);

  const details = truncateDiscordText(renderTemplate(config.detailsTemplate ?? "{title}", values));
  let state = renderTemplate(config.stateTemplate ?? "{artist}", values);

  if (config.includeAlbumInState && values.album && !state.includes(values.album)) {
    state = state ? `${state} - ${values.album}` : values.album;
  }

  const activity = {
    name: truncateDiscordText(renderTemplate(config.activityNameTemplate ?? "{artist}", values) || values.player),
    type: Number.isInteger(config.activityType) ? config.activityType : 2,
    details,
    state: truncateDiscordText(state),
    status_display_type: Number.isInteger(config.statusDisplayType) ? config.statusDisplayType : 0,
    instance: false
  };

  const timestamps = buildTimestamps(session, nowMs);
  if (timestamps && isPlaying(session)) {
    activity.timestamps = timestamps;
  }

  const largeImageKey = getLargeImageKey(values, config, session);
  if (largeImageKey) {
    activity.assets = {
      large_image: largeImageKey,
      large_text: truncateDiscordText(
        renderTemplate(config.largeImageTextTemplate ?? "{album}", values) || values.player
      )
    };
  }

  return activity;
}

export function getLargeImageKey(values, config, session = {}) {
  const externalArtworkUrl = normalizeText(session.artworkUrl);
  if (externalArtworkUrl && config.artworkMode === "itunes") {
    return externalArtworkUrl;
  }

  const albumImageKeys = config.albumImageKeys && typeof config.albumImageKeys === "object"
    ? config.albumImageKeys
    : {};
  const lookupKeys = [
    `${values.artist} - ${values.album}`,
    values.album,
    `${values.artist} - ${values.title}`,
    values.title
  ].map(normalizeLookupKey);

  for (const [key, assetKey] of Object.entries(albumImageKeys)) {
    if (lookupKeys.includes(normalizeLookupKey(key))) {
      return normalizeText(assetKey);
    }
  }

  return normalizeText(config.largeImageKey);
}

function normalizeLookupKey(value) {
  return normalizeText(value).toLowerCase();
}

export function getDisplayValues(session, config) {
  let artist = normalizeText(session.artist || session.albumArtist);
  let album = normalizeText(session.albumTitle);

  if (!album && isAppleMusicSession(session, config.playerPatterns)) {
    const split = splitAppleMusicArtistAlbum(artist);
    if (split) {
      artist = split.artist;
      album = split.album;
    }
  }

  return {
    title: normalizeText(session.title) || "Unknown title",
    artist: artist || "Unknown artist",
    album,
    player: isAppleMusicSession(session, config.playerPatterns)
      ? "Apple Music"
      : normalizeText(session.sourceAppDisplayName || session.sourceAppUserModelId || "Music")
  };
}

export function splitAppleMusicArtistAlbum(value) {
  const text = normalizeText(value);
  const match = text.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+)$/u);

  if (!match) {
    return null;
  }

  return {
    artist: normalizeText(match[1]),
    album: normalizeText(match[2])
  };
}

export function buildTimestamps(session, nowMs = Date.now()) {
  const positionMs = Number(session?.positionMs);
  const startTimeMs = Number(session?.startTimeMs ?? 0);
  const endTimeMs = Number(session?.endTimeMs);
  const durationMs = endTimeMs - startTimeMs;

  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs < 1000) {
    return null;
  }

  if (positionMs < 0 || positionMs > durationMs + 30_000) {
    return null;
  }

  const start = Math.floor((nowMs - positionMs) / 1000);
  const end = Math.floor((nowMs + (durationMs - positionMs)) / 1000);

  if (end <= start) {
    return null;
  }

  return { start, end };
}
