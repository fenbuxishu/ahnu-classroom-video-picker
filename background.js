const activeDownloads = new Map();

const HISTORY_KEY = "ahnuDownloadHistoryV1";
const ACTIVE_KEY = "ahnuActiveDownloadsV1";
const IGNORED_KEY = "ahnuIgnoredDownloadHistoryV1";

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

const normalizeVideoUrl = (value) => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
};

const readObject = async (key) => {
  const result = await chrome.storage.local.get(key);
  const value = result[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const writeObject = (key, value) => chrome.storage.local.set({ [key]: value });

const updateHistory = async (key, patch) => {
  const history = await readObject(HISTORY_KEY);
  history[key] = { ...(history[key] || {}), key, ...patch };
  await writeObject(HISTORY_KEY, history);
  return history[key];
};

const rememberActive = async (downloadId, record) => {
  activeDownloads.set(downloadId, record);
  const active = await readObject(ACTIVE_KEY);
  active[String(downloadId)] = record;
  await writeObject(ACTIVE_KEY, active);
};

const forgetActive = async (downloadId) => {
  activeDownloads.delete(downloadId);
  const active = await readObject(ACTIVE_KEY);
  delete active[String(downloadId)];
  await writeObject(ACTIVE_KEY, active);
};

const findTrackedDownload = async (downloadId) => {
  const inMemory = activeDownloads.get(downloadId);
  if (inMemory) return inMemory;
  const active = await readObject(ACTIVE_KEY);
  const stored = active[String(downloadId)];
  if (stored) activeDownloads.set(downloadId, stored);
  return stored || null;
};

const clearIgnoredFlag = async (key) => {
  const ignored = await readObject(IGNORED_KEY);
  if (!ignored[key]) return;
  delete ignored[key];
  await writeObject(IGNORED_KEY, ignored);
};

const getDownloadHistory = async (videos) => {
  const [history, ignored, completedItems] = await Promise.all([
    readObject(HISTORY_KEY),
    readObject(IGNORED_KEY),
    chrome.downloads.search({ state: "complete" })
  ]);
  const completedByUrl = new Map();

  for (const item of completedItems) {
    if (item.exists === false) continue;
    for (const candidate of [item.finalUrl, item.url]) {
      const normalizedUrl = normalizeVideoUrl(candidate);
      if (normalizedUrl && !completedByUrl.has(normalizedUrl)) {
        completedByUrl.set(normalizedUrl, item);
      }
    }
  }

  const records = {};
  let changed = false;
  for (const video of videos) {
    if (!video?.key) continue;
    const stored = history[video.key];
    if (stored?.state === "complete") {
      records[video.key] = stored;
      continue;
    }
    if (ignored[video.key]) continue;

    const normalizedUrl = normalizeVideoUrl(video.url);
    const matched = completedByUrl.get(normalizedUrl);
    if (!matched) continue;

    const record = {
      key: video.key,
      state: "complete",
      normalizedUrl,
      filename: matched.filename || "",
      downloadId: matched.id,
      startedAt: matched.startTime || null,
      completedAt: matched.endTime || matched.startTime || new Date().toISOString(),
      imported: true
    };
    history[video.key] = record;
    records[video.key] = record;
    changed = true;
  }

  if (changed) await writeObject(HISTORY_KEY, history);
  return records;
};

const clearDownloadHistory = async (keys) => {
  const [history, ignored] = await Promise.all([
    readObject(HISTORY_KEY),
    readObject(IGNORED_KEY)
  ]);
  let cleared = 0;
  for (const key of keys) {
    if (history[key]?.state === "complete") cleared += 1;
    delete history[key];
    ignored[key] = true;
  }
  await Promise.all([
    writeObject(HISTORY_KEY, history),
    writeObject(IGNORED_KEY, ignored)
  ]);
  return cleared;
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
  if (message?.type === "AHNU_GET_DOWNLOAD_HISTORY") {
    const videos = Array.isArray(message.videos) ? message.videos : [];
    getDownloadHistory(videos)
      .then((records) => sendResponse({ records }))
      .catch((error) =>
        sendResponse({
          records: {},
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message?.type === "AHNU_CLEAR_DOWNLOAD_HISTORY") {
    const keys = Array.isArray(message.keys) ? message.keys.filter(Boolean) : [];
    clearDownloadHistory(keys)
      .then((cleared) => sendResponse({ ok: true, cleared }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type !== "AHNU_DOWNLOAD_SELECTED") return undefined;

  const videos = Array.isArray(message.videos) ? message.videos : [];
  const tabId = sender.tab?.id;

  (async () => {
    const results = [];
    for (const video of videos) {
      try {
        const filename = buildFilename(video);
        const downloadId = await chrome.downloads.download({
          url: video.url,
          filename,
          conflictAction: "uniquify",
          saveAs: false
        });
        const record = {
          tabId,
          key: video.key,
          normalizedUrl: normalizeVideoUrl(video.url),
          filename,
          downloadId,
          startedAt: new Date().toISOString()
        };
        await Promise.all([
          rememberActive(downloadId, record),
          clearIgnoredFlag(video.key),
          updateHistory(video.key, { ...record, state: "in_progress" })
        ]);
        results.push({ key: video.key, ok: true, downloadId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await updateHistory(video.key, {
          state: "interrupted",
          normalizedUrl: normalizeVideoUrl(video.url),
          error: errorMessage
        });
        results.push({ key: video.key, ok: false, error: errorMessage });
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    sendResponse({ results });
  })();

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  (async () => {
    const tracked = await findTrackedDownload(delta.id);
    if (!tracked) return;

    const state = delta.state?.current;
    const error = delta.error?.current;
    if (!state && !error) return;

    const nextState = error ? "interrupted" : state;
    const patch = { state: nextState, error: error || null };
    if (nextState === "complete") patch.completedAt = new Date().toISOString();
    const historyRecord = await updateHistory(tracked.key, patch);

    if (tracked.tabId) {
      chrome.tabs
        .sendMessage(tracked.tabId, {
          type: "AHNU_DOWNLOAD_EVENT",
          key: tracked.key,
          state: nextState,
          error: error || null,
          record: historyRecord
        })
        .catch(() => {});
    }

    if (nextState === "complete" || nextState === "interrupted" || error) {
      await forgetActive(delta.id);
    }
  })().catch(() => {});
});
