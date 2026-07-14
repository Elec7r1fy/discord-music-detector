import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchUrl,
  chooseBestResult,
  resolveArtworkUrl,
  scoreResult,
  upscaleArtworkUrl
} from "../src/artworkProvider.js";

const baseConfig = {
  artworkMode: "itunes",
  artworkCountry: "US",
  artworkSize: 600,
  artworkCacheTtlMs: 60000,
  artworkSearchLimit: 5
};

test("buildSearchUrl creates an Apple music search URL", () => {
  const url = buildSearchUrl(
    {
      artist: "Tame Impala",
      title: "Let It Happen"
    },
    baseConfig
  );

  assert.equal(url.origin, "https://itunes.apple.com");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("term"), "Tame Impala Let It Happen");
  assert.equal(url.searchParams.get("media"), "music");
  assert.equal(url.searchParams.get("entity"), "song");
});

test("chooseBestResult prefers matching title and artist", () => {
  const result = chooseBestResult(
    [
      {
        trackName: "Wrong Song",
        artistName: "Tame Impala",
        collectionName: "Currents",
        artworkUrl100: "https://example.com/wrong/100x100bb.jpg"
      },
      {
        trackName: "Let It Happen",
        artistName: "Tame Impala",
        collectionName: "Currents",
        artworkUrl100: "https://example.com/right/100x100bb.jpg"
      }
    ],
    {
      artist: "Tame Impala",
      title: "Let It Happen",
      album: "Currents"
    }
  );

  assert.equal(result.artworkUrl100, "https://example.com/right/100x100bb.jpg");
});

test("scoreResult tolerates feature text in titles", () => {
  assert.ok(
    scoreResult(
      {
        trackName: "Money Trees",
        artistName: "Kendrick Lamar",
        collectionName: "good kid, m.A.A.d city"
      },
      {
        title: "Money Trees (feat. Jay Rock)",
        artist: "Kendrick Lamar",
        album: "good kid, m.A.A.d city"
      }
    ) >= 10
  );
});

test("upscaleArtworkUrl replaces Apple artwork dimensions", () => {
  assert.equal(
    upscaleArtworkUrl("https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/100x100bb.jpg", 1200),
    "https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/1200x1200bb.jpg"
  );
});

test("resolveArtworkUrl uses fetch and returns an upscaled URL", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      results: [
        {
          trackName: "Let It Happen",
          artistName: "Tame Impala",
          collectionName: "Currents",
          artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/100x100bb.jpg"
        }
      ]
    })
  });

  const url = await resolveArtworkUrl(
    {
      artist: "Tame Impala",
      title: "Let It Happen",
      album: "Currents"
    },
    baseConfig,
    console,
    fetchImpl
  );

  assert.equal(url, "https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/600x600bb.jpg");
});
