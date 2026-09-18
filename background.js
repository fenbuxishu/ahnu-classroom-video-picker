const activeDownloads = new Map();

const sanitizeSegment = (value, fallback = "未命名") => {
  const text = String(value ?? "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (text || fallback).slice(0, 100);
};

const pad = (value) => String(value).padStart(2, "0");

const buildFilename = (video) => {
  const dateTime = String(video.beginTime || "未知时间")
    .replace(/:/g, "-")
    .replace(" ", "_");
  const lessonFolder = [
    `${pad(video.lessonIndex)}_${sanitizeSegment(dateTime)}`,
    video.lessonNumber == null ? "" : `第${video.lessonNumber}节`
  ]
    .filter(Boolean)
    .join("_");
  const cameraName = sanitizeSegment(video.cameraName || video.category, "相机");
  const suffix = video.viewNum == null ? "" : `_视角${video.viewNum}`;
  return [
    "课堂实录",
    sanitizeSegment(video.courseName, "课程"),
    sanitizeSegment(lessonFolder, `第${video.lessonIndex}课次`),
    `${cameraName}${suffix}.mp4`
  ].join("/");
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://mlb.ahnu.edu.cn/")) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "AHNU_TOGGLE_PANEL" });
  } catch {
    // The content script may not be ready while the page is navigating.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "AHNU_DOWNLOAD_SELECTED") return undefined;

  const videos = Array.isArray(message.videos) ? message.videos : [];
  const tabId = sender.tab?.id;

  (async () => {
    const results = [];
    for (const video of videos) {
      try {
        const downloadId = await chrome.downloads.download({
          url: video.url,
          filename: buildFilename(video),
          conflictAction: "uniquify",
          saveAs: false
        });
        activeDownloads.set(downloadId, { tabId, key: video.key });
        results.push({ key: video.key, ok: true, downloadId });
      } catch (error) {
        results.push({
          key: video.key,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    sendResponse({ results });
  })();

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  const tracked = activeDownloads.get(delta.id);
  if (!tracked) return;

  const state = delta.state?.current;
  const error = delta.error?.current;
  if (!state && !error) return;

  if (tracked.tabId) {
    chrome.tabs
      .sendMessage(tracked.tabId, {
        type: "AHNU_DOWNLOAD_EVENT",
        key: tracked.key,
        state: error ? "interrupted" : state,
        error: error || null
      })
      .catch(() => {});
  }

  if (state === "complete" || state === "interrupted" || error) {
    activeDownloads.delete(delta.id);
  }
});
