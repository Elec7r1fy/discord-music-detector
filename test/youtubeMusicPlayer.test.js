import assert from "node:assert/strict";
import test from "node:test";
import {
  buildYouTubeMusicSearchUrl,
  buildSearchResultsExpression,
  chooseYouTubeMusicCandidate,
  expectedTrackPositionMs,
  isYouTubeMusicTab,
  normalizePlaybackPositionSeconds,
  sameYouTubeMusicVideo,
  scoreYouTubeMusicCandidate
} from "../src/youtubeMusicPlayer.js";

const track = {
  key: "spotify:123",
  title: "Money Trees (feat. Jay Rock)",
  artist: "Kendrick Lamar",
  album: "good kid, m.A.A.d city",
  durationMs: 390000,
  positionMs: 60000,
  capturedAt: 1_700_000_000_000,
  playing: true
};

test("buildYouTubeMusicSearchUrl combines the title and artist", () => {
  const url = new URL(buildYouTubeMusicSearchUrl(track));
  assert.equal(url.origin, "https://music.youtube.com");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("q"), "Money Trees (feat. Jay Rock) Kendrick Lamar");
});

test("isYouTubeMusicTab accepts only controllable YouTube Music pages", () => {
  assert.equal(isYouTubeMusicTab({
    type: "page",
    url: "https://music.youtube.com/watch?v=abc",
    webSocketDebuggerUrl: "ws://127.0.0.1/tab"
  }), true);
  assert.equal(isYouTubeMusicTab({
    type: "page",
    url: "https://www.youtube.com/watch?v=abc",
    webSocketDebuggerUrl: "ws://127.0.0.1/tab"
  }), false);
  assert.equal(isYouTubeMusicTab({ url: "https://music.youtube.com" }), false);
});

test("candidate scoring prefers the matching artist and normalized title", () => {
  const right = {
    href: "https://music.youtube.com/watch?v=right",
    title: "Money Trees",
    byline: "Kendrick Lamar • good kid, m.A.A.d city",
    text: "Money Trees Kendrick Lamar"
  };
  const cover = {
    href: "https://music.youtube.com/watch?v=cover",
    title: "Money Trees (Karaoke Cover)",
    byline: "Cover Band",
    text: "Money Trees Karaoke Cover"
  };

  assert.ok(scoreYouTubeMusicCandidate(right, track) > scoreYouTubeMusicCandidate(cover, track));
  assert.equal(chooseYouTubeMusicCandidate([cover, right], track).href, right.href);
});

test("candidate scoring rejects navigation outside YouTube Music", () => {
  assert.equal(scoreYouTubeMusicCandidate({
    href: "https://example.com/watch?v=bad",
    title: "Money Trees",
    text: "Kendrick Lamar"
  }, track), 0);
});

test("expectedTrackPositionMs advances and clamps source position", () => {
  assert.equal(expectedTrackPositionMs(track, 1_700_000_002_500), 62500);
  assert.equal(expectedTrackPositionMs(track, 1_700_001_000_000), 389750);
  assert.equal(expectedTrackPositionMs({ ...track, playing: false }, 1_700_000_002_500), 60000);
});

test("playback control does not turn a missing seek position into zero", () => {
  assert.equal(normalizePlaybackPositionSeconds(null), null);
  assert.equal(normalizePlaybackPositionSeconds(undefined), null);
  assert.equal(normalizePlaybackPositionSeconds(""), null);
  assert.equal(normalizePlaybackPositionSeconds(0), 0);
  assert.equal(normalizePlaybackPositionSeconds(3250), 3.25);
});

test("sameYouTubeMusicVideo compares video IDs instead of playlist parameters", () => {
  assert.equal(
    sameYouTubeMusicVideo(
      "https://music.youtube.com/watch?v=abc&list=one",
      "https://music.youtube.com/watch?v=abc&list=two"
    ),
    true
  );
  assert.equal(
    sameYouTubeMusicVideo(
      "https://music.youtube.com/watch?v=abc",
      "https://music.youtube.com/watch?v=other"
    ),
    false
  );
});

test("search polling requires the expected query before using result rows", () => {
  const expression = buildSearchResultsExpression("Song \"quoted\" Artist");
  assert.match(expression, /currentQuery !== "Song \\"quoted\\" Artist"/);
  assert.doesNotThrow(() => new Function(`return ${expression}`));
});

test("findTab pins one YouTube Music tab when result order changes", async () => {
  let tabs = [
    makeDebugTab("chosen", "https://music.youtube.com/watch?v=one"),
    makeDebugTab("other", "https://music.youtube.com/watch?v=two")
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => tabs });
  const { YouTubeMusicBrowserPlayer } = await import("../src/youtubeMusicPlayer.js");
  const player = new YouTubeMusicBrowserPlayer({
    debuggingPorts: [9222],
    fetchImpl,
    logger: { debug() {} }
  });

  assert.equal((await player.findTab()).id, "chosen");
  tabs = [tabs[1], tabs[0]];
  assert.equal((await player.findTab()).id, "chosen");
});

function makeDebugTab(id, url) {
  return {
    id,
    type: "page",
    url,
    webSocketDebuggerUrl: `ws://127.0.0.1/devtools/page/${id}`
  };
}
