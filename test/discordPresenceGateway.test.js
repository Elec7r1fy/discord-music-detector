import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscordPresenceGateway,
  GATEWAY_INTENTS,
  GATEWAY_OPCODES,
  parseSpotifyPresence,
  verifyDiscordBotToken
} from "../src/discordPresenceGateway.js";

test("verifyDiscordBotToken uses bot authentication and rejects non-bot results", async () => {
  let authorization = "";
  const verified = await verifyDiscordBotToken("secret-token", async (url, options) => {
    assert.equal(url, "https://discord.com/api/v10/users/@me");
    authorization = options.headers.authorization;
    return {
      ok: true,
      json: async () => ({ id: "123", username: "Follower", bot: true })
    };
  });

  assert.equal(authorization, "Bot secret-token");
  assert.deepEqual(verified, { id: "123", username: "Follower" });
  await assert.rejects(
    verifyDiscordBotToken("user-token", async () => ({
      ok: true,
      json: async () => ({ id: "456", username: "Person", bot: false })
    })),
    /non-bot account/
  );
});

test("parseSpotifyPresence returns canonical Spotify metadata and progress", () => {
  const track = parseSpotifyPresence(
    {
      activities: [
        { name: "Custom Status", state: "hello" },
        {
          name: "Spotify",
          type: 2,
          details: "Radio",
          state: "Future",
          sync_id: "spotify-track-id",
          timestamps: {
            start: 1_700_000_000_000,
            end: 1_700_000_180_000
          },
          assets: {
            large_text: "EVOL"
          }
        }
      ]
    },
    1_700_000_060_000
  );

  assert.deepEqual(track, {
    key: "spotify-track-id",
    title: "Radio",
    artist: "Future",
    album: "EVOL",
    durationMs: 180_000,
    positionMs: 60_000,
    capturedAt: 1_700_000_060_000,
    playing: true
  });
});

test("parseSpotifyPresence supports activities without sync IDs or timestamps", () => {
  const first = parseSpotifyPresence(
    {
      activities: [{ name: "Spotify", details: " Song ", state: " Artist ", assets: {} }]
    },
    100
  );
  const second = parseSpotifyPresence(
    {
      activities: [{ name: "spotify", details: "Song", state: "Artist" }]
    },
    200
  );

  assert.ok(first.key);
  assert.equal(first.key, second.key);
  assert.equal(first.durationMs, null);
  assert.equal(first.positionMs, null);
  assert.equal(first.playing, true);
  assert.equal(parseSpotifyPresence({ activities: [] }, 100), null);
  assert.equal(
    parseSpotifyPresence({ activities: [{ name: "Spotify", details: "Song" }] }, 100),
    null
  );
});

test("connect identifies with presence intents and resolves only on READY", async () => {
  const timers = createManualTimers();
  const gateway = new DiscordPresenceGateway({
    token: "secret-token",
    targetUserId: "42",
    WebSocketImpl: FakeWebSocket,
    timers,
    random: () => 1,
    logger: quietLogger
  });

  const connecting = gateway.connect();
  const socket = FakeWebSocket.last();
  socket.open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.HELLO,
    d: { heartbeat_interval: 45_000 }
  });

  assert.deepEqual(socket.sentPayloads[0], {
    op: GATEWAY_OPCODES.IDENTIFY,
    d: {
      token: "secret-token",
      intents: GATEWAY_INTENTS.GUILDS | GATEWAY_INTENTS.GUILD_PRESENCES,
      properties: {
        os: process.platform,
        browser: "discord-music-detector",
        device: "discord-music-detector"
      }
    }
  });
  assert.equal(gateway.connected, false);

  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "READY",
    s: 1,
    d: { session_id: "session", user: { bot: true } }
  });

  assert.equal(await connecting, gateway);
  assert.equal(gateway.connected, true);
  assert.equal(gateway.sequence, 1);
  gateway.destroy();
});

