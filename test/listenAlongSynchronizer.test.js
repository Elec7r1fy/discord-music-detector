import assert from "node:assert/strict";
import test from "node:test";
import {
  ListenAlongSynchronizer,
  getRemainingMs,
  hasTrackRestarted
} from "../src/listenAlongSynchronizer.js";

function makeTrack(overrides = {}) {
  return {
    key: "track-1",
    title: "Song",
    artist: "Artist",
    album: "Album",
    durationMs: 240000,
    positionMs: 30000,
    capturedAt: 100000,
    playing: true,
    ...overrides
  };
}

function makePlayer() {
  const calls = [];
  return {
    calls,
    async load(track) {
      calls.push(["load", track.key]);
    },
    async sync(track) {
      calls.push(["sync", track.key]);
      return true;
    },
    async pause() {
      calls.push(["pause"]);
    }
  };
}

test("synchronizer loads a new track once and syncs duplicates", async () => {
  let now = 100000;
  const player = makePlayer();
  const synchronizer = new ListenAlongSynchronizer({ player, now: () => now });
  const track = makeTrack();

  await synchronizer.handleTrack(track);
  await synchronizer.handleTrack({ ...track, positionMs: 32000, capturedAt: 102000 });
  await synchronizer.tick();

  assert.deepEqual(player.calls, [
    ["load", "track-1"],
    ["sync", "track-1"]
  ]);
});

test("synchronizer waits through missing-presence grace before pausing", async () => {
  let now = 100000;
  const player = makePlayer();
  const synchronizer = new ListenAlongSynchronizer({
    player,
    missingGraceMs: 5000,
    now: () => now
  });

  await synchronizer.handleTrack(makeTrack());
  synchronizer.handleTrack(null);
  now += 4999;
  await synchronizer.tick();
  assert.equal(player.calls.some(([name]) => name === "pause"), false);

  now += 1;
  await synchronizer.tick();
  assert.equal(player.calls.filter(([name]) => name === "pause").length, 1);
});

test("a new source track replaces the previous desired track", async () => {
  const player = makePlayer();
  const synchronizer = new ListenAlongSynchronizer({ player, now: () => 100000 });

  synchronizer.handleTrack(makeTrack());
  synchronizer.handleTrack(makeTrack({ key: "track-2", title: "Next Song" }));
  await synchronizer.waitForIdle();

  assert.deepEqual(player.calls, [["load", "track-2"]]);
});

test("nearly finished tracks are skipped", async () => {
  const player = makePlayer();
  const synchronizer = new ListenAlongSynchronizer({
    player,
    minimumRemainingMs: 5000,
    now: () => 100000
  });

  await synchronizer.handleTrack(makeTrack({ durationMs: 32000, positionMs: 30000 }));
  assert.deepEqual(player.calls, []);
});

test("a nearly finished replacement pauses the previous destination song", async () => {
  const player = makePlayer();
  const synchronizer = new ListenAlongSynchronizer({
    player,
    minimumRemainingMs: 5000,
    now: () => 100000
  });

  await synchronizer.handleTrack(makeTrack());
  await synchronizer.handleTrack(makeTrack({
    key: "track-2",
    title: "Almost Done",
    durationMs: 32000,
    positionMs: 30000
  }));

  assert.deepEqual(player.calls, [["load", "track-1"], ["pause"]]);
});

test("a skipped song loads if the same source track restarts from the beginning", async () => {
  let now = 100000;
  const player = makePlayer();
  const synchronizer = new ListenAlongSynchronizer({
    player,
    minimumRemainingMs: 5000,
    now: () => now
  });
  const almostDone = makeTrack({ key: "same", durationMs: 100000, positionMs: 98000 });
  await synchronizer.handleTrack(almostDone);

  now += 1000;
  await synchronizer.handleTrack(makeTrack({
    key: "same",
    durationMs: 100000,
    positionMs: 0,
    capturedAt: now
  }));

  assert.deepEqual(player.calls, [["load", "same"]]);
});

test("failed loads back off before retrying the same song", async () => {
  let now = 100000;
  let attempts = 0;
  const player = makePlayer();
  player.load = async () => {
    attempts += 1;
    throw new Error("autoplay blocked");
  };
  const synchronizer = new ListenAlongSynchronizer({
    player,
    retryDelayMs: 10000,
    now: () => now,
    logger: { warn() {}, info() {} }
  });

  await synchronizer.handleTrack(makeTrack());
  await synchronizer.tick();
  assert.equal(attempts, 1);

  now += 10000;
  await synchronizer.tick();
  await synchronizer.waitForIdle();
  assert.equal(attempts, 2);
});

test("getRemainingMs accounts for time since capture", () => {
  assert.equal(getRemainingMs(makeTrack(), 102500), 207500);
  assert.equal(getRemainingMs({ ...makeTrack(), durationMs: null }, 102500), null);
});

