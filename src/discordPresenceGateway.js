import { EventEmitter } from "node:events";

export const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

export const GATEWAY_OPCODES = Object.freeze({
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11
});

export const GATEWAY_INTENTS = Object.freeze({
  GUILDS: 1 << 0,
  GUILD_PRESENCES: 1 << 8
});

const REQUIRED_INTENTS = GATEWAY_INTENTS.GUILDS | GATEWAY_INTENTS.GUILD_PRESENCES;
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const NON_RESUMABLE_CLOSE_CODES = new Set([4007, 4009]);

export async function verifyDiscordBotToken(token, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Bot-token verification requires a runtime with fetch support.");
  }

  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new Error("A Discord bot token is required.");
  }

  let response;
  try {
    response = await fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: {
        authorization: `Bot ${normalizedToken}`,
        accept: "application/json",
        "user-agent": "DiscordMusicDetector/0.2"
      },
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    throw new Error(
      `Could not verify the Discord bot token: ${redactToken(error.message, normalizedToken)}`
    );
  }

  if (!response.ok) {
    throw new Error(`Discord bot-token verification failed with HTTP ${response.status}.`);
  }

  const user = await response.json();
  if (user?.bot !== true) {
    throw new Error("Discord bot-token verification returned a non-bot account.");
  }

  return {
    id: normalizeText(user.id),
    username: normalizeText(user.username)
  };
}

/**
 * Convert the Spotify activity in a Discord presence into provider-neutral track
 * metadata. Discord removes the activity when Spotify is paused, so a valid
 * activity itself is the playing signal; timestamps are used only for progress.
 */
export function parseSpotifyPresence(presence, nowMs = Date.now()) {
  const capturedAt = Number(nowMs);
  if (!Number.isFinite(capturedAt)) {
    throw new TypeError("nowMs must be a finite number.");
  }

  const activities = Array.isArray(presence?.activities) ? presence.activities : [];
  const activity = activities.find((candidate) =>
    normalizeText(candidate?.name).toLowerCase() === "spotify"
  );

  if (!activity) {
    return null;
  }

  const title = normalizeText(activity.details);
  const artist = normalizeText(activity.state);
  if (!title || !artist) {
    return null;
  }

  const album = normalizeText(activity.assets?.large_text);
  const syncId = normalizeText(activity.sync_id);
  const start = finiteNumber(activity.timestamps?.start);
  const end = finiteNumber(activity.timestamps?.end);
  const hasTimeline = start !== null && end !== null && end > start;
  const durationMs = hasTimeline ? end - start : null;
  const positionMs = hasTimeline
    ? Math.min(durationMs, Math.max(0, capturedAt - start))
    : null;

  return {
    key: syncId || fallbackTrackKey(title, artist, album),
    title,
    artist,
    album,
    durationMs,
    positionMs,
    capturedAt,
    playing: true
  };
}

/**
 * Minimal Discord Gateway client for observing one user's Spotify presence.
 *
 * The implementation deliberately uses Node's global WebSocket and no external
 * packages. `WebSocketImpl` and timer functions are injectable for tests.
 */
export class DiscordPresenceGateway extends EventEmitter {
  constructor(options, positionalTargetUserId) {
    super();

    const normalizedOptions = typeof options === "string"
      ? { token: options, targetUserId: positionalTargetUserId }
      : (options ?? {});

    const {
      token,
      targetUserId,
      logger = console,
      gatewayUrl = DISCORD_GATEWAY_URL,
      WebSocketImpl = globalThis.WebSocket,
      random = Math.random,
      reconnectDelayMs = 1_000,
      maxReconnectDelayMs = 30_000,
      invalidSessionDelayMs = null,
      timers = {}
    } = normalizedOptions;

    if (!normalizeText(token)) {
      throw new TypeError("A Discord bot token is required.");
    }
    if (!normalizeText(targetUserId)) {
      throw new TypeError("A target Discord user ID is required.");
    }

    this.token = String(token);
    this.targetUserId = String(targetUserId);
    this.logger = logger;
    this.gatewayUrl = gatewayUrl;
    this.WebSocketImpl = WebSocketImpl;
    this.random = random;
    this.reconnectDelayMs = Math.max(0, Number(reconnectDelayMs) || 0);
    this.maxReconnectDelayMs = Math.max(
      this.reconnectDelayMs,
      Number(maxReconnectDelayMs) || this.reconnectDelayMs
    );
    this.invalidSessionDelayMs = invalidSessionDelayMs === null || invalidSessionDelayMs === undefined
      ? null
      : Math.max(0, Number(invalidSessionDelayMs) || 0);
    this.timers = {
      setTimeout: timers.setTimeout ?? globalThis.setTimeout,
      clearTimeout: timers.clearTimeout ?? globalThis.clearTimeout,
      setInterval: timers.setInterval ?? globalThis.setInterval,
      clearInterval: timers.clearInterval ?? globalThis.clearInterval
    };

    this.socket = null;
    this.connected = false;
    this.sequence = null;
    this.sessionId = "";
    this.resumeGatewayUrl = "";
    this.currentTrack = null;
    this.latestTrack = null;
    this.lastError = null;

    this._manualClose = false;
    this._fatal = false;
    this._identifiedSocket = null;
    this._heartbeatAcked = true;
    this._heartbeatStartTimer = null;
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._readyPromise = null;
    this._resolveReady = null;
    this._rejectReady = null;
  }

