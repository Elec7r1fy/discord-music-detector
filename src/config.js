import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_CONFIG = {
  discordClientId: "",
  enabled: true,
  pollIntervalMs: 2000,
  onlyAppleMusic: true,
  playerPatterns: ["Apple Music", "AppleMusic", "AppleInc.AppleMusic", "AppleInc.iTunes"],
  showPaused: false,
  activityType: 2,
  activityNameTemplate: "{player}",
  statusDisplayType: 1,
  includeAlbumInState: false,
  artworkMode: "off",
  artworkCountry: "US",
  artworkSize: 600,
  artworkCacheTtlMs: 86_400_000,
  artworkSearchLimit: 5,
  foregroundClientId: "",
  foregroundEnabled: false,
  foregroundPollIntervalMs: 1500,
  foregroundPrimaryMonitorOnly: true,
  foregroundShowUnknownApps: false,
  foregroundBrowserInspectorEnabled: true,
  foregroundBrowserDebuggingPorts: [9222, 9223],
  foregroundYouTubeButtons: true,
  foregroundYouTubeTimestamps: true,
  listenAlong: {
    enabled: false,
    targetDiscordUserId: "",
    destination: "youtubeMusic",
    browserDebuggingPorts: [9222, 9223],
    syncIntervalMs: 2000,
    missingGraceMs: 5000,
    driftToleranceMs: 3000,
    minimumRemainingMs: 5000,
    searchTimeoutMs: 12000
  },
  foregroundRules: [
    {
      processNames: ["codex"],
      name: "Codex",
      type: 0,
      details: "Talking to Codex",
      statusDisplayType: 2,
      largeImage: "https://www.google.com/s2/favicons?domain=openai.com&sz=256",
      largeText: "Codex"
    },
    {
      processNames: ["chrome", "msedge", "brave", "firefox"],
      titleIncludes: ["youtube"],
      name: "YouTube",
      type: 3,
      details: "Watching YouTube",
      stateTemplate: "{youtubeTitle}",
      statusDisplayType: 2,
      largeImage: "https://www.google.com/s2/favicons?domain=youtube.com&sz=256",
      largeText: "YouTube"
    },
    {
      processNames: ["chrome", "msedge", "brave", "firefox"],
      titleIncludes: ["amazon.in", "amazon"],
      name: "Amazon.in",
      type: 0,
      details: "Browsing Amazon.in",
      stateTemplate: "{amazonTitle}",
      statusDisplayType: 2,
      largeImage: "https://www.google.com/s2/favicons?domain=amazon.in&sz=256",
      largeText: "Amazon.in"
    },
    {
      processNames: ["brave"],
      name: "Brave",
      type: 0,
      details: "Browsing Brave",
      statusDisplayType: 2,
      largeImage: "https://www.google.com/s2/favicons?domain=brave.com&sz=256",
      largeText: "Brave"
    },
    {
      processNames: ["steam", "steamwebhelper"],
      name: "Steam",
      type: 0,
      details: "{steamActivity}",
      stateTemplate: "{steamTitle}",
      statusDisplayType: 2,
      largeImage: "https://www.google.com/s2/favicons?domain=store.steampowered.com&sz=256",
      largeText: "Steam"
    }
  ],
  detailsTemplate: "{title}",
  stateTemplate: "{artist}",
  largeImageKey: "",
  albumImageKeys: {},
  largeImageTextTemplate: "{album}",
  logLevel: "info"
};

