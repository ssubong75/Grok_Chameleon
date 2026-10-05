// Detail video player, extend range, and active playback
  function formatVideoTime(seconds) {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const total = Math.floor(safe);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }
  function selectedExtendDuration(fallback = 6) {
    const raw = selectedComposerControl(composerControls.duration).toLowerCase().replace(/s$/, "");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(2, Math.min(10, parsed));
  }

  function formatDetailExtendRange(start, duration) {
    const safeStart = Number.isFinite(start) && start > 0 ? start : 0;
    const safeDuration = Number.isFinite(duration) ? duration : selectedExtendDuration(6);
    return `${formatVideoTime(safeStart)} - ${formatVideoTime(safeStart + safeDuration)}`;
  }

  function currentDetailScreen() {
    if (screen_state.current_screen !== "i_detail" && screen_state.current_screen !== "b_detail") return null;
    return document.getElementById(screen_state.current_screen);
  }

  function currentDetailVideoPlayer() {
    return currentDetailScreen()?.querySelector(".video-player") || null;
  }

  function currentDetailVideoElement() {
    return currentDetailVideoPlayer()?.querySelector(".custom-video") || null;
  }

  function refreshDetailExtendTimeLabel(player = currentDetailVideoPlayer()) {
    const video = player?.querySelector(".custom-video");
    const currentLabel = player?.querySelector("[data-current]");
    const separator = player?.querySelector("[data-time-separator]");
    const durationLabel = player?.querySelector("[data-duration]");
    const timeLabel = player?.querySelector(".video-time");
    if (!currentLabel || !durationLabel) return;
    if (detail_state.extendActive && composerState.mode === "extend") {
      currentLabel.textContent = formatDetailExtendRange(detail_state.extendStart, selectedExtendDuration(6));
      if (separator) {
        separator.hidden = true;
        separator.textContent = "";
      }
      durationLabel.hidden = true;
      durationLabel.textContent = "";
      timeLabel?.classList.remove("is-ab-time");
      timeLabel?.classList.add("is-extend-time");
      return;
    }
    const current = Number(video?.currentTime);
    const duration = Number(video?.duration);
    currentLabel.textContent = formatVideoTime(Number.isFinite(current) ? current : 0);
    if (separator) {
      separator.hidden = false;
      separator.textContent = " / ";
    }
    durationLabel.hidden = false;
    durationLabel.textContent = formatVideoTime(Number.isFinite(duration) ? duration : 0);
    timeLabel?.classList.remove("is-extend-time");
  }

  function moveDetailVideoToExtendEnd(video = currentDetailVideoElement()) {
    if (!video) return false;
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) return false;
    video.pause();
    detail_state.extendStart = Number(duration.toFixed(3));
    try {
      video.currentTime = duration;
    } catch {
      // Some media elements reject seeking until metadata is fully ready.
    }
    video.dispatchEvent(new Event("timeupdate"));
    refreshDetailExtendTimeLabel(video.closest(".video-player"));
    return true;
  }

  function clearDetailExtendState() {
    detail_state.extendActive = false;
    detail_state.extendStart = 0;
    detail_state.extendUserAdjusted = false;
    detail_state.extendItemId = "";
    currentDetailScreen()?.classList.remove("detail_extend_active");
    refreshDetailExtendTimeLabel();
  }

  function prepareDetailExtendFromCurrentVideo(options = {}) {
    const post = selectedLibraryPost();
    const item = selectedDetailItem(post);
    const type = item?.type || mediaTypeForName(item?.file || item?.url || "") || "";
    if (!currentDetailScreen() || type !== "video" || !detailMediaUrlForItem(screen_state.current_screen === "i_detail" ? "i" : "b", item, post)) {
      clearDetailExtendState();
      return false;
    }
    const itemKey = mediaItemKey(item);
    const keepUserStart = detail_state.extendActive
      && detail_state.extendUserAdjusted
      && detail_state.extendItemId === itemKey;
    const shouldKeepUserStart = keepUserStart && !options.resetStart;
    detail_state.extendActive = true;
    detail_state.extendUserAdjusted = shouldKeepUserStart;
    detail_state.extendItemId = itemKey;
    currentDetailScreen()?.classList.add("detail_extend_active");
    const video = currentDetailVideoElement();
    if (shouldKeepUserStart) {
      const start = Number(detail_state.extendStart);
      if (video && Number.isFinite(start) && start >= 0) {
        const applyStart = () => {
          try {
            video.currentTime = Math.min(start, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : start);
          } catch {
          }
          refreshDetailExtendTimeLabel(video.closest(".video-player"));
        };
        if (Number.isFinite(video.duration) && video.duration > 0) applyStart();
        else video.addEventListener("loadedmetadata", applyStart, { once: true });
      }
      refreshDetailExtendTimeLabel();
      return true;
    }
    if (!moveDetailVideoToExtendEnd(video) && video) {
      video.addEventListener("loadedmetadata", () => {
        if (!detail_state.extendActive || detail_state.extendUserAdjusted || composerState.mode !== "extend") return;
        moveDetailVideoToExtendEnd(video);
      }, { once: true });
    }
    refreshDetailExtendTimeLabel();
    return true;
  }

  function syncDetailExtendFromSeek(video, forcedTime = null) {
    if (!detail_state.extendActive || composerState.mode !== "extend") return;
    const item = selectedDetailItem();
    if (detail_state.extendItemId && detail_state.extendItemId !== mediaItemKey(item)) return;
    const forced = Number(forcedTime);
    const current = Number.isFinite(forced) ? forced : Number(video?.currentTime);
    if (!Number.isFinite(current) || current < 0) return;
    detail_state.extendStart = Number(current.toFixed(3));
    detail_state.extendUserAdjusted = true;
    refreshDetailExtendTimeLabel(video.closest(".video-player"));
  }

  function markDetailExtendUserSeek() {
    if (!detail_state.extendActive || composerState.mode !== "extend") return;
    const item = selectedDetailItem();
    if (detail_state.extendItemId && detail_state.extendItemId !== mediaItemKey(item)) return;
    detail_state.extendUserAdjusted = true;
  }

  function detailVideoIcon(name) {
    const icons = {
      play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
      pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`,
      muted: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="video-mute-slash" d="M6.131 5.331 17.962 17.162" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
      volume: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5-1.5-1.4 1.4A4.4 4.4 0 0 1 16 12c0 1.2-.3 2.3-.9 3.1l1.4 1.4A6.6 6.6 0 0 0 18 12c0-1.7-.5-3.2-1.5-4.5zM19.3 4.7 17.9 6.1A8.5 8.5 0 0 1 20 12c0 2.2-.8 4.3-2.1 5.9l1.4 1.4A10.5 10.5 0 0 0 22 12c0-2.8-1-5.4-2.7-7.3z"/></svg>`,
    };
    return `<span class="video-icon">${icons[name] || ""}</span>`;
  }

  function setDetailVideoButtonIcon(button, icon, label) {
    if (!button) return;
    button.innerHTML = detailVideoIcon(icon);
    button.setAttribute("aria-label", label);
  }

  function createDetailVideoPlayer(prefix, item) {
    const player = document.createElement("div");
    player.className = "video-player";
    player.dataset.videoPlayer = "true";
    player.tabIndex = 0;

    const video = document.createElement("video");
    video.className = "custom-video detail_media_object";
    const videoUrl = detailMediaUrlForItem(prefix, item, selectedLibraryPost());
    video.src = videoUrl || item.object_url || item.url || "";
    video.playsInline = true;
    video.preload = "metadata";
    video.loop = true;
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
    const poster = detailPreviewUrlForItem(prefix, { ...item, type: "video" }, selectedLibraryPost());
    if (poster) video.poster = poster;

    const controls = document.createElement("div");
    controls.className = "video-controls";
    controls.innerHTML = `
      <button class="video-play" type="button" aria-label="Play">${detailVideoIcon("play")}</button>
      <span class="video-time"><span data-current>0:00</span><span data-time-separator> / </span><span data-duration>0:00</span></span>
      <input class="video-seek" data-seek type="range" min="0" max="1000" value="0" step="1" aria-label="Seek" />
      <div class="video-seek-ticks" data-seek-ticks aria-hidden="true"></div>
      <button class="video-a" type="button">A</button>
      <button class="video-b" type="button">B</button>
      <select class="video-rate" aria-label="Playback speed">
        <option value="2">2x</option>
        <option value="1.5">1.5x</option>
        <option value="1.25">1.25x</option>
        <option value="1" selected>1x</option>
        <option value="0.75">0.75x</option>
        <option value="0.5">0.5x</option>
        <option value="0.25">0.25x</option>
      </select>
      <button class="video-mute" type="button" aria-label="Mute">${detailVideoIcon("volume")}</button>
      <label class="video-volume">
        <span data-volume-label>100</span>
        <input class="video-volume-slider" data-volume type="range" min="0" max="100" value="100" step="1" aria-label="Volume" />
      </label>
    `;

    player.append(video, controls);
    bindDetailVideoPlayer(player, prefix, item);
    bindDetailMediaZoom(player, video);
    return player;
  }

  function currentDetailPrefix() {
    if (screen_state.current_screen === "i_detail") return "i";
    if (screen_state.current_screen === "b_detail") return "b";
    return "";
  }

  function playDetailVideoIfCurrent(prefix, video) {
    if (!video || screen_state.current_screen !== `${prefix}_detail`) return;
    video.loop = true;
    video.autoplay = true;
    const play = () => {
      if (!video.isConnected || screen_state.current_screen !== `${prefix}_detail`) return;
      video.loop = true;
      video.play().catch(() => {});
    };
    if (video.readyState >= 2) {
      window.requestAnimationFrame(play);
    } else {
      video.addEventListener("loadeddata", play, { once: true });
    }
  }

  function playActiveDetailVideoIfSelected() {
    const prefix = currentDetailPrefix();
    if (!prefix) return;
    const item = selectedDetailItem();
    if (detailItemType(item) !== "video") return;
    const video = document.querySelector(`.${prefix}_detail_media .video-player video`);
    playDetailVideoIfCurrent(prefix, video);
  }

  function pauseHiddenDetailVideos() {
    for (const video of document.querySelectorAll(".i_detail_media video, .b_detail_media video")) {
      const detailScreen = video.closest("#i_detail, #b_detail");
      if (!detailScreen || detailScreen.hidden) video.pause();
    }
  }

  function bindDetailVideoPlayer(player, prefix, item = null) {
    if (!player || player.dataset.bound === "1") return;
    player.dataset.bound = "1";
    const video = player.querySelector(".custom-video");
    const playBtn = player.querySelector(".video-play");
    const muteBtn = player.querySelector(".video-mute");
    const aBtn = player.querySelector(".video-a");
    const bBtn = player.querySelector(".video-b");
    const rateInput = player.querySelector(".video-rate");
    const volumeInput = player.querySelector("[data-volume]");
    const volumeLabel = player.querySelector("[data-volume-label]");
    const seekInput = player.querySelector("[data-seek]");
    const currentLabel = player.querySelector("[data-current]");
    const separatorLabel = player.querySelector("[data-time-separator]");
    const durationLabel = player.querySelector("[data-duration]");
    const timeLabel = player.querySelector(".video-time");
    const seekTicks = player.querySelector("[data-seek-ticks]");
    const points = { a: null, b: null, hideTimer: null, volumeTimer: null };
    // Keep fullscreen on the stable media surface. The player itself is replaced whenever a
    // different thumbnail is selected, while the surface remains mounted for the whole detail
    // view; using the surface therefore lets thumbnail navigation change media without leaving
    // fullscreen.
    const fullscreenHost = () => player.closest(".i_detail_media, .b_detail_media")
      || document.querySelector(`.${prefix}_detail_media`)
      || player;
    const isExpanded = () => document.fullscreenElement === fullscreenHost();
    const isCurrentDetailPlayer = () => player.isConnected && player === currentDetailVideoPlayer();
    const isActive = () => player.isConnected && (isCurrentDetailPlayer() || isExpanded());
    let tickKey = "";
    let unavailableHandled = false;
    if (!video) return;

    const renderTicks = (duration) => {
      if (!seekTicks) return;
      if (!Number.isFinite(duration) || duration <= 0) {
        tickKey = "";
        seekTicks.replaceChildren();
        return;
      }
      const safeDuration = Math.max(0.1, duration);
      const wholeSeconds = Math.floor(safeDuration);
      const fractionalTail = safeDuration - wholeSeconds;
      const ticks = [];
      for (let second = 0; second <= wholeSeconds; second += 1) {
        if (second === wholeSeconds && fractionalTail > 0.05 && fractionalTail < 0.75) continue;
        ticks.push(second);
      }
      if (fractionalTail > 0.05) ticks.push(safeDuration);
      const visibleTicks = [];
      ticks.forEach((tick) => {
        const pct = Math.max(0, Math.min(100, (tick / safeDuration) * 100));
        if (visibleTicks.some((candidate) => Math.abs(candidate - pct) < 0.35)) return;
        if (pct <= 0.01 || pct < 96 || Math.abs(pct - 100) < 0.01) visibleTicks.push(pct);
      });
      if (!visibleTicks.length || Math.abs(visibleTicks[visibleTicks.length - 1] - 100) > 0.01) visibleTicks.push(100);
      const nextKey = `${safeDuration.toFixed(2)}:${visibleTicks.map((tick) => tick.toFixed(3)).join(",")}`;
      if (nextKey === tickKey) return;
      tickKey = nextKey;
      seekTicks.replaceChildren(...visibleTicks.map((pct) => {
        const tick = document.createElement("span");
        tick.style.left = `${pct.toFixed(4)}%`;
        return tick;
      }));
    };

    const showControls = () => {
      player.classList.remove("controls-hidden");
      window.clearTimeout(points.hideTimer);
      if (!video.paused) {
        points.hideTimer = window.setTimeout(() => {
          player.classList.add("controls-hidden");
        }, 2700);
      }
    };

    const showVolume = () => {
      player.classList.add("volume-visible");
      window.clearTimeout(points.volumeTimer);
      points.volumeTimer = window.setTimeout(() => {
        player.classList.remove("volume-visible");
      }, 1800);
    };

    const changeVolume = (delta) => {
      const next = Math.max(0, Math.min(1, video.volume + delta));
      video.volume = Number(next.toFixed(2));
      video.muted = video.volume === 0;
      sync();
      showVolume();
      showControls();
    };

    const sync = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const hasAbPoint = points.a !== null || points.b !== null;
      renderTicks(duration);
      if (hasAbPoint && currentLabel && durationLabel) {
        currentLabel.textContent = `A ${points.a === null ? "--" : formatVideoTime(points.a)} - B ${points.b === null ? "--" : formatVideoTime(points.b)}`;
        if (separatorLabel) {
          separatorLabel.hidden = true;
          separatorLabel.textContent = "";
        }
        durationLabel.hidden = true;
        durationLabel.textContent = "";
        timeLabel?.classList.remove("is-extend-time");
        timeLabel?.classList.add("is-ab-time");
      } else if (detail_state.extendActive && composerState.mode === "extend" && currentLabel && durationLabel) {
        currentLabel.textContent = formatDetailExtendRange(detail_state.extendStart, selectedExtendDuration(6));
        if (separatorLabel) {
          separatorLabel.hidden = true;
          separatorLabel.textContent = "";
        }
        durationLabel.hidden = true;
        durationLabel.textContent = "";
        timeLabel?.classList.remove("is-ab-time");
        timeLabel?.classList.add("is-extend-time");
      } else {
        if (currentLabel) currentLabel.textContent = formatVideoTime(current);
        if (separatorLabel) {
          separatorLabel.hidden = false;
          separatorLabel.textContent = " / ";
        }
        if (durationLabel) {
          durationLabel.hidden = false;
          durationLabel.textContent = formatVideoTime(duration);
        }
        timeLabel?.classList.remove("is-ab-time");
        timeLabel?.classList.remove("is-extend-time");
      }
      if (seekInput) {
        seekInput.value = duration ? String(Math.round((current / duration) * 1000)) : "0";
        seekInput.style.setProperty("--range-progress", `${duration ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0}%`);
      }
      const volume = Math.round((video.volume || 0) * 100);
      if (volumeInput) {
        volumeInput.value = String(volume);
        volumeInput.style.setProperty("--range-progress", `${volume}%`);
      }
      if (volumeLabel) volumeLabel.textContent = String(volume);
      setDetailVideoButtonIcon(playBtn, video.paused ? "play" : "pause", video.paused ? "Play" : "Pause");
      setDetailVideoButtonIcon(muteBtn, video.muted ? "muted" : "volume", video.muted ? "Unmute" : "Mute");
      aBtn?.classList.toggle("active", points.a !== null);
      bBtn?.classList.toggle("active", points.b !== null);
      if (points.a !== null && points.b !== null && current >= points.b) {
        video.currentTime = points.a;
        if (!video.paused) video.play().catch(() => {});
      }
    };

    video.addEventListener("loadedmetadata", () => {
      syncDetailMediaAspect(prefix, video, item || selectedDetailItem());
      if (detail_state.extendActive && composerState.mode === "extend" && !detail_state.extendUserAdjusted) {
        moveDetailVideoToExtendEnd(video);
      }
      sync();
    });
    video.addEventListener("loadeddata", () => syncDetailMediaAspect(prefix, video, item || selectedDetailItem()));
    video.addEventListener("error", () => {
      if (unavailableHandled || prefix !== "i") return;
      const post = selectedLibraryPost();
      const postPath = String(post?.folder_path || item?.card_remote_post_path || "").trim();
      const mediaUrl = String(video.currentSrc || video.src || "").trim();
      if (!postPath || !mediaUrl || typeof handleUnavailableImagineRemoteMedia !== "function") return;
      unavailableHandled = true;
      handleUnavailableImagineRemoteMedia(player, item, mediaUrl, postPath).catch((error) => console.warn(error));
    });
    video.addEventListener("error", () => {
      if (unavailableHandled || prefix !== "i") return;
      const postPath = String(post?.folder_path || item?.card_remote_post_path || "").trim();
      const mediaUrl = String(video.currentSrc || video.src || "").trim();
      if (!postPath || !mediaUrl || typeof handleUnavailableImagineRemoteMedia !== "function") return;
      unavailableHandled = true;
      handleUnavailableImagineRemoteMedia(player, item, mediaUrl, postPath).catch((error) => console.warn(error));
    });
    video.addEventListener("timeupdate", sync);
    video.addEventListener("play", () => {
      player.classList.add("controls-hidden");
      sync();
    });
    video.addEventListener("pause", () => {
      showControls();
      sync();
    });
    video.addEventListener("volumechange", sync);
    video.addEventListener("click", () => {
      const host = fullscreenHost();
      if (document.fullscreenElement === host) {
        document.exitFullscreen?.();
        return;
      }
      if (document.fullscreenElement) return;
      host.requestFullscreen?.()
        .then(() => {
          player.focus({ preventScroll: true });
          if (video.paused) video.play().catch(() => {});
          showControls();
        })
        .catch(() => {});
    });
    playBtn?.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      showControls();
    });
    muteBtn?.addEventListener("click", () => {
      video.muted = !video.muted;
      sync();
      showControls();
    });
    const syncExtendFromSeekInput = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const nextTime = (Number(seekInput.value) / 1000) * video.duration;
        video.currentTime = nextTime;
        syncDetailExtendFromSeek(video, nextTime);
        return true;
      }
      syncDetailExtendFromSeek(video);
      return false;
    };

    seekInput?.addEventListener("input", () => {
      syncExtendFromSeekInput();
      showControls();
    });
    seekInput?.addEventListener("change", () => {
      syncExtendFromSeekInput();
      showControls();
    });
    seekInput?.addEventListener("pointerdown", () => {
      markDetailExtendUserSeek();
      showControls();
    });
    seekInput?.addEventListener("pointerup", () => {
      requestAnimationFrame(syncExtendFromSeekInput);
      showControls();
    });
    seekInput?.addEventListener("click", () => {
      requestAnimationFrame(syncExtendFromSeekInput);
      showControls();
    });
    seekInput?.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        markDetailExtendUserSeek();
      }
    });
    volumeInput?.addEventListener("input", () => {
      const next = Math.max(0, Math.min(100, Number(volumeInput.value || 0)));
      video.volume = next / 100;
      video.muted = next === 0;
      sync();
      showVolume();
      showControls();
    });
    rateInput?.addEventListener("change", () => {
      video.playbackRate = Number(rateInput.value || 1);
      video.preservesPitch = true;
      video.webkitPreservesPitch = true;
      video.mozPreservesPitch = true;
      showControls();
    });
    aBtn?.addEventListener("click", () => {
      points.a = points.a === null ? video.currentTime || 0 : null;
      if (points.a !== null && points.b !== null && points.b <= points.a) points.b = null;
      sync();
      showControls();
    });
    bBtn?.addEventListener("click", () => {
      points.b = points.b === null ? Math.max(video.currentTime || 0, (points.a || 0) + 0.1) : null;
      sync();
      showControls();
    });
    document.addEventListener("keydown", (event) => {
      if (!isActive()) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName;
        if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        changeVolume(event.key === "ArrowUp" ? 0.05 : -0.05);
        return;
      }
      const key = event.code === "Space" ? "space" : String(event.key || "").toLowerCase();
      const shortcutMap = {
        space: playBtn,
        m: muteBtn,
        a: aBtn,
        b: bBtn,
      };
      const button = shortcutMap[key];
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      button.click();
      showControls();
    });
    player.addEventListener("wheel", (event) => {
      if (event.shiftKey) return;
      if (!isActive()) return;
      event.preventDefault();
      changeVolume(event.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });
    player.addEventListener("mousemove", showControls);
    player.addEventListener("touchstart", showControls, { passive: true });
    const syncFullscreenState = () => {
      const active = isExpanded();
      player.classList.toggle("is-fullscreen", active);
      if (!active && !video.paused) player.classList.add("controls-hidden");
      else showControls();
      sync();
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    video.preservesPitch = true;
    video.webkitPreservesPitch = true;
    video.mozPreservesPitch = true;
    player.classList.add("controls-hidden");
    sync();
    // createDetailVideoPlayer binds before its caller appends the player to the media surface.
    // Defer once so a player created during fullscreen thumbnail navigation receives the correct
    // fullscreen controls state immediately.
    queueMicrotask(syncFullscreenState);
  }
