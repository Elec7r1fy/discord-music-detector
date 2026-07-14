import { expectedTrackPositionMs, getTrackKey } from "./youtubeMusicPlayer.js";

export class ListenAlongSynchronizer {
  constructor({
    player,
    missingGraceMs = 5000,
    minimumRemainingMs = 5000,
    retryDelayMs = 10000,
    pauseRetryDelayMs = 2000,
    logger = console,
    now = Date.now
  }) {
    if (!player) {
      throw new Error("ListenAlongSynchronizer requires a player adapter.");
    }

    this.player = player;
    this.missingGraceMs = missingGraceMs;
    this.minimumRemainingMs = minimumRemainingMs;
    this.retryDelayMs = retryDelayMs;
    this.pauseRetryDelayMs = pauseRetryDelayMs;
    this.logger = logger;
    this.now = now;
    this.latestTrack = null;
    this.desiredKey = "";
    this.activeKey = "";
    this.missingSince = null;
    this.generation = 0;
    this.loadAbortController = null;
    this.operation = Promise.resolve();
    this.syncing = false;
    this.stopped = false;
    this.failedKey = "";
    this.retryAt = 0;
    this.pausePending = false;
    this.pauseAttempting = false;
    this.nextPauseAttemptAt = 0;
  }

  handleTrack(track) {
    if (this.stopped) {
      return this.operation;
    }

    if (!track) {
      if (this.missingSince === null) {
        this.missingSince = this.now();
      }
      this.latestTrack = null;
      return this.operation;
    }

    this.missingSince = null;
    this.pausePending = false;
    this.nextPauseAttemptAt = 0;
    const previousTrack = this.latestTrack;
    this.latestTrack = track;
    const key = getTrackKey(track);
    if (!key) {
      return this.operation;
    }

    const restartedAfterSkip = key === this.desiredKey
      && !this.activeKey
      && getTrackKey(previousTrack) === key
      && hasTrackRestarted(previousTrack, track, this.now());
    if (key === this.desiredKey && !restartedAfterSkip) {
      return this.operation;
    }

    if (restartedAfterSkip) {
      this.desiredKey = "";
    }

    if (key === this.failedKey && this.now() < this.retryAt) {
      return this.operation;
    }

    if (key !== this.failedKey) {
      this.failedKey = "";
      this.retryAt = 0;
    }

    const remainingMs = getRemainingMs(track, this.now());
    if (remainingMs !== null && remainingMs < this.minimumRemainingMs) {
      this.logger.info?.(`Listen along: skipping the final ${Math.ceil(remainingMs / 1000)}s of ${track.title}.`);
      const hadPlayback = Boolean(this.activeKey || this.desiredKey || this.loadAbortController);
      this.desiredKey = key;
      this.activeKey = "";
      this.generation += 1;
      const generation = this.generation;
      this.loadAbortController?.abort(new Error("The source track is almost over."));
      this.loadAbortController = null;
      if (hadPlayback) {
        this.pausePending = true;
        this.nextPauseAttemptAt = this.now();
        return this.attemptPause(generation).catch((error) => {
          this.logger.warn?.(`Could not pause the previous destination track: ${error.message}`);
        });
      }
      return this.operation;
    }

    this.desiredKey = key;
    this.activeKey = "";
    const generation = ++this.generation;
    this.loadAbortController?.abort(new Error("A newer source track replaced this load."));
    const controller = new AbortController();
    this.loadAbortController = controller;

    this.operation = this.operation
      .catch(() => {})
      .then(async () => {
        if (this.stopped || generation !== this.generation || controller.signal.aborted) {
          return;
        }

        try {
          await this.player.load(track, { signal: controller.signal });
          if (!this.stopped && generation === this.generation && !controller.signal.aborted) {
            this.activeKey = key;
            this.failedKey = "";
            this.retryAt = 0;
          }
        } catch (error) {
          if (controller.signal.aborted || generation !== this.generation || this.stopped) {
            return;
          }

          this.desiredKey = "";
          this.failedKey = key;
          this.retryAt = this.now() + this.retryDelayMs;
          this.logger.warn?.(`Listen along could not load the track: ${error.message}`);
        } finally {
          if (this.loadAbortController === controller) {
            this.loadAbortController = null;
          }
        }
      });

    return this.operation;
  }