export async function loadConfig() {
  const configPath = path.join(rootDir, "config.json");
  let fileConfig = {};

  try {
    const raw = await fs.readFile(configPath, "utf8");
    fileConfig = parseConfigJson(raw);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Could not read ${configPath}: ${error.message}`);
    }
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    listenAlong: normalizeListenAlongConfig(fileConfig.listenAlong)
  };

  if (process.env.DISCORD_CLIENT_ID) {
    config.discordClientId = process.env.DISCORD_CLIENT_ID;
  }

  config.enabled = config.enabled !== false;
  config.pollIntervalMs = Math.max(1000, Number(config.pollIntervalMs) || DEFAULT_CONFIG.pollIntervalMs);
  config.playerPatterns = Array.isArray(config.playerPatterns)
    ? config.playerPatterns.filter(Boolean)
    : DEFAULT_CONFIG.playerPatterns;
  config.albumImageKeys = isPlainObject(config.albumImageKeys) ? config.albumImageKeys : {};
  config.artworkMode = normalizeArtworkMode(config.artworkMode);
  config.artworkCountry = normalizeCountry(config.artworkCountry);
  config.artworkSize = normalizeArtworkSize(config.artworkSize);
  config.artworkCacheTtlMs = Math.max(60_000, Number(config.artworkCacheTtlMs) || DEFAULT_CONFIG.artworkCacheTtlMs);
  config.artworkSearchLimit = Math.min(25, Math.max(1, Number(config.artworkSearchLimit) || DEFAULT_CONFIG.artworkSearchLimit));
  config.foregroundEnabled = config.foregroundEnabled !== false;
  config.foregroundPollIntervalMs = Math.max(750, Number(config.foregroundPollIntervalMs) || DEFAULT_CONFIG.foregroundPollIntervalMs);
  config.foregroundPrimaryMonitorOnly = config.foregroundPrimaryMonitorOnly !== false;
  config.foregroundShowUnknownApps = config.foregroundShowUnknownApps === true;
  config.foregroundBrowserInspectorEnabled = config.foregroundBrowserInspectorEnabled !== false;
  config.foregroundBrowserDebuggingPorts = normalizePortList(config.foregroundBrowserDebuggingPorts);
  config.foregroundYouTubeButtons = config.foregroundYouTubeButtons !== false;
  config.foregroundYouTubeTimestamps = config.foregroundYouTubeTimestamps !== false;
  config.foregroundRules = Array.isArray(config.foregroundRules) ? config.foregroundRules : DEFAULT_CONFIG.foregroundRules;
  config.activityType = Number(config.activityType);
  config.statusDisplayType = Number(config.statusDisplayType);

  if (!Number.isInteger(config.activityType)) {
    config.activityType = DEFAULT_CONFIG.activityType;
  }

  if (!Number.isInteger(config.statusDisplayType) || config.statusDisplayType < 0 || config.statusDisplayType > 2) {
    config.statusDisplayType = DEFAULT_CONFIG.statusDisplayType;
  }

  return { config, configPath };
}

export function parseConfigJson(raw) {
  return JSON.parse(String(raw).replace(/^\uFEFF/u, ""));
}

export function normalizeListenAlongConfig(value) {
  const input = isPlainObject(value) ? value : {};
  const defaults = DEFAULT_CONFIG.listenAlong;
  const destination = String(input.destination ?? defaults.destination).trim();

  return {
    enabled: input.enabled === true,
    targetDiscordUserId: String(input.targetDiscordUserId ?? "").trim(),
    destination: destination === "youtubeMusic" ? destination : defaults.destination,
    browserDebuggingPorts: normalizePortList(
      input.browserDebuggingPorts ?? defaults.browserDebuggingPorts
    ),
    syncIntervalMs: clampNumber(input.syncIntervalMs, defaults.syncIntervalMs, 1000, 30000),
    missingGraceMs: clampNumber(input.missingGraceMs, defaults.missingGraceMs, 1000, 30000),
    driftToleranceMs: clampNumber(input.driftToleranceMs, defaults.driftToleranceMs, 1000, 15000),
    minimumRemainingMs: clampNumber(
      input.minimumRemainingMs,
      defaults.minimumRemainingMs,
      0,
      30000
    ),
    searchTimeoutMs: clampNumber(input.searchTimeoutMs, defaults.searchTimeoutMs, 3000, 30000)
  };
}

export function assertUsableListenAlongConfig(config, configPath, env = process.env) {
  const listenAlong = config?.listenAlong ?? {};
  const targetUserId = String(listenAlong.targetDiscordUserId ?? "").trim();
  if (!/^\d{15,22}$/.test(targetUserId)) {
    throw new Error(
      `Listen-along needs a valid Discord user ID in listenAlong.targetDiscordUserId in ${configPath}.`
    );
  }

  const botToken = String(env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!botToken) {
    throw new Error("Listen-along needs DISCORD_BOT_TOKEN in the process environment. Do not put the bot token in config.json.");
  }

  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("Listen-along requires Node.js 22 or newer for built-in WebSocket support.");
  }

  return { botToken, targetUserId };
}

export function assertUsableConfig(config, configPath) {
  const clientId = String(config.discordClientId ?? "").trim();
  if (!clientId || clientId.includes("PUT_YOUR")) {
    throw new Error(
      `Discord client ID is missing. Copy config.example.json to config.json and set "discordClientId" in ${configPath}, or set DISCORD_CLIENT_ID.`
    );
  }

  config.discordClientId = clientId;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeArtworkMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  return mode === "itunes" ? "itunes" : "off";
}

function normalizeCountry(value) {
  const country = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : DEFAULT_CONFIG.artworkCountry;
}

function normalizeArtworkSize(value) {
  const size = Number(value) || DEFAULT_CONFIG.artworkSize;
  return Math.min(3000, Math.max(100, Math.round(size)));
}

function normalizePortList(value) {
  const ports = Array.isArray(value) ? value : DEFAULT_CONFIG.foregroundBrowserDebuggingPorts;
  const normalized = ports
    .map((port) => Number(port))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);

  return normalized.length ? [...new Set(normalized)] : DEFAULT_CONFIG.foregroundBrowserDebuggingPorts;
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(normalized)));
}
