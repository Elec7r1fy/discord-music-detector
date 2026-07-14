import assert from "node:assert/strict";
import test from "node:test";
import {
  assertUsableListenAlongConfig,
  normalizeListenAlongConfig,
  parseConfigJson
} from "../src/config.js";

test("parseConfigJson accepts Windows UTF-8 BOM files", () => {
  assert.deepEqual(parseConfigJson("\uFEFF{\"enabled\":true}"), { enabled: true });
});

test("normalizeListenAlongConfig keeps the feature opt-in and bounds values", () => {
  const config = normalizeListenAlongConfig({
    enabled: true,
    targetDiscordUserId: 123456789012345678n,
    destination: "unsupported",
    browserDebuggingPorts: [9222, "9222", 70000],
    syncIntervalMs: 10,
    missingGraceMs: 999999,
    driftToleranceMs: "2500"
  });

  assert.equal(config.enabled, true);
  assert.equal(config.targetDiscordUserId, "123456789012345678");
  assert.equal(config.destination, "youtubeMusic");
  assert.deepEqual(config.browserDebuggingPorts, [9222]);
  assert.equal(config.syncIntervalMs, 1000);
  assert.equal(config.missingGraceMs, 30000);
  assert.equal(config.driftToleranceMs, 2500);
  assert.equal(normalizeListenAlongConfig(null).enabled, false);
});

test("assertUsableListenAlongConfig returns the environment token without storing it", () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class TestWebSocket {};
  try {
    const result = assertUsableListenAlongConfig(
      {
        listenAlong: {
          targetDiscordUserId: "123456789012345678"
        }
      },
      "config.json",
      { DISCORD_BOT_TOKEN: "secret-token" }
    );

    assert.deepEqual(result, {
      botToken: "secret-token",
      targetUserId: "123456789012345678"
    });
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("assertUsableListenAlongConfig rejects missing IDs and secrets", () => {
  assert.throws(
    () => assertUsableListenAlongConfig({ listenAlong: {} }, "config.json", {}),
    /valid Discord user ID/
  );
  assert.throws(
    () => assertUsableListenAlongConfig(
      { listenAlong: { targetDiscordUserId: "123456789012345678" } },
      "config.json",
      {}
    ),
    /DISCORD_BOT_TOKEN/
  );
});
