import { normalizeText, truncateDiscordText } from "./activity.js";
import { cleanYouTubeTitle, cleanWebTitle } from "./foregroundRules.js";

const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$/i;

export async function enhanceForegroundActivityWithBrowser(activity, windowInfo, config, logger = console) {
  if (!activity || !config.foregroundBrowserInspectorEnabled) {
    return activity;
  }

  if (!isYouTubeWindow(windowInfo)) {
    return activity;
  }

  const tab = await findActiveBrowserTab(windowInfo, config, logger);
  if (!tab) {
    return activity;
  }

  const videoState = await readYouTubeVideoState(tab, logger);
  if (!videoState?.url) {
    return activity;
  }

  const enhanced = structuredClone(activity);
  const title = normalizeText(videoState.title) || cleanYouTubeTitle(windowInfo.title);

  if (title) {
    enhanced.state = truncateDiscordText(title);
  }

  if (config.foregroundYouTubeTimestamps) {
    const timestamps = buildVideoTimestamps(videoState);
    if (timestamps) {
      enhanced.timestamps = timestamps;
    }
  }

  if (config.foregroundYouTubeButtons) {
    enhanced.buttons = [
      {
        label: "Watch on YouTube",
        url: videoState.url
      }
    ];
  }

  return enhanced;
}

export async function findActiveBrowserTab(windowInfo, config, logger = console, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    logger.debug?.("Browser inspector needs fetch().");
    return null;
  }

  const ports = config.foregroundBrowserDebuggingPorts ?? [];
  for (const port of ports) {
    const tabs = await fetchDebuggingTabs(port, fetchImpl, logger);
    const tab = matchBrowserTab(windowInfo, tabs);
    if (tab) {
      return tab;
    }
  }

  return null;
}

export async function fetchDebuggingTabs(port, fetchImpl = globalThis.fetch, logger = console) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(800)
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    logger.debug?.(`No browser debugging endpoint on port ${port}: ${error.message}`);
    return [];
  }
}

export function matchBrowserTab(windowInfo, tabs) {
  const windowTitle = normalizeForMatch(cleanWebTitle(windowInfo?.title));
  const youtubeTabs = tabs.filter((tab) => isYouTubeUrl(tab.url));

  if (!youtubeTabs.length) {
    return null;
  }

  return youtubeTabs.find((tab) => {
    const tabTitle = normalizeForMatch(cleanWebTitle(tab.title));
    return tabTitle && (windowTitle.includes(tabTitle) || tabTitle.includes(windowTitle));
  }) ?? youtubeTabs[0];
}

export async function readYouTubeVideoState(tab, logger = console) {
  if (!tab.webSocketDebuggerUrl || typeof WebSocket !== "function") {
    logger.debug?.("Browser tab has no WebSocket debugger URL, or this Node runtime has no WebSocket.");
    return null;
  }

  try {
    const result = await evaluateInTab(tab.webSocketDebuggerUrl, `
      (() => {
        const video = document.querySelector('video');
        const canonical = document.querySelector('link[rel="canonical"]')?.href;
        return {
          url: canonical || location.href,
          title: document.title.replace(/\\s+-\\s+YouTube$/, ''),
          currentTime: video ? video.currentTime : null,
          duration: video ? video.duration : null,
          paused: video ? video.paused : null,
          playbackRate: video ? video.playbackRate : 1
        };
      })()
    `);

    return normalizeVideoState(result?.result?.value);
  } catch (error) {
    logger.debug?.(`Could not read YouTube video state: ${error.message}`);
    return null;
  }
}

export function buildVideoTimestamps(videoState, nowMs = Date.now()) {
  const currentTime = Number(videoState?.currentTime);
  const duration = Number(videoState?.duration);
  const playbackRate = Number(videoState?.playbackRate) || 1;

  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  if (videoState.paused) {
    return null;
  }

  const adjustedCurrentMs = (currentTime * 1000) / playbackRate;
  const adjustedRemainingMs = ((duration - currentTime) * 1000) / playbackRate;
  const start = Math.floor((nowMs - adjustedCurrentMs) / 1000);
  const end = Math.floor((nowMs + adjustedRemainingMs) / 1000);

  if (end <= start) {
    return null;
  }

  return { start, end };
}

export function isYouTubeWindow(windowInfo) {
  const processName = normalizeText(windowInfo?.processName).toLowerCase();
  const title = normalizeText(windowInfo?.title).toLowerCase();
  return ["chrome", "msedge", "brave", "firefox"].includes(processName) && title.includes("youtube");
}

export function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return YOUTUBE_HOST_RE.test(url.hostname) && (url.pathname === "/watch" || url.pathname.startsWith("/shorts/"));
  } catch {
    return false;
  }
}

export function normalizeVideoState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const url = normalizeText(value.url);
  if (!isYouTubeUrl(url)) {
    return null;
  }

  return {
    url,
    title: normalizeText(value.title),
    currentTime: Number(value.currentTime),
    duration: Number(value.duration),
    paused: Boolean(value.paused),
    playbackRate: Number(value.playbackRate) || 1
  };
}

async function evaluateInTab(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      reject(new Error("Timed out waiting for browser evaluation."));
    }, 1500);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression,
          returnByValue: true,
          awaitPromise: false
        }
      }));
    });

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.id !== id) {
        return;
      }

      clearTimeout(timeout);
      ws.close();

      if (message.error) {
        reject(new Error(message.error.message ?? "Browser evaluation failed."));
      } else {
        resolve(message);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Browser debugger WebSocket failed."));
    });
  });
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
