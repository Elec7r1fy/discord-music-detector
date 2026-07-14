import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const OPCODES = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4
};

export function encodeFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 8) {
    const opcode = buffer.readInt32LE(offset);
    const length = buffer.readInt32LE(offset + 4);

    if (length < 0) {
      throw new Error("Discord IPC frame length was negative.");
    }

    const frameEnd = offset + 8 + length;
    if (buffer.length < frameEnd) {
      break;
    }

    const body = buffer.slice(offset + 8, frameEnd).toString("utf8");
    frames.push({
      opcode,
      payload: body ? JSON.parse(body) : null
    });
    offset = frameEnd;
  }

  return {
    frames,
    rest: buffer.slice(offset)
  };
}

export function getPipeCandidates() {
  if (process.platform === "win32") {
    return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  }

  const envDirs = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP];
  const dirs = [...new Set(envDirs.filter(Boolean).concat(os.tmpdir()))];
  return dirs.flatMap((dir) =>
    Array.from({ length: 10 }, (_, index) => path.join(dir, `discord-ipc-${index}`))
  );
}

export class DiscordIpc extends EventEmitter {
  constructor({ clientId, logger = console, pipeTimeoutMs = 800, handshakeTimeoutMs = 3000 }) {
    super();
    this.clientId = clientId;
    this.logger = logger;
    this.pipeTimeoutMs = pipeTimeoutMs;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.connected = false;
  }

  async connect() {
    const errors = [];

    for (const pipePath of getPipeCandidates()) {
      try {
        const socket = await connectSocket(pipePath, this.pipeTimeoutMs);
        this.attachSocket(socket);
        await this.handshake();
        this.connected = true;
        this.logger.info?.(`Connected to Discord IPC at ${pipePath}`);
        return;
      } catch (error) {
        errors.push(`${pipePath}: ${error.message}`);
        this.destroy();
      }
    }

    throw new Error(`Could not connect to Discord desktop IPC. ${errors[0] ?? ""}`.trim());
  }

  attachSocket(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", (error) => this.handleSocketError(error));
  }

  async handshake() {
    this.write(OPCODES.HANDSHAKE, {
      v: 1,
      client_id: this.clientId
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for Discord READY frame."));
      }, this.handshakeTimeoutMs);

      const onFrame = (frame) => {
        if (frame.opcode === OPCODES.FRAME && frame.payload?.evt === "READY") {
          cleanup();
          resolve();
        }

        if (frame.opcode === OPCODES.CLOSE) {
          cleanup();
          reject(new Error(`Discord closed IPC during handshake: ${JSON.stringify(frame.payload)}`));
        }
      };

      const onClose = () => {
        cleanup();
        reject(new Error("Discord IPC closed during handshake."));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("frame", onFrame);
        this.off("closed", onClose);
      };

      this.on("frame", onFrame);
      this.on("closed", onClose);
    });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    let decoded;
    try {
      decoded = decodeFrames(this.buffer);
    } catch (error) {
      this.logger.warn?.(`Failed to decode Discord IPC frame: ${error.message}`);
      this.destroy();
      return;
    }

    this.buffer = decoded.rest;

    for (const frame of decoded.frames) {
      this.emit("frame", frame);

      if (frame.opcode === OPCODES.PING) {
        this.write(OPCODES.PONG, frame.payload ?? {});
        continue;
      }

      const nonce = frame.payload?.nonce;
      if (nonce && this.pending.has(nonce)) {
        const pending = this.pending.get(nonce);
        this.pending.delete(nonce);

        if (frame.payload?.evt === "ERROR" || frame.payload?.cmd === "ERROR") {
          pending.reject(new Error(frame.payload?.data?.message ?? "Discord returned an error."));
        } else {
          pending.resolve(frame.payload);
        }
      }
    }
  }

  handleSocketError(error) {
    this.logger.debug?.(`Discord IPC socket error: ${error.message}`);
  }

  handleClose() {
    const wasConnected = this.connected;
    this.connected = false;
    this.socket = null;

    for (const pending of this.pending.values()) {
      pending.reject(new Error("Discord IPC connection closed."));
    }
    this.pending.clear();

    if (wasConnected) {
      this.logger.warn?.("Discord IPC disconnected.");
    }
    this.emit("closed");
  }

  write(opcode, payload) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Discord IPC socket is not connected.");
    }

    this.socket.write(encodeFrame(opcode, payload));
  }

  sendCommand(command, args = {}) {
    if (!this.connected) {
      return Promise.reject(new Error("Discord IPC is not connected."));
    }

    const nonce = crypto.randomUUID();
    const payload = {
      cmd: command,
      args,
      nonce
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Timed out waiting for Discord response to ${command}.`));
      }, 5000);

      this.pending.set(nonce, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      try {
        this.write(OPCODES.FRAME, payload);
      } catch (error) {
        this.pending.delete(nonce);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  setActivity(activity, pid = process.pid) {
    return this.sendCommand("SET_ACTIVITY", {
      pid,
      activity
    });
  }

  clearActivity(pid = process.pid) {
    return this.setActivity(null, pid);
  }

  destroy() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
    this.connected = false;
  }
}

function connectSocket(pipePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath);
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };

    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}
