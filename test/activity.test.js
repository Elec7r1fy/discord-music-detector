import assert from "node:assert/strict";
import test from "node:test";
import { buildActivity, getDisplayValues, getLargeImageKey, selectSession } from "../src/activity.js";

const baseConfig = {
  playerPatterns: ["Apple Music", "AppleMusic", "AppleInc.AppleMusic"],
  onlyAppleMusic: true,
  showPaused: false,
  activityType: 2,
  activityNameTemplate: "{artist}",
  statusDisplayType: 0,
  includeAlbumInState: true,
  artworkMode: "off",
  detailsTemplate: "{title}",
  stateTemplate: "{artist}",
  largeImageKey: "",
  albumImageKeys: {},
  largeImageTextTemplate: "{album}"
};

test("selectSession prefers Apple Music and playing sessions", () => {
  const sessions = [
    {
      sourceAppUserModelId: "Chrome",
      title: "Browser audio",
      artist: "Someone",
      playbackStatus: "Playing"
    },
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Paused song",
      artist: "Artist",
      playbackStatus: "Paused"
    },
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Playing song",
      artist: "Artist",
      playbackStatus: "Playing"
    }
  ];

  assert.equal(selectSession(sessions, baseConfig).title, "Playing song");
});

test("buildActivity formats title, artist, album, and timestamps", () => {
  const activity = buildActivity(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Song",
      artist: "Artist",
      albumTitle: "Album",
      playbackStatus: "Playing",
      startTimeMs: 0,
      endTimeMs: 240000,
      positionMs: 60000
    },
    baseConfig,
    1_700_000_000_000
  );

  assert.equal(activity.type, 2);
  assert.equal(activity.name, "Artist");
  assert.equal(activity.details, "Song");
  assert.equal(activity.state, "Artist - Album");
  assert.equal(activity.status_display_type, 0);
  assert.deepEqual(activity.timestamps, {
    start: 1_699_999_940,
    end: 1_700_000_180
  });
});

test("buildActivity can use the artist for the compact Discord activity label", () => {
  const activity = buildActivity(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Song",
      artist: "Artist",
      playbackStatus: "Playing"
    },
    {
      ...baseConfig,
      activityNameTemplate: "{artist}"
    }
  );

  assert.equal(activity.name, "Artist");
});

test("buildActivity clears paused tracks by default", () => {
  const activity = buildActivity(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Song",
      artist: "Artist",
      playbackStatus: "Paused"
    },
    baseConfig
  );

  assert.equal(activity, null);
});

test("buildActivity can show paused tracks when configured", () => {
  const activity = buildActivity(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Song",
      artist: "Artist",
      playbackStatus: "Paused"
    },
    { ...baseConfig, showPaused: true }
  );

  assert.equal(activity.details, "Song");
  assert.equal(activity.state, "Artist");
  assert.equal(activity.timestamps, undefined);
});

test("getDisplayValues separates Apple Music artist and album when Windows combines them", () => {
  const values = getDisplayValues(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Money Trees",
      artist: "Kendrick Lamar \u2014 good kid, m.A.A.d city (Deluxe)",
      albumTitle: "",
      playbackStatus: "Playing"
    },
    baseConfig
  );

  assert.equal(values.artist, "Kendrick Lamar");
  assert.equal(values.album, "good kid, m.A.A.d city (Deluxe)");
  assert.equal(values.player, "Apple Music");
});

test("getDisplayValues handles plain hyphen Apple Music separators", () => {
  const values = getDisplayValues(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Money Trees",
      artist: "Kendrick Lamar - good kid, m.A.A.d city (Deluxe)",
      albumTitle: "",
      playbackStatus: "Playing"
    },
    baseConfig
  );

  assert.equal(values.artist, "Kendrick Lamar");
  assert.equal(values.album, "good kid, m.A.A.d city (Deluxe)");
});

test("buildActivity uses album-specific uploaded asset keys", () => {
  const activity = buildActivity(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Let It Happen",
      artist: "Tame Impala - Currents",
      albumTitle: "",
      playbackStatus: "Playing"
    },
    {
      ...baseConfig,
      albumImageKeys: {
        "Tame Impala - Currents": "currents"
      }
    }
  );

  assert.equal(activity.assets.large_image, "currents");
  assert.equal(activity.assets.large_text, "Currents");
});

test("getLargeImageKey falls back to static image key", () => {
  assert.equal(
    getLargeImageKey(
      {
        artist: "Unknown Artist",
        album: "Unknown Album",
        title: "Unknown Song"
      },
      {
        albumImageKeys: {
          "Tame Impala - Currents": "currents"
        },
        largeImageKey: "apple-music"
      }
    ),
    "apple-music"
  );
});

test("buildActivity can use automatic external artwork URLs", () => {
  const activity = buildActivity(
    {
      sourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
      title: "Let It Happen",
      artist: "Tame Impala - Currents",
      albumTitle: "",
      playbackStatus: "Playing",
      artworkUrl: "https://example.com/currents.jpg"
    },
    {
      ...baseConfig,
      artworkMode: "itunes"
    }
  );

  assert.equal(activity.assets.large_image, "https://example.com/currents.jpg");
});
