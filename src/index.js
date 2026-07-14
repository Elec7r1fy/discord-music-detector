import { buildActivity, getDisplayValues, selectSession } from "./activity.js";
import { resolveArtworkUrl } from "./artworkProvider.js";
import { assertUsableConfig, loadConfig } from "./config.js";
import { DiscordIpc } from "./discordIpc.js";
import { createLogger } from "./logger.js";
import { readMediaSessions } from "./mediaProvider.js";

const { config, configPath } = await loadConfig();
assertUsableConfig(config, configPath);

const logger = createLogger(config.logLevel);
let ipc = null;
let lastSentActivityJson = "";
let nextDiscordConnectAt = 0;
let stopping = false;

logger.info("Local Apple Music Discord Presence starting.");
if (config.artworkMode === "itunes") {
  logger.warn("Automatic artwork is enabled. This sends artist/title searches to Apple and sends artwork URLs to Discord.");
} else {
  logger.info("Runtime network policy: no HTTP requests; only Discord desktop local IPC is used.");
}

if (!config.enabled) {
  logger.info("Presence is disabled in config.json. Clearing Discord activity and exiting.");
  try {
    const discord = new DiscordIpc({ clientId: config.discordClientId, logger });
    await discord.connect();
    await discord.clearActivity();
    discord.destroy();
  } catch (error) {
    logger.warn(`Could not clear disabled activity: ${error.message}`);
  }
  process.exit(0);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

await loop();

async function loop() {
  while (!stopping) {
    const startedAt = Date.now();

    try {
      await tick();
    } catch (error) {
      logger.warn(`Tick failed: ${error.message}`);
    }

    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(250, config.pollIntervalMs - elapsed));
  }
}

async function tick() {
  const sessions = await readMediaSessions();
  const selectedSession = selectSession(sessions, config);
  const session = selectedSession ? { ...selectedSession } : null;
  await attachArtwork(session);
  const activity = buildActivity(session, config);
  const activityJson = JSON.stringify(activity);

  if (activityJson === lastSentActivityJson) {
    return;
  }

  const discord = await ensureDiscord();
  if (!discord) {
    return;
  }

  if (activity) {
    await discord.setActivity(activity);
    logger.info(`Shared: ${activity.details}${activity.state ? ` / ${activity.state}` : ""}`);
  } else {
    await discord.clearActivity();
    logger.info("Cleared Discord activity.");
  }

  lastSentActivityJson = activityJson;
}

async function attachArtwork(session) {
  if (!session || config.artworkMode !== "itunes") {
    return;
  }

  const values = getDisplayValues(session, config);
  const artworkUrl = await resolveArtworkUrl(values, config, logger);
  if (artworkUrl) {
    session.artworkUrl = artworkUrl;
  }
}

async function ensureDiscord() {
  if (ipc?.connected) {
    return ipc;
  }

  if (Date.now() < nextDiscordConnectAt) {
    return null;
  }

  nextDiscordConnectAt = Date.now() + 5000;
  ipc = new DiscordIpc({ clientId: config.discordClientId, logger });

  try {
    await ipc.connect();
    lastSentActivityJson = "";
    return ipc;
  } catch (error) {
    logger.warn(`${error.message} Is Discord desktop running?`);
    return null;
  }
}

async function stop(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  logger.info(`Stopping after ${signal}.`);

  try {
    if (ipc?.connected) {
      await ipc.clearActivity();
    }
  } catch (error) {
    logger.warn(`Could not clear activity on shutdown: ${error.message}`);
  } finally {
    ipc?.destroy();
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