  async tick() {
    if (this.stopped) {
      return;
    }

    if (this.pausePending) {
      if (!this.pauseAttempting && this.now() >= this.nextPauseAttemptAt) {
        await this.attemptPause(this.generation);
      }
      return;
    }

    if (this.missingSince !== null) {
      if (this.now() - this.missingSince >= this.missingGraceMs) {
        await this.pauseNow();
      }
      return;
    }

    if (!this.latestTrack) {
      return;
    }

    const key = getTrackKey(this.latestTrack);
    if (!this.activeKey) {
      if (!this.desiredKey) {
        this.handleTrack(this.latestTrack);
      }
      return;
    }

    if (key !== this.activeKey || this.syncing) {
      return;
    }

    const durationMs = Number(this.latestTrack.durationMs);
    const expectedMs = expectedTrackPositionMs(this.latestTrack, this.now());
    if (Number.isFinite(durationMs) && durationMs > 0 && expectedMs >= durationMs - 300) {
      await this.pauseNow();
      return;
    }

    const track = this.latestTrack;
    const generation = this.generation;
    this.syncing = true;
    const syncOperation = this.operation.catch(() => {}).then(async () => {
      try {
        if (this.stopped || generation !== this.generation || getTrackKey(track) !== this.activeKey) {
          return;
        }
        await this.player.sync(track);
      } catch (error) {
        this.logger.warn?.(`Listen along sync check failed: ${error.message}`);
      } finally {
        this.syncing = false;
      }
    });
    this.operation = syncOperation;
    await syncOperation;
  }

  async pauseNow() {
    const hadPlayback = Boolean(
      this.activeKey || this.desiredKey || this.loadAbortController || this.pausePending
    );
    this.generation += 1;
    const generation = this.generation;
    this.loadAbortController?.abort(new Error("Source playback stopped."));
    this.loadAbortController = null;
    this.latestTrack = null;
    this.activeKey = "";
    this.desiredKey = "";
    this.missingSince = null;
    this.failedKey = "";
    this.retryAt = 0;

    if (hadPlayback) {
      this.pausePending = true;
      this.nextPauseAttemptAt = this.now();
      await this.attemptPause(generation);
    }
  }

  async attemptPause(generation) {
    if (this.pauseAttempting) {
      return this.operation;
    }

    this.pauseAttempting = true;
    const pauseOperation = this.operation.catch(() => {}).then(() => this.player.pause());
    this.operation = pauseOperation;

    try {
      await pauseOperation;
      if (generation === this.generation) {
        this.pausePending = false;
        this.nextPauseAttemptAt = 0;
        this.logger.info?.("Listen along: source playback stopped; destination paused.");
      }
    } catch (error) {
      if (generation === this.generation) {
        this.pausePending = true;
        this.nextPauseAttemptAt = this.now() + this.pauseRetryDelayMs;
      }
      throw error;
    } finally {
      this.pauseAttempting = false;
    }
  }

  async stop() {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    await this.pauseNow();
  }

  waitForIdle() {
    return this.operation;
  }
}

export function getRemainingMs(track, nowMs = Date.now()) {
  const durationMs = Number(track?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  return Math.max(0, durationMs - expectedTrackPositionMs(track, nowMs));
}

export function hasTrackRestarted(previousTrack, nextTrack, nowMs = Date.now()) {
  if (!previousTrack || !nextTrack || getTrackKey(previousTrack) !== getTrackKey(nextTrack)) {
    return false;
  }

  const previousPosition = expectedTrackPositionMs(previousTrack, nowMs);
  const nextPosition = expectedTrackPositionMs(nextTrack, nowMs);
  return previousPosition - nextPosition > 5000;
}
