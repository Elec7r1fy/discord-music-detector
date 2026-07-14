import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForegroundActivity,
  cleanWebTitle,
  findMatchingRule
} from "../src/foregroundRules.js";

const config = {
  foregroundPrimaryMonitorOnly: true,
  foregroundShowUnknownApps: false,
  foregroundRules: [
    {
      processNames: ["codex"],
      name: "Codex",
      type: 0,
      details: "Talking to Codex"
    },
    {
      processNames: ["chrome"],
      titleIncludes: ["youtube"],
      name: "YouTube",
      type: 3,
      details: "Watching YouTube",
      stateTemplate: "{webTitle}"
    }
  ]
};

test("buildForegroundActivity creates a Codex activity from a whitelisted process", () => {
  const activity = buildForegroundActivity(
    {
      processName: "Codex",
      title: "Codex",
      monitor: {
        isPrimary: true
      }
    },
    config
  );

  assert.equal(activity.name, "Codex");
  assert.equal(activity.details, "Talking to Codex");
});

test("buildForegroundActivity creates a YouTube watching activity with cleaned title", () => {
  const activity = buildForegroundActivity(
    {
      processName: "chrome",
      title: "A Good Video - YouTube - Google Chrome",
      monitor: {
        isPrimary: true
      }
    },
    config
  );

  assert.equal(activity.name, "YouTube");
  assert.equal(activity.type, 3);
  assert.equal(activity.details, "Watching YouTube");
  assert.equal(activity.state, "A Good Video");
});

test("buildForegroundActivity strips browser notification counts from YouTube titles", () => {
  const activity = buildForegroundActivity(
    {
      processName: "chrome",
      title: "(4677) YouTube - Google Chrome",
      monitor: {
        isPrimary: true
      }
    },
    {
      ...config,
      foregroundRules: [
        {
          processNames: ["chrome"],
          titleIncludes: ["youtube"],
          name: "YouTube",
          type: 3,
          details: "Watching YouTube",
          stateTemplate: "{youtubeTitle}",
          statusDisplayType: 2,
          largeImage: "https://www.google.com/s2/favicons?domain=youtube.com&sz=256",
          largeText: "YouTube"
        }
      ]
    }
  );

  assert.equal(activity.details, "Watching YouTube");
  assert.equal(activity.state, undefined);
  assert.equal(activity.assets.large_image, "https://www.google.com/s2/favicons?domain=youtube.com&sz=256");
});

test("buildForegroundActivity clears unknown apps by default", () => {
  assert.equal(
    buildForegroundActivity(
      {
        processName: "secret-notes",
        title: "Private draft",
        monitor: {
          isPrimary: true
        }
      },
      config
    ),
    null
  );
});

test("buildForegroundActivity ignores non-primary monitor when configured", () => {
  assert.equal(
    buildForegroundActivity(
      {
        processName: "Codex",
        title: "Codex",
        monitor: {
          isPrimary: false
        }
      },
      config
    ),
    null
  );
});

test("findMatchingRule matches title includes", () => {
  const rule = findMatchingRule(
    {
      processName: "chrome",
      title: "Music Video - YouTube - Google Chrome"
    },
    config.foregroundRules
  );

  assert.equal(rule.name, "YouTube");
});

test("cleanWebTitle removes browser suffixes", () => {
  assert.equal(cleanWebTitle("Video Title - YouTube - Microsoft Edge"), "Video Title");
});
