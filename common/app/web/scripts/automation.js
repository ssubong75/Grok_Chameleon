// Local smoke-test hooks for Codex-driven debugging. Loaded only inside the app page.
(() => {
  if (window.__grokChameleonAutomation) return;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(predicate, timeoutMs = 15000, intervalMs = 150) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    if (lastError) throw lastError;
    throw new Error("Automation timed out.");
  }

  function selectedComposerControlValue(name) {
    const control = document.querySelector(`[data-composer-control="${name}"]`);
    return control?.querySelector(".custom_select_btn")?.textContent.trim() || "";
  }

  function setComposerControlValue(name, value) {
    const control = document.querySelector(`[data-composer-control="${name}"]`);
    const wanted = String(value || "").trim();
    if (!control || !wanted) return false;
    const button = control.querySelector(".custom_select_btn");
    const options = Array.from(control.querySelectorAll(".custom_select_option"));
    const match = options.find((option) => option.textContent.trim() === wanted);
    if (!button || !match) return false;
    button.textContent = wanted;
    options.forEach((option) => option.classList.toggle("active", option === match));
    if (typeof rememberComposerOption === "function") rememberComposerOption(control, wanted);
    if (composerState.mode === "video" && typeof syncComposerVideoOptionControls === "function") {
      syncComposerVideoOptionControls();
      const synced = document.querySelector(`[data-composer-control="${name}"]`);
      const syncedButton = synced?.querySelector(".custom_select_btn");
      const syncedOptions = Array.from(synced?.querySelectorAll(".custom_select_option") || []);
      const syncedMatch = syncedOptions.find((option) => option.textContent.trim() === wanted);
      if (syncedButton && syncedMatch) {
        syncedButton.textContent = wanted;
        syncedOptions.forEach((option) => option.classList.toggle("active", option === syncedMatch));
        rememberComposerOption(synced, wanted);
      }
    }
    return selectedComposerControlValue(name) === wanted;
  }

  function firstImaginePost() {
    const posts = typeof imagineSourcePosts === "function"
      ? imagineSourcePosts()
      : (library_state.imagineRemotePosts || []);
    const filtered = typeof filterPostsBySearch === "function" ? filterPostsBySearch(posts) : posts;
    return (filtered || []).find((post) => (
      post
      && post.folder_path
      && Array.isArray(post.items)
      && post.items.length
      && post.area === "imagine_remote"
    )) || null;
  }

  async function ensureImagineMainReady(timeoutMs = 30000) {
    if (typeof openImagineMainView === "function") {
      openImagineMainView("i_imagine_tab_btn");
    } else if (typeof openScreen === "function") {
      openScreen("i_main", "i_imagine_nav_btn");
    }
    if (typeof loadImagineSavedCards === "function" && !library_state.imagineRemoteLoaded) {
      await loadImagineSavedCards({ force: false });
    }
    return waitFor(() => firstImaginePost(), timeoutMs);
  }

  function setComposerPrompt(value) {
    const input = document.getElementById("composer_input");
    if (!input) throw new Error("Composer input is missing.");
    input.value = String(value || "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function openFirstImagineDetail(timeoutMs = 30000) {
    const post = await ensureImagineMainReady(timeoutMs);
    selectLibraryPost(post.folder_path);
    screen_state.detail_back.imagine = { screenId: "i_main", activeButtonId: "i_imagine_nav_btn" };
    openScreen("i_detail", "i_imagine_nav_btn");
    await waitFor(() => (
      screen_state.current_screen === "i_detail"
      && selectedLibraryPost()?.folder_path === post.folder_path
    ), 10000);
    return post;
  }

  function jobIds() {
    return new Set((library_state.imagineJobs || []).map((job) => String(job.id || "")).filter(Boolean));
  }

  function findJob(jobId) {
    const id = String(jobId || "");
    return (library_state.imagineJobs || []).find((job) => String(job.id || "") === id) || null;
  }

  function jobDone(job) {
    const status = String(job?.status || "").toLowerCase();
    return ["succeeded", "success", "completed", "complete", "failed", "moderated", "cancelled", "canceled"].includes(status);
  }

  function selectedGeneratedVideoResult() {
    const post = typeof selectedLibraryPost === "function" ? selectedLibraryPost() : null;
    const item = post && typeof selectedDetailItem === "function" ? selectedDetailItem(post) : null;
    const itemType = String(item?.type || item?.media_type || "").toLowerCase();
    const url = item?.url || item?.media_url || "";
    if (!item || itemType !== "video" || !url) return null;
    return { post, item, url };
  }

  async function runImagineI2vSmoke(options = {}) {
    const prompt = options.prompt || "미소";
    const duration = options.duration || "6s";
    const resolution = options.resolution || "480";
    const timeoutMs = Math.max(10000, Number(options.timeoutMs || 45000));
    const before = jobIds();
    const post = await openFirstImagineDetail(timeoutMs);
    const item = selectedDetailItem(post);

    setComposerProvider("imagine");
    setComposerMode("video");
    await syncDetailAttachmentForComposerTray();
    renderComposerOptions();
    const durationOk = setComposerControlValue("duration", duration);
    const resolutionOk = setComposerControlValue("resolution", resolution);
    setComposerPrompt(prompt);

    await submitComposer();

    const job = await waitFor(() => {
      const next = (library_state.imagineJobs || []).find((candidate) => (
        candidate?.id && !before.has(String(candidate.id))
      ));
      return next || null;
    }, 10000);

    return {
      ok: true,
      job_id: job.id || "",
      status: job.status || "",
      progress: job.progress ?? null,
      post_path: post.folder_path || "",
      selected_item_id: item ? mediaItemKey(item) : "",
      prompt,
      mode: composerState.mode,
      duration: selectedComposerControlValue("duration"),
      resolution: selectedComposerControlValue("resolution"),
      duration_ok: durationOk,
      resolution_ok: resolutionOk,
    };
  }

  function status(jobId = "") {
    const fallbackJob = typeof selectedImagineJob === "function" ? selectedImagineJob() : null;
    const job = findJob(jobId) || fallbackJob || null;
    const selectedVideo = selectedGeneratedVideoResult();
    if (!job && selectedVideo) {
      return {
        ok: true,
        job_id: String(jobId || ""),
        status: "succeeded",
        progress: 100,
        done: true,
        error: "",
        result_count: 1,
        has_video: true,
        screen: screen_state.current_screen,
        selected_post_path: library_state.selectedPostPath || "",
        selected_item_id: mediaItemKey(selectedVideo.item) || "",
      };
    }
    return {
      ok: Boolean(job),
      job_id: job?.id || "",
      status: job?.status || "",
      progress: job?.progress ?? null,
      done: jobDone(job),
      error: job?.error || job?.message || "",
      result_count: Array.isArray(job?.result_items) ? job.result_items.length : 0,
      has_video: Array.isArray(job?.result_items) ? job.result_items.some((item) => item?.type === "video" && (item.url || item.media_url)) : false,
      screen: screen_state.current_screen,
      selected_post_path: library_state.selectedPostPath || "",
      selected_item_id: library_state.selectedDetailItemId || "",
    };
  }

  window.__grokChameleonAutomation = {
    runImagineI2vSmoke,
    status,
  };
})();