test("guild and presence dispatches request and emit only the target user's track", async () => {
  const timers = createManualTimers();
  const gateway = new DiscordPresenceGateway({
    token: "secret-token",
    targetUserId: "target",
    WebSocketImpl: FakeWebSocket,
    timers,
    logger: quietLogger
  });
  const connecting = gateway.connect();
  const socket = FakeWebSocket.last();
  socket.open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "READY",
    d: { user: { bot: true } }
  });
  await connecting;

  const tracks = [];
  gateway.on("track", (track) => tracks.push(track));

  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "GUILD_CREATE",
    d: {
      id: "guild-1",
      presences: [spotifyPresence("someone-else", "Ignored")]
    }
  });
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "GUILD_CREATE",
    d: { id: "guild-2", presences: [] }
  });

  const requests = socket.sentPayloads.filter(
    (payload) => payload.op === GATEWAY_OPCODES.REQUEST_GUILD_MEMBERS
  );
  assert.deepEqual(requests.map((request) => request.d), [
    {
      guild_id: "guild-1",
      user_ids: ["target"],
      presences: true,
      nonce: "target:guild-1"
    },
    {
      guild_id: "guild-2",
      user_ids: ["target"],
      presences: true,
      nonce: "target:guild-2"
    }
  ]);
  assert.equal(tracks.length, 0);

  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "GUILD_MEMBERS_CHUNK",
    d: { presences: [spotifyPresence("target", "From chunk")] }
  });
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "target" }, activities: [] }
  });

  assert.equal(tracks[0].title, "From chunk");
  assert.equal(tracks[0].artist, "Test Artist");
  assert.equal(tracks[1], null);
  assert.equal(gateway.currentTrack, null);

  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "target" }, status: "idle" }
  });
  assert.equal(tracks.length, 2, "partial updates without activities are ignored");
  gateway.destroy();
});

test("heartbeats carry the last sequence and a missed ACK reconnects", async () => {
  const timers = createManualTimers();
  const gateway = new DiscordPresenceGateway({
    token: "secret-token",
    targetUserId: "target",
    WebSocketImpl: FakeWebSocket,
    timers,
    random: () => 0,
    reconnectDelayMs: 0,
    logger: quietLogger
  });
  const connecting = gateway.connect();
  const firstSocket = FakeWebSocket.last();
  firstSocket.open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.HELLO,
    d: { heartbeat_interval: 100 }
  });
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "READY",
    s: 7,
    d: { user: { bot: true } }
  });
  await connecting;

  timers.runNextTimeout();
  assert.deepEqual(firstSocket.sentPayloads.at(-1), {
    op: GATEWAY_OPCODES.HEARTBEAT,
    d: 7
  });

  gateway.handleGatewayPayload({ op: GATEWAY_OPCODES.HEARTBEAT_ACK });
  timers.runIntervals();
  assert.equal(firstSocket.sentPayloads.at(-1).op, GATEWAY_OPCODES.HEARTBEAT);

  timers.runIntervals();
  timers.runNextTimeout();
  assert.notEqual(FakeWebSocket.last(), firstSocket);
  gateway.destroy();
});

test("fatal auth or intent closes reject connect and never log the token", async () => {
  const messages = [];
  const gateway = new DiscordPresenceGateway({
    token: "do-not-log-this-token",
    targetUserId: "target",
    WebSocketImpl: FakeWebSocket,
    timers: createManualTimers(),
    logger: {
      debug: (message) => messages.push(String(message)),
      warn: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message))
    }
  });
  const surfaced = [];
  gateway.on("gatewayError", (error) => surfaced.push(error));

  const connecting = gateway.connect();
  FakeWebSocket.last().serverClose(4014, "Disallowed intents");

  await assert.rejects(connecting, /4014/);
  assert.equal(surfaced.length, 1);
  assert.equal(surfaced[0].closeCode, 4014);
  assert.equal(gateway.lastError, surfaced[0]);
  assert.equal(messages.join("\n").includes("do-not-log-this-token"), false);
});

test("READY rejects a user token instead of permitting self-bot automation", async () => {
  const gateway = new DiscordPresenceGateway({
    token: "user-token-must-not-run",
    targetUserId: "target",
    WebSocketImpl: FakeWebSocket,
    timers: createManualTimers(),
    logger: quietLogger
  });
  const errors = [];
  gateway.on("gatewayError", (error) => errors.push(error));

  const connecting = gateway.connect();
  FakeWebSocket.last().open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "READY",
    d: { user: { bot: false } }
  });

  await assert.rejects(connecting, /not a bot token/);
  assert.equal(errors.length, 1);
  assert.equal(gateway.connected, false);
});

