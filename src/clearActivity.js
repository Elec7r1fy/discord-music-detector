import { assertUsableConfig, loadConfig } from "./config.js";
import { DiscordIpc } from "./discordIpc.js";
import { createLogger } from "./logger.js";

const { config, configPath } = await loadConfig();
assertUsableConfig(config, configPath);

const logger = createLogger(config.logLevel);
const ipc = new DiscordIpc({ clientId: config.discordClientId, logger });

try {
  await ipc.connect();
  await ipc.clearActivity();
  logger.info("Cleared Discord activity for this application.");
} finally {
  ipc.destroy();
}