test("hasTrackRestarted detects a same-key rewind but not normal progress", () => {
  const previous = makeTrack({ key: "same", positionMs: 90000, capturedAt: 100000 });
  assert.equal(hasTrackRestarted(previous, {
    ...previous,
    positionMs: 0,
    capturedAt: 101000
  }, 101000), true);
  assert.equal(hasTrackRestarted(previous, {
    ...previous,
    positionMs: 91000,
    capturedAt: 101000
  }, 101000), false);
});

test("loads wait for an in-flight sync on the controlled player", async () => {
  let releaseSync;
  let markSyncStarted;
  const syncBarrier = new Promise((resolve) => {
    releaseSync = resolve;
  });
  const syncStarted = new Promise((resolve) => {
    markSyncStarted = resolve;
  });
  const player = makePlayer();
  player.sync = async (track) => {
    player.calls.push(["sync-start", track.key]);
    markSyncStarted();
    await syncBarrier;
    player.calls.push(["sync-end", track.key]);
  };
  const synchronizer = new ListenAlongSynchronizer({ player, now: () => 100000 });
  await synchronizer.handleTrack(makeTrack({ key: "track-1" }));

  const syncing = synchronizer.tick();
  await syncStarted;
  synchronizer.handleTrack(makeTrack({ key: "track-2", title: "Next" }));
  assert.equal(player.calls.some(([name, key]) => name === "load" && key === "track-2"), false);

  releaseSync();
  await syncing;
  await synchronizer.waitForIdle();
  assert.deepEqual(player.calls, [
    ["load", "track-1"],
    ["sync-start", "track-1"],
    ["sync-end", "track-1"],
    ["load", "track-2"]
  ]);
});

test("pause waits behind sync so stale sync cannot resume playback", async () => {
  let now = 100000;
  let releaseSync;
  let markSyncStarted;
  const syncBarrier = new Promise((resolve) => {
    releaseSync = resolve;
  });
  const syncStarted = new Promise((resolve) => {
    markSyncStarted = resolve;
  });
  const player = makePlayer();
  player.sync = async () => {
    player.calls.push(["sync-start"]);
    markSyncStarted();
    await syncBarrier;
    player.calls.push(["sync-end"]);
  };
  const synchronizer = new ListenAlongSynchronizer({
    player,
    missingGraceMs: 1000,
    now: () => now
  });
  await synchronizer.handleTrack(makeTrack());
  const syncing = synchronizer.tick();
  await syncStarted;

  synchronizer.handleTrack(null);
  now += 1000;
  const pausing = synchronizer.tick();
  releaseSync();
  await Promise.all([syncing, pausing]);

  assert.deepEqual(player.calls.slice(-3), [["sync-start"], ["sync-end"], ["pause"]]);
});

test("a transient pause failure is retried on a later tick", async () => {
  let now = 100000;
  let pauseAttempts = 0;
  const player = makePlayer();
  player.pause = async () => {
    pauseAttempts += 1;
    if (pauseAttempts === 1) {
      throw new Error("debugger temporarily unavailable");
    }
    player.calls.push(["pause"]);
  };
  const synchronizer = new ListenAlongSynchronizer({
    player,
    missingGraceMs: 1000,
    pauseRetryDelayMs: 2000,
    now: () => now,
    logger: { info() {}, warn() {} }
  });

  await synchronizer.handleTrack(makeTrack());
  synchronizer.handleTrack(null);
  now += 1000;
  await assert.rejects(synchronizer.tick(), /temporarily unavailable/);
  assert.equal(synchronizer.pausePending, true);

  now += 1999;
  await synchronizer.tick();
  assert.equal(pauseAttempts, 1);
  now += 1;
  await synchronizer.tick();
  assert.equal(pauseAttempts, 2);
  assert.equal(synchronizer.pausePending, false);
});

test("near-end replacement also retries a transient pause failure", async () => {
  let now = 100000;
  let pauseAttempts = 0;
  const player = makePlayer();
  player.pause = async () => {
    pauseAttempts += 1;
    if (pauseAttempts === 1) {
      throw new Error("first pause failed");
    }
    player.calls.push(["pause"]);
  };
  const synchronizer = new ListenAlongSynchronizer({
    player,
    minimumRemainingMs: 5000,
    pauseRetryDelayMs: 2000,
    now: () => now,
    logger: { info() {}, warn() {} }
  });

  await synchronizer.handleTrack(makeTrack({ key: "old" }));
  await synchronizer.handleTrack(makeTrack({
    key: "almost-over",
    durationMs: 31000,
    positionMs: 30000
  }));
  assert.equal(pauseAttempts, 1);
  assert.equal(synchronizer.pausePending, true);

  now += 2000;
  await synchronizer.tick();
  assert.equal(pauseAttempts, 2);
  assert.equal(synchronizer.pausePending, false);
  assert.deepEqual(player.calls.slice(-1), [["pause"]]);
});
