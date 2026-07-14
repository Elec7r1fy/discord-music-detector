import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoTimestamps,
  isYouTubeUrl,
  matchBrowserTab,
  normalizeVideoState
} from "../src/browserInspector.js";

test("isYouTubeUrl accepts watch and shorts URLs", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeUrl("https://youtube.com/shorts/abc"), true);
  assert.equal(isYouTubeUrl("https://music.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeUrl("https://example.com/watch?v=abc"), false);
});

test("matchBrowserTab matches the active YouTube tab by foreground title", () => {
  const tab = matchBrowserTab(
    {
      processName: "chrome",
      title: "A Good Video - YouTube - Google Chrome"
    },
    [
      {
        title: "Other Video - YouTube",
        url: "https://www.youtube.com/watch?v=other"
      },
      {
        title: "A Good Video - YouTube",
        url: "https://www.youtube.com/watch?v=good"
      }
    ]
  );

  assert.equal(tab.url, "https://www.youtube.com/watch?v=good");
});

test("normalizeVideoState keeps only YouTube video state", () => {
  assert.deepEqual(
    normalizeVideoState({
      url: "https://www.youtube.com/watch?v=abc",
      title: "Video",
      currentTime: 30,
      duration: 120,
      paused: false,
      playbackRate: 1
    }),
    {
      url: "https://www.youtube.com/watch?v=abc",
      title: "Video",
      currentTime: 30,
      duration: 120,
      paused: false,
      playbackRate: 1
    }
  );

  assert.equal(normalizeVideoState({ url: "https://example.com" }), null);
});

test("buildVideoTimestamps creates Discord timestamps for playing videos", () => {
  assert.deepEqual(
    buildVideoTimestamps(
      {
        currentTime: 30,
        duration: 120,
        paused: false,
        playbackRate: 1
      },
      1_700_000_000_000
    ),
    {
      start: 1_699_999_970,
      end: 1_700_000_090
    }
  );
});

test("buildVideoTimestamps omits paused videos", () => {
  assert.equal(
    buildVideoTimestamps({
      currentTime: 30,
      duration: 120,
      paused: true,
      playbackRate: 1
    }),
    null
  );
});
