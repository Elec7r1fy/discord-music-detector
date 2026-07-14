import { normalizeText, truncateDiscordText } from "./activity.js";

export function buildForegroundActivity(windowInfo, config) {
  if (!windowInfo) {
    return null;
  }

  if (config.foregroundPrimaryMonitorOnly && !windowInfo.monitor?.isPrimary) {
    return null;
  }

  const rule = findMatchingRule(windowInfo, config.foregroundRules);
  if (!rule && !config.foregroundShowUnknownApps) {
    return null;
  }

  const values = buildWindowValues(windowInfo);
  const activityRule = rule ?? {
    name: values.app,
    type: 0,
    details: "Using {app}"
  };

  const activity = {
    name: truncateDiscordText(renderRuleTemplate(activityRule.name ?? "{app}", values)),
    type: Number.isInteger(activityRule.type) ? activityRule.type : 0,
    details: truncateDiscordText(renderRuleTemplate(activityRule.details ?? "Using {app}", values)),
    state: truncateDiscordText(renderRuleTemplate(activityRule.stateTemplate ?? "", values)),
    status_display_type: Number.isInteger(activityRule.statusDisplayType) ? activityRule.statusDisplayType : 1,
    instance: false
  };

  if (!activity.state) {
    delete activity.state;
  }

  const largeImage = renderRuleTemplate(activityRule.largeImage ?? "", values);
  const largeText = renderRuleTemplate(activityRule.largeText ?? "{name}", {
    ...values,
    name: activity.name
  });
  const smallImage = renderRuleTemplate(activityRule.smallImage ?? "", values);
  const smallText = renderRuleTemplate(activityRule.smallText ?? "", values);

  if (largeImage || smallImage) {
    activity.assets = {};

    if (largeImage) {
      activity.assets.large_image = largeImage;
      activity.assets.large_text = truncateDiscordText(largeText || activity.name);
    }

    if (smallImage) {
      activity.assets.small_image = smallImage;
      activity.assets.small_text = truncateDiscordText(smallText || activity.name);
    }
  }

  return activity;
}

export function findMatchingRule(windowInfo, rules = []) {
  return rules.find((rule) => ruleMatches(windowInfo, rule)) ?? null;
}

export function ruleMatches(windowInfo, rule) {
  const processName = normalizeText(windowInfo.processName).toLowerCase();
  const title = normalizeText(windowInfo.title).toLowerCase();
  const processNames = normalizeList(rule.processNames);
  const titleIncludes = normalizeList(rule.titleIncludes);
  const titleExcludes = normalizeList(rule.titleExcludes);

  if (processNames.length && !processNames.includes(processName)) {
    return false;
  }

  if (titleIncludes.length && !titleIncludes.some((part) => title.includes(part))) {
    return false;
  }

  if (titleExcludes.length && titleExcludes.some((part) => title.includes(part))) {
    return false;
  }

  return true;
}

export function buildWindowValues(windowInfo) {
  const processName = normalizeText(windowInfo.processName);
  const title = normalizeText(windowInfo.title);
  const app = toDisplayAppName(processName);
  const webTitle = cleanWebTitle(title);
  const youtubeTitle = cleanYouTubeTitle(title);
  const amazonTitle = cleanAmazonTitle(title);
  const steamTitle = cleanSteamTitle(title);

  return {
    app,
    process: processName,
    title,
    webTitle: webTitle || title || app,
    youtubeTitle,
    amazonTitle,
    steamTitle,
    steamActivity: steamTitle ? "Browsing Steam" : "Browsing Steam"
  };
}

export function cleanWebTitle(title) {
  return normalizeText(title)
    .replace(/^\(\d+\)\s+/, "")
    .replace(/\s+-\s+YouTube\s+-\s+(Google Chrome|Microsoft Edge|Brave|Mozilla Firefox)$/i, "")
    .replace(/\s+-\s+(Google Chrome|Microsoft Edge|Brave|Mozilla Firefox)$/i, "")
    .replace(/\s+-\s+YouTube$/i, "");
}

export function cleanYouTubeTitle(title) {
  const cleaned = cleanWebTitle(title).replace(/\s+-\s+YouTube$/i, "").trim();
  return /^youtube$/i.test(cleaned) ? "" : cleaned;
}

export function cleanAmazonTitle(title) {
  const cleaned = cleanWebTitle(title)
    .replace(/\s*:\s*Amazon\.in.*$/i, "")
    .replace(/\s+-\s+Amazon\.in.*$/i, "")
    .replace(/\s+-\s+Amazon.*$/i, "")
    .trim();

  return /^amazon(\.in)?$/i.test(cleaned) ? "" : cleaned;
}

export function cleanSteamTitle(title) {
  const cleaned = normalizeText(title)
    .replace(/\s+-\s+Steam$/i, "")
    .replace(/^Steam\s+-\s+/i, "")
    .trim();

  return /^steam$/i.test(cleaned) ? "" : cleaned;
}

function renderRuleTemplate(template, values) {
  return normalizeText(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    normalizeText(values[key])
  );
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item).toLowerCase()).filter(Boolean) : [];
}

function toDisplayAppName(processName) {
  const known = {
    chrome: "Chrome",
    msedge: "Microsoft Edge",
    brave: "Brave",
    firefox: "Firefox",
    codex: "Codex",
    steam: "Steam"
  };

  return known[processName.toLowerCase()] ?? processName;
}
