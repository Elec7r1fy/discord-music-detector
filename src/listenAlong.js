import {
  assertUsableListenAlongConfig,
  loadConfig
} from "./config.js";
import {
  DiscordPresenceGateway,
  verifyDiscordBotToken
} from "./discordPresenceGateway.js";
import { ListenAlongSynchronizer } from "./listenAlongSynchronizer.js";
import { createLogger } from "./logger.js";
import { YouTubeMusicBrowserPlayer } from "./youtubeMusicPlayer.js";

const { config, configPath } = await loadConfig();
const logger = createLogger(config.logLevel);
const listenAlong = config.listenAlong;

if (!listenAlong.enabled) {
  logger.info("Listen-along is disabled in config.json. Nothing was changed.");
  process.exit(0);
}

let credentials;
try {
  credentials = assertUsableListenAlongConfig(config, configPath);
} catch (error) {
  logger.error(error.message);
  process.exit(1);
}

const player = new YouTubeMusicBrowserPlayer({
  debuggingPorts: listenAlong.browserDebuggingPorts,
  driftToleranceMs: listenAlong.driftToleranceMs,
  searchTimeoutMs: listenAlong.searchTimeoutMs,
  logger
});
const synchronizer = new ListenAlongSynchronizer({
  player,
  missingGraceMs: listenAlong.missingGraceMs,
  minimumRemainingMs: listenAlong.minimumRemainingMs,
  logger
});
const gateway = new DiscordPresenceGateway({
  token: credentials.botToken,
  targetUserId: credentials.targetUserId,
  logger
});

let stopping = false;
let syncTimer = null;

gateway.on("track", (track) => {
  if (track) {
    logger.info(`Discord source: ${track.title} / ${track.artist}`);
  } else {
    logger.info("Discord source: Spotify activity is no longer visible.");
  }
  void synchronizer.handleTrack(track);
});

gateway.on("disconnected", () => {
  logger.warn("Discord Gateway disconnected; reconnecting automatically.");
  synchronizer.handleTrack(null);
});

gateway.on("gatewayError", (error) => {
  logger.error(error.message);
  void shutdown("Discord Gateway error", 1);
});

process.on("SIGINT", () => void shutdown("SIGINT", 0));
process.on("SIGTERM", () => void shutdown("SIGTERM", 0));

logger.info("YouTube Music listen-along starting.");
logger.info(`Following Discord user ${credentials.targetUserId}.`);
logger.info("Bot credentials are read from DISCORD_BOT_TOKEN and are never written to config.");

try {
  const bot = await verifyDiscordBotToken(credentials.botToken);
  logger.info(`Verified Discord bot ${bot.username || bot.id}.`);
  await player.findTab();
  logger.info("Found a controllable YouTube Music tab.");
  await gateway.connect();
  logger.info("Connected to Discord. Waiting for the target user's Spotify activity.");

  syncTimer = setInterval(() => {
    void synchronizer.tick().catch((error) => {
      logger.warn(`Listen-along timer failed: ${error.message}`);
    });
  }, listenAlong.syncIntervalMs);
} catch (error) {
  if (!stopping) {
    logger.error(`Could not start listen-along: ${error.message}`);
    await shutdown("startup failure", 1);
  }
}

async function shutdown(reason, exitCode) {
  if (stopping) {
    return;
  }

  stopping = true;
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  gateway.disconnect();
  try {
    await synchronizer.stop();
  } catch (error) {
    logger.warn(`Could not pause YouTube Music during shutdown: ${error.message}`);
  }

  logger.info(`Listen-along stopped after ${reason}.`);
  process.exit(exitCode);
}