test("internal reconnects emit unavailable state and resume the Gateway session", async () => {
  const timers = createManualTimers();
  const gateway = new DiscordPresenceGateway({
    token: "secret-token",
    targetUserId: "target",
    WebSocketImpl: FakeWebSocket,
    timers,
    reconnectDelayMs: 0,
    logger: quietLogger
  });
  let disconnected = 0;
  gateway.on("disconnected", () => {
    disconnected += 1;
  });

  const connecting = gateway.connect();
  const firstSocket = FakeWebSocket.last();
  firstSocket.open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "READY",
    s: 12,
    d: {
      session_id: "resume-session",
      resume_gateway_url: "wss://resume.discord.example",
      user: { bot: true }
    }
  });
  await connecting;
  assert.equal(gateway.sessionId, "resume-session");
  assert.equal(gateway.sequence, 12);

  gateway.handleGatewayPayload({ op: GATEWAY_OPCODES.RECONNECT });
  assert.equal(gateway.sessionId, "resume-session");
  assert.equal(gateway.sequence, 12);
  assert.equal(disconnected, 1);
  timers.runNextTimeout();
  const resumedSocket = FakeWebSocket.last();
  assert.notEqual(resumedSocket, firstSocket);
  assert.equal(new URL(resumedSocket.url).hostname, "resume.discord.example");
  assert.equal(gateway.sessionId, "resume-session");
  assert.equal(gateway.sequence, 12);
  resumedSocket.open();
  assert.equal(gateway.sessionId, "resume-session");
  assert.equal(gateway.sequence, 12);
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.HELLO,
    d: { heartbeat_interval: 45000 }
  });
  assert.equal(gateway.sessionId, "resume-session");
  assert.equal(gateway.sequence, 12);

  assert.deepEqual(resumedSocket.sentPayloads[0], {
    op: GATEWAY_OPCODES.RESUME,
    d: {
      token: "secret-token",
      session_id: "resume-session",
      seq: 12
    }
  });
  gateway.destroy();
});

test("non-resumable close codes clear stale tracks and start a fresh Identify", async () => {
  const timers = createManualTimers();
  const gateway = new DiscordPresenceGateway({
    token: "secret-token",
    targetUserId: "target",
    WebSocketImpl: FakeWebSocket,
    timers,
    reconnectDelayMs: 0,
    logger: quietLogger
  });
  const connecting = gateway.connect();
  const firstSocket = FakeWebSocket.last();
  firstSocket.open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "READY",
    s: 21,
    d: {
      session_id: "expired-session",
      resume_gateway_url: "wss://resume.discord.example",
      user: { bot: true }
    }
  });
  await connecting;
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.DISPATCH,
    t: "PRESENCE_UPDATE",
    d: spotifyPresence("target", "Old Song")
  });
  assert.equal(gateway.currentTrack.title, "Old Song");

  firstSocket.serverClose(4009, "Session timed out");
  assert.equal(gateway.sessionId, "");
  assert.equal(gateway.sequence, null);
  assert.equal(gateway.currentTrack, null);
  timers.runNextTimeout();
  const freshSocket = FakeWebSocket.last();
  freshSocket.open();
  gateway.handleGatewayPayload({
    op: GATEWAY_OPCODES.HELLO,
    d: { heartbeat_interval: 45000 }
  });

  assert.equal(freshSocket.sentPayloads[0].op, GATEWAY_OPCODES.IDENTIFY);
  gateway.destroy();
});

function spotifyPresence(userId, title) {
  return {
    user: { id: userId },
    activities: [{
      name: "Spotify",
      details: title,
      state: "Test Artist",
      assets: { large_text: "Test Album" }
    }]
  };
}

const quietLogger = {
  debug() {},
  warn() {},
  error() {}
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sentPayloads = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  static last() {
    return FakeWebSocket.instances.at(-1);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  send(data) {
    assert.equal(this.readyState, FakeWebSocket.OPEN);
    this.sentPayloads.push(JSON.parse(data));
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }

  serverClose(code, reason = "") {
    this.close(code, reason);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createManualTimers() {
  const timeouts = [];
  const intervals = [];

  return {
    setTimeout(callback, delay) {
      const timer = makeTimer(callback, delay);
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
    },
    setInterval(callback, delay) {
      const timer = makeTimer(callback, delay);
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      timer.cancelled = true;
    },
    runNextTimeout() {
      const timer = timeouts.find((candidate) => !candidate.cancelled && !candidate.ran);
      assert.ok(timer, "Expected a pending timeout");
      timer.ran = true;
      timer.callback();
    },
    runIntervals() {
      for (const timer of intervals.filter((candidate) => !candidate.cancelled)) {
        timer.callback();
      }
    }
  };
}

function makeTimer(callback, delay) {
  return {
    callback,
    delay,
    cancelled: false,
    ran: false,
    unref() {}
  };
}
