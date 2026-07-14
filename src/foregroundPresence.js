import { buildForegroundActivity } from "./foregroundRules.js";
import { enhanceForegroundActivityWithBrowser } from "./browserInspector.js";
import { assertUsableConfig, loadConfig } from "./config.js";
import { DiscordIpc } from "./discordIpc.js";
import { createLogger } from "./logger.js";
import { readForegroundWindow } from "./windowProvider.js";

const { config, configPath } = await loadConfig();
assertUsableConfig(config, configPath);

if (config.foregroundClientId) {
  config.discordClientId = String(config.foregroundClientId).trim();
}

const logger = createLogger(config.logLevel);
let ipc = null;
let lastSentActivityJson = "";
let nextDiscordConnectAt = 0;
let stopping = false;

logger.info("Foreground activity presence starting.");
logger.info("Privacy mode: whitelist rules only unless foregroundShowUnknownApps is true.");

if (!config.foregroundEnabled) {
  logger.info("Foreground presence is disabled in config.json.");
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
      logger.warn(`Foreground tick failed: ${error.message}`);
    }

    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(250, config.foregroundPollIntervalMs - elapsed));
  }
}

async function tick() {
  const windowInfo = await readForegroundWindow();
  const activity = await enhanceForegroundActivityWithBrowser(
    buildForegroundActivity(windowInfo, config),
    windowInfo,
    config,
    logger
  );
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
    logger.info(`Shared foreground activity: ${activity.details}`);
  } else {
    await discord.clearActivity();
    logger.info("Cleared foreground activity.");
  }

  lastSentActivityJson = activityJson;
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
  logger.info(`Stopping foreground presence after ${signal}.`);

  try {
    if (ipc?.connected) {
      await ipc.clearActivity();
    }
  } catch (error) {
    logger.warn(`Could not clear foreground activity on shutdown: ${error.message}`);
  } finally {
    ipc?.destroy();
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
