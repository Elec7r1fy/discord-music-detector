import { assertUsableConfig, loadConfig } from "./config.js";
import { DiscordIpc } from "./discordIpc.js";
import { createLogger } from "./logger.js";

const { config, configPath } = await loadConfig();
assertUsableConfig(config, configPath);

const clientId = String(config.foregroundClientId || config.discordClientId).trim();
const logger = createLogger(config.logLevel);
const ipc = new DiscordIpc({ clientId, logger });

try {
  await ipc.connect();
  await ipc.clearActivity();
  logger.info("Cleared foreground Discord activity.");
} finally {
  ipc.destroy();
}