  /** Resolve after the Gateway's READY dispatch, not merely the WebSocket open. */
  connect() {
    if (this.connected) {
      return Promise.resolve(this);
    }

    if (typeof this.WebSocketImpl !== "function") {
      const error = new Error(
        "This Node.js runtime does not provide a global WebSocket implementation."
      );
      this._fail(error);
      return Promise.reject(error);
    }

    this._manualClose = false;
    this._fatal = false;
    const ready = this._getReadyPromise();

    if (!this.socket && this._reconnectTimer === null) {
      this._openSocket();
    }

    return ready;
  }

  disconnect() {
    this._manualClose = true;
    this.connected = false;
    this._clearReconnectTimer();
    this._clearHeartbeatTimers();

    const socket = this.socket;
    this.socket = null;
    this._identifiedSocket = null;
    this._clearSession();

    if (socket && socket.readyState !== closedState(this.WebSocketImpl)) {
      try {
        socket.close(1000, "Client disconnect");
      } catch {
        // The socket may already be closing.
      }
    }

    if (this._rejectReady) {
      this._rejectReady(new Error("Discord Gateway connection was stopped."));
      this._clearReadyPromise();
    }
  }

  destroy() {
    this.disconnect();
  }

  close() {
    this.disconnect();
  }

  /** Public for protocol-level tests and embedders feeding decoded payloads. */
  handleGatewayPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (Number.isInteger(payload.s)) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case GATEWAY_OPCODES.HELLO:
        this._startHeartbeat(payload.d?.heartbeat_interval);
        this._authenticate();
        break;
      case GATEWAY_OPCODES.HEARTBEAT:
        this._sendHeartbeat();
        break;
      case GATEWAY_OPCODES.HEARTBEAT_ACK:
        this._heartbeatAcked = true;
        break;
      case GATEWAY_OPCODES.RECONNECT:
        this._beginReconnect(0);
        break;
      case GATEWAY_OPCODES.INVALID_SESSION:
        if (payload.d !== true) {
          this._clearSession();
        }
        this._beginReconnect(this._getInvalidSessionDelay());
        break;
      case GATEWAY_OPCODES.DISPATCH:
        this._handleDispatch(payload.t, payload.d);
        break;
      default:
        break;
    }
  }

  _getReadyPromise() {
    if (!this._readyPromise) {
      this._readyPromise = new Promise((resolve, reject) => {
        this._resolveReady = resolve;
        this._rejectReady = reject;
      });
    }
    return this._readyPromise;
  }

  _clearReadyPromise() {
    this._readyPromise = null;
    this._resolveReady = null;
    this._rejectReady = null;
  }

  _openSocket() {
    if (this._manualClose || this._fatal || this.socket) {
      return;
    }

    this._clearReconnectTimer();

    let socket;
    try {
      socket = new this.WebSocketImpl(this._getConnectionUrl());
    } catch {
      this._fail(new Error("Could not create the Discord Gateway WebSocket."));
      return;
    }

    this.socket = socket;
    this._identifiedSocket = null;
    this._heartbeatAcked = true;

    addSocketListener(socket, "open", () => {
      if (this.socket === socket) {
        this.emit("open");
      }
    });
    addSocketListener(socket, "message", (event) => {
      if (this.socket === socket) {
        void this._handleSocketMessage(event);
      }
    });
    addSocketListener(socket, "error", () => {
      if (this.socket === socket) {
        this.logger.debug?.("Discord Gateway WebSocket reported an error.");
      }
    });
    addSocketListener(socket, "close", (event = {}) => {
      this._handleSocketClose(socket, event);
    });
  }

  async _handleSocketMessage(event) {
    try {
      const text = await messageText(event?.data ?? event);
      this.handleGatewayPayload(JSON.parse(text));
    } catch {
      this.logger.warn?.("Ignored an invalid Discord Gateway message.");
    }
  }

  _handleSocketClose(socket, event) {
    if (this.socket !== socket) {
      return;
    }

    this.socket = null;
    this._identifiedSocket = null;
    this._clearHeartbeatTimers();
    const wasConnected = this.connected;
    this.connected = false;

    if (wasConnected) {
      this.emit("disconnected", event?.code);
    }

    if (this._manualClose || this._fatal) {
      return;
    }

    const code = Number(event?.code) || 0;
    if (FATAL_CLOSE_CODES.has(code)) {
      const error = new Error(`Discord Gateway rejected the connection (close code ${code}).`);
      error.closeCode = code;
      this._fail(error);
      return;
    }

    if (NON_RESUMABLE_CLOSE_CODES.has(code)) {
      this._clearSession();
    }

    this._scheduleReconnect();
  }

  _handleDispatch(type, data) {
    switch (type) {
      case "READY": {
        if (data?.user?.bot !== true) {
          this._fail(new Error("Discord rejected listen-along because the supplied token is not a bot token."));
          break;
        }

        this.sessionId = normalizeText(data.session_id);
        this.resumeGatewayUrl = normalizeText(data.resume_gateway_url);
        this.connected = true;
        this._reconnectAttempts = 0;
        const resolve = this._resolveReady;
        this._clearReadyPromise();
        resolve?.(this);
        this.emit("ready", data);
        break;
      }
      case "RESUMED": {
        this.connected = true;
        this._reconnectAttempts = 0;
        const resolve = this._resolveReady;
        this._clearReadyPromise();
        resolve?.(this);
        this.emit("resumed", data);
        if (this.currentTrack) {
          this.emit("track", this.currentTrack);
        }
        break;
      }
      case "GUILD_CREATE":
        this._processPresenceList(data?.presences);
        if (data?.id) {
          this._requestTargetMember(data.id);
        }
        break;
      case "GUILD_MEMBERS_CHUNK":
        this._processPresenceList(data?.presences);
        for (const member of Array.isArray(data?.members) ? data.members : []) {
          if (member?.presence) {
            this._processPresence(member.presence);
          }
        }
        break;
      case "PRESENCE_UPDATE":
        this._processPresence(data);
        break;
      default:
        break;
    }
  }

  _processPresenceList(presences) {
    for (const presence of Array.isArray(presences) ? presences : []) {
      this._processPresence(presence);
    }
  }

  _processPresence(presence) {
    const userId = presence?.user?.id ?? presence?.user_id ?? presence?.member?.user?.id;
    if (String(userId ?? "") !== this.targetUserId) {
      return;
    }

    // Discord documents presence payloads as partial. A missing activities field
    // is unknown state; only an explicit empty array means playback disappeared.
    if (!Array.isArray(presence?.activities)) {
      return;
    }

    const track = parseSpotifyPresence(presence);
    this.currentTrack = track;
    this.latestTrack = track;
    this.emit("track", track);
    this.emit("presence", presence, track);
  }

  _authenticate() {
    const socket = this.socket;
    if (!socket || this._identifiedSocket === socket) {
      return;
    }

    this._identifiedSocket = socket;
    if (this.sessionId && Number.isInteger(this.sequence)) {
      this._send({
        op: GATEWAY_OPCODES.RESUME,
        d: {
          token: this.token,
          session_id: this.sessionId,
          seq: this.sequence
        }
      });
      return;
    }

    this._send({
      op: GATEWAY_OPCODES.IDENTIFY,
      d: {
        token: this.token,
        intents: REQUIRED_INTENTS,
        properties: {
          os: process.platform,
          browser: "discord-music-detector",
          device: "discord-music-detector"
        }
      }
    });
  }

  _requestTargetMember(guildId) {
    this._send({
      op: GATEWAY_OPCODES.REQUEST_GUILD_MEMBERS,
      d: {
        guild_id: String(guildId),
        user_ids: [this.targetUserId],
        presences: true,
        nonce: `target:${guildId}`
      }
    });
  }

  _startHeartbeat(intervalValue) {
    this._clearHeartbeatTimers();
    const interval = Number(intervalValue);
    if (!Number.isFinite(interval) || interval <= 0) {
      this._beginReconnect(0);
      return;
    }

    this._heartbeatAcked = true;
    const jitter = Math.max(0, Math.min(1, Number(this.random()) || 0));
    this._heartbeatStartTimer = this.timers.setTimeout(() => {
      this._heartbeatStartTimer = null;
      this._sendHeartbeat();
      this._heartbeatTimer = this.timers.setInterval(() => {
        if (!this._heartbeatAcked) {
          this._beginReconnect(0);
          return;
        }
        this._sendHeartbeat();
      }, interval);
      this._heartbeatTimer?.unref?.();
    }, Math.floor(interval * jitter));
    this._heartbeatStartTimer?.unref?.();
  }

  _sendHeartbeat() {
    if (this._send({ op: GATEWAY_OPCODES.HEARTBEAT, d: this.sequence })) {
      this._heartbeatAcked = false;
    }
  }

  _send(payload) {
    const socket = this.socket;
    if (!socket || socket.readyState !== openState(this.WebSocketImpl)) {
      return false;
    }

    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      this._beginReconnect(0);
      return false;
    }
  }

  _beginReconnect(delay) {
    if (this._manualClose || this._fatal) {
      return;
    }

    const socket = this.socket;
    const wasConnected = this.connected;
    this.socket = null;
    this._identifiedSocket = null;
    this.connected = false;
    this._clearHeartbeatTimers();

    if (wasConnected) {
      this.emit("disconnected", 0);
    }

    if (socket) {
      try {
        socket.close(4000, "Reconnect");
      } catch {
        // Closing is best-effort; reconnect is scheduled independently.
      }
    }

    this._scheduleReconnect(delay);
  }

  _scheduleReconnect(delayOverride) {
    if (this._manualClose || this._fatal || this._reconnectTimer !== null) {
      return;
    }

    const attempt = this._reconnectAttempts++;
    const backoff = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectDelayMs * (2 ** Math.min(attempt, 10))
    );
    const delay = delayOverride === undefined ? backoff : Math.max(0, delayOverride);

    this._reconnectTimer = this.timers.setTimeout(() => {
      this._reconnectTimer = null;
      this._openSocket();
    }, delay);
    this._reconnectTimer?.unref?.();
  }

  _clearHeartbeatTimers() {
    if (this._heartbeatStartTimer !== null) {
      this.timers.clearTimeout(this._heartbeatStartTimer);
      this._heartbeatStartTimer = null;
    }
    if (this._heartbeatTimer !== null) {
      this.timers.clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer !== null) {
      this.timers.clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _fail(error) {
    this._fatal = true;
    this.connected = false;
    this.lastError = error;
    this._clearReconnectTimer();
    this._clearHeartbeatTimers();

    const socket = this.socket;
    this.socket = null;
    this._identifiedSocket = null;
    if (socket) {
      try {
        socket.close(4000, "Fatal Gateway error");
      } catch {
        // The socket may already be closed.
      }
    }

    const reject = this._rejectReady;
    this._clearReadyPromise();
    reject?.(error);

    this.emit("gatewayError", error);
    if (this.listenerCount("error") > 0) {
      this.emit("error", error);
    } else {
      this.logger.error?.(redactToken(error.message, this.token));
    }
  }

  _getConnectionUrl() {
    if (!this.sessionId || !this.resumeGatewayUrl) {
      return this.gatewayUrl;
    }

    try {
      const url = new URL(this.resumeGatewayUrl);
      url.searchParams.set("v", "10");
      url.searchParams.set("encoding", "json");
      return url.href;
    } catch {
      return this.gatewayUrl;
    }
  }

  _getInvalidSessionDelay() {
    if (this.invalidSessionDelayMs !== null) {
      return this.invalidSessionDelayMs;
    }

    const jitter = Math.max(0, Math.min(1, Number(this.random()) || 0));
    return 1_000 + Math.floor(jitter * 4_000);
  }

  _clearSession() {
    this.sequence = null;
    this.sessionId = "";
    this.resumeGatewayUrl = "";
    this.currentTrack = null;
    this.latestTrack = null;
  }
}

function fallbackTrackKey(title, artist, album) {
  return [title, artist, album]
    .map((value) => normalizeText(value).toLowerCase())
    .join("\u001f");
}

function normalizeText(value) {
  return value === null || value === undefined
    ? ""
    : String(value).replace(/\s+/g, " ").trim();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function openState(WebSocketImpl) {
  return Number.isInteger(WebSocketImpl?.OPEN) ? WebSocketImpl.OPEN : 1;
}

function closedState(WebSocketImpl) {
  return Number.isInteger(WebSocketImpl?.CLOSED) ? WebSocketImpl.CLOSED : 3;
}

function addSocketListener(socket, type, listener) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(type, listener);
  } else if (typeof socket.on === "function") {
    socket.on(type, listener);
  } else {
    socket[`on${type}`] = listener;
  }
}

async function messageText(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof data?.text === "function") {
    return data.text();
  }
  return String(data);
}

function redactToken(message, token) {
  const text = String(message ?? "Discord Gateway error.");
  return token ? text.split(token).join("[redacted]") : text;
}
