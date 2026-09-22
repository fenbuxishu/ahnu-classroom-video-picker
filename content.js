(() => {
  "use strict";

  if (window.__AHNU_VIDEO_PICKER_INSTALLED__) return;
  window.__AHNU_VIDEO_PICKER_INSTALLED__ = true;

  const state = {
    open: false,
    loading: false,
    loadedCourseKey: "",
    courseName: "",
    lessons: [],
    videos: new Map(),
    selected: new Set(),
    errors: [],
    downloadStates: new Map(),
    downloadHistory: new Map(),
    loadToken: 0
  };

  const viewNames = {
    1: "教师相机1",
    2: "教师相机2",
    3: "学生相机1",
    4: "学生相机2"
  };

  const host = document.createElement("div");
  host.id = "ahnu-video-picker";
  host.innerHTML = `
    <button class="avp-launcher" type="button" title="总览并下载课堂实录视频">
      <span class="avp-launcher-icon">▶</span>
      <span>视频总览</span>
    </button>
    <section class="avp-panel" aria-label="课堂实录视频选择器" aria-hidden="true">
      <header class="avp-header">
        <div>
          <div class="avp-eyebrow">课堂实录视频选择器</div>
          <h2 class="avp-title">本课程视频总览</h2>
          <p class="avp-subtitle">读取课次后，可按相机视角勾选下载</p>
        </div>
        <button class="avp-icon-button avp-close" type="button" title="收起">×</button>
      </header>
      <div class="avp-toolbar">
        <div class="avp-summary">尚未读取课程</div>
        <button class="avp-secondary avp-refresh" type="button">重新读取</button>
      </div>
      <div class="avp-filterbar" hidden>
        <label><input class="avp-select-all" type="checkbox"> 全选未下载</label>
        <button class="avp-chip avp-select-teacher" type="button">选教师相机</button>
        <button class="avp-chip avp-select-student" type="button">选学生相机</button>
        <button class="avp-chip avp-clear" type="button">清空</button>
        <button class="avp-chip avp-clear-history" type="button" title="只清除当前课程的已下载提示，不删除视频文件">清除下载标记</button>
      </div>
      <main class="avp-body">
        <div class="avp-empty">
          <div class="avp-empty-icon">▦</div>
          <strong>打开具体课程的课堂实录页面</strong>
          <span>插件会在这里汇总所有课次与相机视角。</span>
        </div>
      </main>
      <footer class="avp-footer">
        <div class="avp-footer-note">视频链接会在读取时获取，避免使用过期地址。</div>
        <button class="avp-download" type="button" disabled>下载已选视频</button>
      </footer>
    </section>
  `;
  document.documentElement.appendChild(host);

  const $ = (selector) => host.querySelector(selector);
  const elements = {
    launcher: $(".avp-launcher"),
    panel: $(".avp-panel"),
    close: $(".avp-close"),
    title: $(".avp-title"),
    subtitle: $(".avp-subtitle"),
    summary: $(".avp-summary"),
    refresh: $(".avp-refresh"),
    filterbar: $(".avp-filterbar"),
    selectAll: $(".avp-select-all"),
    selectTeacher: $(".avp-select-teacher"),
    selectStudent: $(".avp-select-student"),
    clear: $(".avp-clear"),
    clearHistory: $(".avp-clear-history"),
    body: $(".avp-body"),
    footerNote: $(".avp-footer-note"),
    download: $(".avp-download")
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  const pageParams = () => {
    const query = location.hash.includes("?")
      ? location.hash.slice(location.hash.indexOf("?") + 1)
      : "";
    return new URLSearchParams(query);
  };

  const isCoursePage = () =>
    location.hostname === "mlb.ahnu.edu.cn" &&
    location.hash.includes("/play-center") &&
    Boolean(pageParams().get("teclId"));

  const courseKey = () => {
    const params = pageParams();
    return [params.get("teclId"), params.get("subjId"), params.get("teclCode")].join("|");
  };

  const fetchJson = async (url, retries = 4) => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json, text/plain, */*" },
          cache: "no-store"
        });
        const payload = await response.json();
        const message = payload?.message || "";
        const retryable =
          response.status === 429 ||
          response.status === 503 ||
          /请求过于频繁|稍后再试|too many requests/i.test(message);
        if (retryable && attempt < retries) {
          await sleep(700 * 2 ** attempt);
          continue;
        }
        if (!response.ok) throw new Error(`接口请求失败（HTTP ${response.status}）`);
        if (payload && (payload.ok === false || Number(payload.status) >= 400)) {
          throw new Error(message || "接口返回失败");
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt >= retries) break;
        await sleep(700 * 2 ** attempt);
      }
    }
    throw lastError || new Error("接口请求失败");
  };

  const formatDuration = (seconds) => {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return "时长未知";
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remain = Math.floor(total % 60);
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`
      : `${minutes}:${String(remain).padStart(2, "0")}`;
  };

  const formatBytes = (bytes) => {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return "大小待获取";
    const units = ["B", "KB", "MB", "GB"];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(unitIndex >= 2 ? 1 : 0)} ${units[unitIndex]}`;
  };

  const readableDate = (value) => {
    const text = String(value || "");
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : text || "时间未知";
  };

  const readableCompletedAt = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  };

  const isDownloaded = (key) => state.downloadStates.get(key) === "complete";

  const downloadedCount = () =>
    [...state.videos.keys()].filter((key) => isDownloaded(key)).length;

  const showPanel = (visible) => {
    state.open = visible;
    elements.panel.classList.toggle("is-open", visible);
    elements.panel.setAttribute("aria-hidden", String(!visible));
    elements.launcher.classList.toggle("is-hidden", visible);
    if (visible && isCoursePage() && state.loadedCourseKey !== courseKey() && !state.loading) {
      loadCourse();
    }
  };

  const setLoadingView = (message, detail = "正在连接课堂实录服务") => {
    elements.body.innerHTML = `
      <div class="avp-loading">
        <span class="avp-spinner"></span>
        <strong>${escapeHtml(message)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
    `;
  };

  const setErrorView = (message) => {
    elements.body.innerHTML = `
      <div class="avp-error">
        <strong>读取失败</strong>
        <span>${escapeHtml(message)}</span>
        <button class="avp-secondary avp-error-retry" type="button">重试</button>
      </div>
    `;
    elements.body.querySelector(".avp-error-retry")?.addEventListener("click", loadCourse);
  };

  const updateSelectionUi = () => {
    const total = state.videos.size;
    const selected = state.selected.size;
    const completed = downloadedCount();
    const pendingKeys = [...state.videos.keys()].filter((key) => !isDownloaded(key));
    const selectedPending = pendingKeys.filter((key) => state.selected.has(key)).length;
    const totalBytes = [...state.selected]
      .map((key) => state.videos.get(key)?.sizeBytes || 0)
      .reduce((sum, value) => sum + value, 0);
    const knownSizes = [...state.selected].every(
      (key) => Number(state.videos.get(key)?.sizeBytes) > 0
    );

    elements.selectAll.checked = pendingKeys.length > 0 && selectedPending === pendingKeys.length;
    elements.selectAll.indeterminate = selectedPending > 0 && selectedPending < pendingKeys.length;
    elements.selectAll.disabled = pendingKeys.length === 0;
    elements.download.disabled = selected === 0 || state.loading;
    elements.download.textContent = selected ? `下载已选 ${selected} 个视频` : "下载已选视频";
    elements.footerNote.textContent = selected
      ? `已选 ${selected}/${total} 个${knownSizes ? `，约 ${formatBytes(totalBytes)}` : ""}`
      : completed
        ? `已下载 ${completed}/${total} 个；批量选择会自动跳过这些视频。`
        : "视频会保存到“下载/课堂实录/课程名”文件夹。";

    host.querySelectorAll(".avp-video-checkbox").forEach((checkbox) => {
      checkbox.checked = state.selected.has(checkbox.dataset.key);
    });
    host.querySelectorAll(".avp-lesson-checkbox").forEach((checkbox) => {
      const keys = checkbox.dataset.keys.split(",").filter(Boolean);
      const count = keys.filter((key) => state.selected.has(key)).length;
      checkbox.checked = keys.length > 0 && count === keys.length;
      checkbox.indeterminate = count > 0 && count < keys.length;
    });
  };

  const videoStatusLabel = (status) => {
    if (status === "in_progress") return "下载中";
    if (status === "complete") return "已下载";
    if (status === "interrupted") return "已中断";
    if (status === "queued") return "已加入";
    return "";
  };

  const renderLessons = () => {
    const cards = state.lessons
      .map((lesson) => {
        const videos = [...lesson.teacherCameras, ...lesson.studentCameras];
        const pendingVideos = videos.filter((video) => !isDownloaded(video.key));
        const keys = pendingVideos.map((video) => video.key).join(",");
        const completedInLesson = videos.length - pendingVideos.length;
        const rows = videos.length
          ? videos
              .map((video) => {
                const status = state.downloadStates.get(video.key) || "";
                const statusLabel = videoStatusLabel(status);
                const completedAt = readableCompletedAt(
                  state.downloadHistory.get(video.key)?.completedAt
                );
                const statusTitle = completedAt ? `完成于 ${completedAt}` : statusLabel;
                return `
                  <label class="avp-video-row ${status === "complete" ? "is-downloaded" : ""}" data-category="${escapeHtml(video.category)}">
                    <input class="avp-video-checkbox" type="checkbox" data-key="${escapeHtml(video.key)}">
                    <span class="avp-camera-icon ${video.category === "教师相机" ? "is-teacher" : "is-student"}">${video.category === "教师相机" ? "师" : "生"}</span>
                    <span class="avp-video-info">
                      <strong>${escapeHtml(video.cameraName)}</strong>
                      <small>${escapeHtml(video.category)} · 视角 ${escapeHtml(video.viewNum)} · ${formatDuration(video.durationSeconds)}</small>
                    </span>
                    <span class="avp-size" data-size-key="${escapeHtml(video.key)}">${formatBytes(video.sizeBytes)}</span>
                    ${statusLabel ? `<span class="avp-download-state is-${status}" title="${escapeHtml(statusTitle)}">${escapeHtml(statusLabel)}</span>` : ""}
                  </label>
                `;
              })
              .join("")
          : `<div class="avp-no-video">该课次没有可下载的教师/学生相机视频</div>`;

        return `
          <article class="avp-lesson-card">
            <div class="avp-lesson-head">
              <label class="avp-lesson-selector">
                <input class="avp-lesson-checkbox" type="checkbox" data-keys="${escapeHtml(keys)}" ${pendingVideos.length ? "" : "disabled"}>
                <span class="avp-lesson-index">${String(lesson.lessonIndex).padStart(2, "0")}</span>
              </label>
              <div class="avp-lesson-meta">
                <strong>${escapeHtml(readableDate(lesson.beginTime))}</strong>
                <span>${lesson.lessonNumber == null ? "" : `第${escapeHtml(lesson.lessonNumber)}节 · `}${escapeHtml(lesson.classroom || "教室未知")}</span>
              </div>
              <span class="avp-count">${videos.length} 个视角${completedInLesson ? ` · ${completedInLesson} 已下载` : ""}</span>
            </div>
            <div class="avp-video-list">${rows}</div>
            ${lesson.error ? `<div class="avp-lesson-error">${escapeHtml(lesson.error)}</div>` : ""}
          </article>
        `;
      })
      .join("");

    elements.body.innerHTML = `<div class="avp-lessons">${cards}</div>`;
    elements.filterbar.hidden = state.videos.size === 0;
    elements.title.textContent = state.courseName || "本课程视频总览";
    const completed = downloadedCount();
    elements.subtitle.textContent = `${state.lessons.length} 个课次 · ${state.videos.size} 个视角 · ${completed} 个已下载`;
    elements.summary.textContent = state.errors.length
      ? `已读取 ${state.lessons.length} 个课次，${state.errors.length} 个课次读取异常`
      : `已读取全部 ${state.lessons.length} 个课次 · 已下载 ${completed}/${state.videos.size}`;
    updateSelectionUi();
  };

  const makeVideo = (lesson, view) => {
    const viewNum = Number(view.viewNum);
    const key = `${lesson.courseId}:${view.vodId ?? viewNum}`;
    return {
      key,
      lessonIndex: lesson.lessonIndex,
      courseId: lesson.courseId,
      courseName: lesson.courseName,
      beginTime: lesson.beginTime,
      lessonNumber: lesson.lessonNumber,
      classroom: lesson.classroom,
      category: viewNum <= 2 ? "教师相机" : "学生相机",
      cameraName: viewNames[viewNum] || `相机${viewNum}`,
      viewNum,
      vodId: view.vodId ?? null,
      durationSeconds: view.vodTime ?? null,
      sizeBytes: null,
      url: view.url
    };
  };

  const probeSizes = async (videos, token) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < videos.length) {
        const video = videos[cursor++];
        try {
          const response = await fetch(video.url, { method: "HEAD", cache: "no-store" });
          if (token !== state.loadToken) return;
          const size = Number(response.headers.get("content-length"));
          if (Number.isFinite(size) && size > 0) {
            video.sizeBytes = size;
            const target = host.querySelector(`[data-size-key="${CSS.escape(video.key)}"]`);
            if (target) target.textContent = formatBytes(size);
            updateSelectionUi();
          }
        } catch {
          // A missing size must not block selection or download.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, videos.length) }, worker));
  };

  const restoreDownloadHistory = async (token) => {
    const videos = [...state.videos.values()].map(({ key, url }) => ({ key, url }));
    if (!videos.length) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AHNU_GET_DOWNLOAD_HISTORY",
        videos
      });
      if (token !== state.loadToken) return;
      for (const [key, record] of Object.entries(response?.records || {})) {
        if (record?.state !== "complete") continue;
        state.downloadStates.set(key, "complete");
        state.downloadHistory.set(key, record);
        state.selected.delete(key);
      }
    } catch {
      // History is a convenience feature; course browsing should still work without it.
    }
  };

  const loadCourse = async () => {
    if (!isCoursePage()) {
      elements.filterbar.hidden = true;
      elements.summary.textContent = "当前不是具体课程页面";
      setErrorView("请先打开“课堂实录”中的某一门课程，再使用视频总览。");
      return;
    }

    const token = ++state.loadToken;
    state.loading = true;
    state.selected.clear();
    state.videos.clear();
    state.lessons = [];
    state.errors = [];
    state.downloadStates.clear();
    state.downloadHistory.clear();
    elements.filterbar.hidden = true;
    elements.download.disabled = true;
    elements.refresh.disabled = true;
    setLoadingView("正在读取课次列表");

    try {
      const params = pageParams();
      const teclId = params.get("teclId");
      const listUrl = new URL(
        "/jy-application-resourcemanage/v1/subject_vod_list_new",
        location.origin
      );
      listUrl.searchParams.set("page.pageIndex", "1");
      listUrl.searchParams.set("page.pageSize", "1000");
      listUrl.searchParams.set("teclIds", teclId);
      listUrl.searchParams.set("page.orders[0].asc", "true");
      listUrl.searchParams.set("page.orders[0].field", "courBeginTime");
      listUrl.searchParams.set("schoolOpenStatusFlag", "false");

      const listPayload = await fetchJson(listUrl);
      if (token !== state.loadToken) return;
      const records = Array.isArray(listPayload?.data?.records)
        ? listPayload.data.records
        : [];
      if (!records.length) throw new Error("没有获取到课次，请确认页面已加载且账号有观看权限。");
      records.sort((a, b) =>
        String(a.courBeginTime || "").localeCompare(String(b.courBeginTime || ""))
      );

      for (let index = 0; index < records.length; index += 1) {
        if (token !== state.loadToken) return;
        const record = records[index];
        setLoadingView(
          `正在读取第 ${index + 1}/${records.length} 个课次`,
          readableDate(record.courBeginTime)
        );
        if (index > 0) await sleep(300);

        const lesson = {
          lessonIndex: index + 1,
          courseId: record.id,
          courseName: record.subjName || "",
          beginTime: record.courBeginTime || "",
          endTime: record.courEndTime || "",
          lessonNumber: record.letiNumber ?? null,
          classroom: record.clroName || "",
          teacherCameras: [],
          studentCameras: [],
          error: null
        };

        try {
          const detailUrl = new URL(
            "/jy-application-resourcemanage/v1/course_vod_urls_new",
            location.origin
          );
          detailUrl.searchParams.set("courseId", String(record.id));
          const detailPayload = await fetchJson(detailUrl);
          const detail = detailPayload?.data;
          if (!detail) throw new Error("没有视频详情");
          lesson.courseName = detail.courName || lesson.courseName;
          lesson.beginTime = lesson.beginTime || detail.courBeginTime || "";
          lesson.endTime = lesson.endTime || detail.courEndTime || "";
          lesson.lessonNumber = lesson.lessonNumber ?? detail.letiNumber ?? null;
          lesson.classroom = lesson.classroom || detail.classRoomName || "";
          const views = Array.isArray(detail.courseVodViewList)
            ? detail.courseVodViewList
            : [];
          for (const view of views) {
            const viewNum = Number(view.viewNum);
            if (![1, 2, 3, 4].includes(viewNum) || !view.url) continue;
            const video = makeVideo(lesson, view);
            state.videos.set(video.key, video);
            if (video.category === "教师相机") lesson.teacherCameras.push(video);
            else lesson.studentCameras.push(video);
          }
        } catch (error) {
          lesson.error = error instanceof Error ? error.message : String(error);
          state.errors.push({ courseId: lesson.courseId, error: lesson.error });
        }
        state.lessons.push(lesson);
      }

      if (token !== state.loadToken) return;
      state.courseName = state.lessons.find((lesson) => lesson.courseName)?.courseName || "本课程";
      state.loadedCourseKey = courseKey();
      setLoadingView("正在核对下载记录", "已下载的视频会自动标记");
      await restoreDownloadHistory(token);
      if (token !== state.loadToken) return;
      renderLessons();
      probeSizes([...state.videos.values()], token);
    } catch (error) {
      if (token !== state.loadToken) return;
      setErrorView(error instanceof Error ? error.message : String(error));
      elements.summary.textContent = "读取失败";
    } finally {
      if (token === state.loadToken) {
        state.loading = false;
        elements.refresh.disabled = false;
        updateSelectionUi();
      }
    }
  };

  const selectWhere = (predicate) => {
    for (const [key, video] of state.videos) {
      if (predicate(video) && !isDownloaded(key)) state.selected.add(key);
    }
    updateSelectionUi();
  };

  elements.launcher.addEventListener("click", () => showPanel(true));
  elements.close.addEventListener("click", () => showPanel(false));
  elements.refresh.addEventListener("click", loadCourse);
  elements.selectAll.addEventListener("change", (event) => {
    state.selected.clear();
    if (event.currentTarget.checked) {
      for (const key of state.videos.keys()) {
        if (!isDownloaded(key)) state.selected.add(key);
      }
    }
    updateSelectionUi();
  });
  elements.selectTeacher.addEventListener("click", () =>
    selectWhere((video) => video.category === "教师相机")
  );
  elements.selectStudent.addEventListener("click", () =>
    selectWhere((video) => video.category === "学生相机")
  );
  elements.clear.addEventListener("click", () => {
    state.selected.clear();
    updateSelectionUi();
  });
  elements.clearHistory.addEventListener("click", async () => {
    const keys = [...state.videos.keys()].filter((key) => isDownloaded(key));
    if (!keys.length) {
      elements.footerNote.textContent = "当前课程还没有已下载标记。";
      return;
    }
    const confirmed = window.confirm(
      `清除当前课程的 ${keys.length} 条下载标记？\n\n这不会删除已经下载的视频文件。`
    );
    if (!confirmed) return;

    elements.clearHistory.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AHNU_CLEAR_DOWNLOAD_HISTORY",
        keys
      });
      if (!response?.ok) throw new Error(response?.error || "清除失败");
      for (const key of keys) {
        state.downloadStates.delete(key);
        state.downloadHistory.delete(key);
      }
      renderLessons();
      elements.footerNote.textContent = `已清除 ${keys.length} 条下载标记，视频文件没有被删除。`;
    } catch (error) {
      elements.footerNote.textContent = `清除失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      elements.clearHistory.disabled = false;
    }
  });
  elements.body.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches(".avp-video-checkbox")) {
      if (target.checked) state.selected.add(target.dataset.key);
      else state.selected.delete(target.dataset.key);
      updateSelectionUi();
    }
    if (target.matches(".avp-lesson-checkbox")) {
      for (const key of target.dataset.keys.split(",").filter(Boolean)) {
        if (target.checked) state.selected.add(key);
        else state.selected.delete(key);
      }
      updateSelectionUi();
    }
  });
  elements.download.addEventListener("click", async () => {
    const videos = [...state.selected]
      .map((key) => state.videos.get(key))
      .filter(Boolean);
    if (!videos.length) return;

    elements.download.disabled = true;
    elements.download.textContent = "正在加入下载…";
    for (const video of videos) state.downloadStates.set(video.key, "queued");
    renderLessons();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "AHNU_DOWNLOAD_SELECTED",
        videos
      });
      for (const result of response?.results || []) {
        state.downloadStates.set(result.key, result.ok ? "in_progress" : "interrupted");
      }
      renderLessons();
      const failures = (response?.results || []).filter((item) => !item.ok).length;
      elements.footerNote.textContent = failures
        ? `${videos.length - failures} 个已开始，${failures} 个启动失败。`
        : `${videos.length} 个视频已交给 Chrome 下载。`;
    } catch (error) {
      for (const video of videos) state.downloadStates.set(video.key, "interrupted");
      renderLessons();
      elements.footerNote.textContent = `下载启动失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      updateSelectionUi();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "AHNU_TOGGLE_PANEL") {
      showPanel(!state.open);
    }
    if (message?.type === "AHNU_DOWNLOAD_EVENT" && message.key) {
      state.downloadStates.set(message.key, message.state);
      if (message.record) state.downloadHistory.set(message.key, message.record);
      if (message.state === "complete") state.selected.delete(message.key);
      if (state.lessons.length) renderLessons();
      if (message.state === "complete") {
        elements.footerNote.textContent = "有视频下载完成，可在 Chrome 下载记录中查看。";
      }
    }
  });

  window.addEventListener("hashchange", () => {
    state.loadToken += 1;
    state.loadedCourseKey = "";
    if (state.open) loadCourse();
  });

  if (isCoursePage()) {
    setTimeout(() => showPanel(true), 900);
  }
})();
