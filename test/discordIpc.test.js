import assert from "node:assert/strict";
import test from "node:test";
import { decodeFrames, encodeFrame, OPCODES } from "../src/discordIpc.js";

test("Discord IPC frames round-trip", () => {
  const payload = {
    cmd: "SET_ACTIVITY",
    args: {
      pid: 1234,
      activity: {
        details: "Song"
      }
    },
    nonce: "test"
  };

  const frame = encodeFrame(OPCODES.FRAME, payload);
  const decoded = decodeFrames(frame);

  assert.equal(decoded.rest.length, 0);
  assert.equal(decoded.frames.length, 1);
  assert.equal(decoded.frames[0].opcode, OPCODES.FRAME);
  assert.deepEqual(decoded.frames[0].payload, payload);
});

test("Discord IPC decoder preserves partial frames", () => {
  const first = encodeFrame(OPCODES.PING, { nonce: "a" });
  const second = encodeFrame(OPCODES.PONG, { nonce: "b" });
  const partial = Buffer.concat([first, second.subarray(0, 5)]);
  const decoded = decodeFrames(partial);

  assert.equal(decoded.frames.length, 1);
  assert.equal(decoded.frames[0].opcode, OPCODES.PING);
  assert.deepEqual(decoded.rest, second.subarray(0, 5));
});
