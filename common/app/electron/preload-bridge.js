(() => {
  const TURBOPACK_WRAP_MARK = Symbol.for("grokChameleonTurbopackWrapped");
  const METHOD_WRAP_MARK = Symbol.for("grokChameleonStoreMethodWrapped");
  const STORE_TRACE_LIMIT = 180;
  const MEDIA_STORE_MODULE_IDS = [2447692, 5823886];
  let capturedMediaStore = null;
  let capturedMediaStorePath = "";
  let capturedMediaStoreModule = "";
  let capturedStoreV2Methods = null;
  let capturedStoreV2MethodsPath = "";
  let capturedStoreV2MethodsModule = "";
  let capturedImagineModeStore = null;
  let capturedImagineModeStorePath = "";
  let capturedImagineModeStoreModule = "";
  let nextMediaStoreId = 1;
  let nextStoreCallId = 1;
  let bridgeDirectCallDepth = 0;
  const capturedRuntimes = [];
  const capturedMediaStores = [];
  const storeTrace = [];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function compactValue(value, depth = 0) {
    if (value == null) return value;
    if (typeof value === "string") {
      if (/^https?:\/\//.test(value)) {
        try {
          const parsed = new URL(value);
          return { url: value.slice(0, 420), urlHost: parsed.host, urlPath: parsed.pathname.slice(0, 220) };
        } catch (_) {}
      }
      return value.length > 420 ? { len: value.length, head: value.slice(0, 220) } : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      return {
        length: value.length,
        items: value.slice(0, 20).map((item) => compactValue(item, depth + 1)),
      };
    }
    if (typeof value === "object") {
      if (depth >= 4) return { keys: Object.keys(value).slice(0, 24) };
      const output = {};
      for (const key of [
        "requestId", "name", "origin", "callId", "argCount", "storeId", "storePath", "storeModule", "variant",
        "modelName", "containerId", "expectedType", "beforeIds",
        "snapshot", "initialSnapshot", "finalSnapshot", "callState",
        "state", "error", "elapsedMs", "timeoutMs", "returnType",
        "loggedIn", "currentUserId", "requestingLogin", "loginChecked", "ageStage",
        "patched", "beforeLoginChecked", "afterLoginChecked", "desiredUserId", "reason",
        "attempt", "delayMs",
        "hasLoginCheck", "hasResolveMediaPostForMaybeGenerated", "hasRunGenerateVideoForImage",
        "itemCount", "lastId", "lastProgress", "lastHasUrl", "lastUrl",
        "lastThumb", "byIdExists", "matchedBy",
        "videoSeedId", "rootContainerId", "hasMediaGenInput",
        "hasGenerateVideoForImage", "generateVideoMethodSource",
        "hasGetStoreV2Methods", "hasV2RedoMethod", "v2MethodSource", "storeV2MethodsPath", "storeV2MethodsModule",
        "methodCount", "methodNames", "stateFunctionNames", "storeFunctionNames",
        "id", "itemId", "parentPostId", "rootPostId", "originalPostId",
        "conversationId", "responseId", "parentResponseId", "endpoint",
        "mediaUrl", "thumbnailImageUrl", "progress", "prompt", "mediaType",
        "inputPost", "containerPost", "sourcePost", "userId", "mimeType",
        "isGenerated", "fromMediaStoreV2", "isTemporaryVideoGenPlaceholder",
        "imageCount", "videoCount", "selectedImageExists", "selectedVideoExists",
        "duration", "videoLength", "resolutionName", "aspectRatio", "mode", "source", "location", "requestedResolution", "allowedResolution", "appliedResolution",
        "requestedAspectRatio", "appliedAspectRatio", "requestedDuration", "appliedDuration",
        "imagineModeStorePath", "imagineModeStoreModule",
        "transport", "appliedCount", "changed", "before", "after",
        "containerPostId", "imageUrls", "inputAssets", "videoExtensionStartTime",
        "args", "value", "isRedo", "numOfImages", "imageReferences", "videoInputAsset",
        "inflightId", "trackedIds", "noCandidateMs", "sourceId", "targetId", "targets", "storeObservationMs",
        "fileAttachments", "resolvedImageReferences", "videoGenModelConfig",
        "imageEditModelConfig", "mediaGenInput", "params", "url", "mimeType",
        "filename", "fileName", "grokChameleonDirectUpload", "grokChameleonUploadAssetIds", "grokChameleonUploadUrls",
        "activeContainerIds", "canonicalContainerId", "discoverNewContainers", "startNewConversation",
      ]) {
        if (Object.prototype.hasOwnProperty.call(value, key)) output[key] = compactValue(value[key], depth + 1);
      }
      const keys = Object.keys(output);
      return keys.length ? output : { keys: Object.keys(value).slice(0, 12) };
    }
    if (typeof value === "function") return "[function]";
    return String(value);
  }

  function pushStoreTrace(event, data = {}) {
    storeTrace.push({
      at: new Date().toISOString(),
      event,
      data: compactValue(data),
    });
    while (storeTrace.length > STORE_TRACE_LIMIT) storeTrace.shift();
  }

  const nativeFetch = window.fetch.bind(window);
  let activeConversationRequestRoute = null;
  let activeConversationRequestTimer = null;
  const generationResponseCaptures = [];

  function armGenerationResponseCapture({ requestId, modelName, expectedType, prompt = "" }) {
    const capture = {
      requestId: String(requestId || ""),
      modelName: String(modelName || ""),
      expectedType: String(expectedType || ""),
      prompt: String(prompt || ""),
      events: [],
      eventKeys: new Set(),
      conversationId: "",
      responseId: "",
      parentResponseId: "",
      rootPostId: "",
      requestCount: 0,
      status: 0,
      done: false,
      error: "",
      released: false,
    };
    generationResponseCaptures.push(capture);
    while (generationResponseCaptures.length > 8) generationResponseCaptures.shift();
    pushStoreTrace("generation_response_capture_armed", {
      requestId: capture.requestId,
      modelName: capture.modelName,
      expectedType: capture.expectedType,
    });
    return capture;
  }

  function releaseGenerationResponseCapture(capture) {
    if (!capture) return;
    capture.released = true;
    const index = generationResponseCaptures.indexOf(capture);
    if (index >= 0) generationResponseCaptures.splice(index, 1);
  }

  function generationResponseCaptureForBody(body) {
    if (!body || typeof body !== "object") return null;
    const modelName = String(body.modelName || "");
    for (let index = generationResponseCaptures.length - 1; index >= 0; index -= 1) {
      const capture = generationResponseCaptures[index];
      if (capture.released) continue;
      if (capture.modelName && capture.modelName !== modelName) continue;
      return capture;
    }
    return null;
  }

  function updateGenerationCaptureMetadata(capture, value) {
    if (!capture || !value || typeof value !== "object") return;
    const stack = [value];
    let visited = 0;
    while (stack.length && visited < 2500) {
      visited += 1;
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      if (Array.isArray(current)) {
        stack.push(...current);
        continue;
      }
      if (!capture.conversationId) {
        capture.conversationId = String(current.conversationId || current.conversation_id || "").trim();
      }
      if (!capture.responseId) {
        capture.responseId = String(current.responseId || current.response_id || "").trim();
      }
      if (!capture.parentResponseId) {
        capture.parentResponseId = String(current.parentResponseId || current.parent_response_id || "").trim();
      }
      if (!capture.rootPostId) {
        capture.rootPostId = String(current.rootPostId || current.root_post_id || current.containerPostId || "").trim();
      }
      for (const child of Object.values(current)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }

  function appendGenerationCaptureEvent(capture, expectedType, node) {
    if (!capture || !node || typeof node !== "object") return;
    const type = expectedType === "video" ? "video" : "image";
    const id = String(type === "video"
      ? (node.videoId || node.video_id || node.postId || node.post_id || "")
      : (node.imageId || node.image_id || node.assetId || node.asset_id || node.postId || node.post_id || "")
    ).trim();
    const rawUrl = type === "video"
      ? (node.videoUrl || node.video_url || node.mediaUrl || node.media_url || "")
      : (node.imageUrl || node.image_url || node.mediaUrl || node.media_url || "");
    const url = assetUrlFromFileUri(rawUrl);
    const progressValue = Number(node.progress);
    const progress = Number.isFinite(progressValue) ? progressValue : (url ? 100 : 1);
    if (!id && !url && !Object.prototype.hasOwnProperty.call(node, "progress")) return;
    const key = [type, id, progress, url].join("|");
    if (capture.eventKeys.has(key)) return;
    capture.eventKeys.add(key);
    const base = {
      progress,
      prompt: node.prompt || capture.prompt || "",
      modelName: node.modelName || node.model || capture.modelName || "",
      createdAt: node.createTime || node.createdAt || new Date().toISOString(),
      rootPostId: node.rootPostId || node.root_post_id || capture.rootPostId || capture.conversationId || "",
      parentPostId: node.parentPostId || node.parent_post_id || "",
      originalPostId: node.originalPostId || node.original_post_id || "",
      originalRefType: node.originalRefType || node.original_ref_type || "",
      conversationId: node.conversationId || node.conversation_id || capture.conversationId || "",
      responseId: node.responseId || node.response_id || capture.responseId || "",
      parentResponseId: node.parentResponseId || node.parent_response_id || capture.parentResponseId || "",
      moderated: Boolean(node.moderated),
    };
    if (type === "video") {
      capture.events.push({
        ...base,
        videoId: id,
        videoPostId: id,
        videoUrl: url,
        thumbnailImageUrl: assetUrlFromFileUri(node.thumbnailImageUrl || node.thumbnail_image_url || ""),
        resolutionName: node.resolutionName || node.resolution_name || "",
        videoDuration: node.duration || node.videoDuration || node.video_duration || "",
      });
    } else {
      capture.events.push({
        ...base,
        imageId: id,
        assetId: id,
        imageUrl: url,
        mediaUrl: url,
        temporaryDataUrl: isTemporaryImageUrl(url),
        resolutionName: node.resolutionName || node.resolution_name || node.resolution || "",
      });
    }
    while (capture.events.length > 300) capture.events.shift();
  }

  function collectGenerationCapturePayload(capture, value) {
    if (!capture || !value || typeof value !== "object") return;
    updateGenerationCaptureMetadata(capture, value);
    const stack = [value];
    let visited = 0;
    while (stack.length && visited < 2500) {
      visited += 1;
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      if (Array.isArray(current)) {
        stack.push(...current);
        continue;
      }
      for (const [key, child] of Object.entries(current)) {
        if (key === "streamingImageGenerationResponse" && child && typeof child === "object") {
          appendGenerationCaptureEvent(capture, "image", child);
        } else if (key === "streamingVideoGenerationResponse" && child && typeof child === "object") {
          appendGenerationCaptureEvent(capture, "video", child);
        }
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }

  function parseGenerationCaptureLine(capture, rawLine) {
    let text = String(rawLine || "").trim();
    if (!text || text.startsWith("event:") || text.startsWith(":")) return;
    if (text.startsWith("data:")) text = text.slice(5).trim();
    if (!text || text === "[DONE]") return;
    try {
      collectGenerationCapturePayload(capture, JSON.parse(text));
    } catch (_) {}
  }

  async function observeGenerationResponse(response, capture, endpoint) {
    if (!capture || !response) return;
    capture.requestCount += 1;
    capture.status = Number(response.status || 0);
    pushStoreTrace("generation_response_capture_start", {
      requestId: capture.requestId,
      endpoint,
      status: capture.status,
      requestCount: capture.requestCount,
    });
    try {
      const clone = response.clone();
      if (!clone.body) {
        parseGenerationCaptureLine(capture, await clone.text());
      } else {
        const reader = clone.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) parseGenerationCaptureLine(capture, line);
          if (done) break;
        }
        if (buffer.trim()) parseGenerationCaptureLine(capture, buffer);
      }
    } catch (error) {
      capture.error = error?.message || String(error);
    } finally {
      capture.done = true;
      pushStoreTrace("generation_response_capture_done", {
        requestId: capture.requestId,
        status: capture.status,
        eventCount: capture.events.length,
        conversationId: capture.conversationId,
        rootPostId: capture.rootPostId,
        error: capture.error,
      });
    }
  }

  function generationCaptureEvents(capture, expectedType, conversationId = "", parentResponseId = "") {
    if (!capture) return [];
    return capture.events
      .filter((event) => expectedType === "video" ? (event.videoId || event.videoUrl) : (event.imageId || event.imageUrl))
      .map((event) => ({
        ...event,
        rootPostId: event.rootPostId || capture.rootPostId || capture.conversationId || conversationId || "",
        conversationId: event.conversationId || capture.conversationId || conversationId || "",
        responseId: event.responseId || capture.responseId || "",
        parentResponseId: event.parentResponseId || capture.parentResponseId || parentResponseId || "",
      }));
  }

  function generationCaptureCanonicalId(capture, events, expectedType, sourceIds = []) {
    if (!capture || !(events || []).some((event) => hasFinalStoreMediaEvent(event, expectedType))) return "";
    const excluded = new Set((sourceIds || []).map((value) => String(value || "").trim()).filter(Boolean));
    for (const value of [capture.conversationId, capture.rootPostId]) {
      const id = String(value || "").trim();
      if (id && !excluded.has(id)) return id;
    }
    return "";
  }

  function clearConversationRequestRoute(route = null) {
    if (route && activeConversationRequestRoute !== route) return;
    activeConversationRequestRoute = null;
    if (activeConversationRequestTimer) clearTimeout(activeConversationRequestTimer);
    activeConversationRequestTimer = null;
  }

  function armConversationRequestRoute({ requestId, modelName, conversationId, parentResponseId }) {
    const conversation = String(conversationId || "").trim();
    if (!conversation) return null;
    clearConversationRequestRoute();
    const route = {
      requestId: String(requestId || ""),
      modelName: String(modelName || ""),
      conversationId: conversation,
      parentResponseId: String(parentResponseId || "").trim(),
    };
    activeConversationRequestRoute = route;
    activeConversationRequestTimer = setTimeout(() => clearConversationRequestRoute(route), 60000);
    pushStoreTrace("conversation_request_route_armed", route);
    return route;
  }

  async function fetchBodyText(input, init) {
    if (typeof init?.body === "string") return init.body;
    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch (_) {}
    }
    return "";
  }

  function requestInitForReroute(input, init, body) {
    const next = { ...(init || {}), body: JSON.stringify(body) };
    if (!(input instanceof Request)) return next;
    next.method = init?.method || input.method;
    next.headers = init?.headers || input.headers;
    next.credentials = init?.credentials || input.credentials;
    next.cache = init?.cache || input.cache;
    next.redirect = init?.redirect || input.redirect;
    next.referrer = init?.referrer || input.referrer;
    next.referrerPolicy = init?.referrerPolicy || input.referrerPolicy;
    next.integrity = init?.integrity || input.integrity;
    next.keepalive = init?.keepalive ?? input.keepalive;
    next.signal = init?.signal || input.signal;
    return next;
  }

  window.fetch = async function grokChameleonConversationFetch(input, init = undefined) {
    const route = activeConversationRequestRoute;
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl, location.origin);
    } catch (_) {
      return nativeFetch(input, init);
    }
    const conversationRequest = /^\/rest\/app-chat\/conversations\/(?:new|[^/]+\/responses)$/.test(parsedUrl.pathname);
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!conversationRequest || method !== "POST") return nativeFetch(input, init);
    const bodyText = await fetchBodyText(input, init);
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch (_) {
      body = null;
    }
    if (!body || typeof body !== "object") return nativeFetch(input, init);
    let targetInput = input;
    let targetInit = init;
    let endpoint = parsedUrl.pathname;
    if (route && (!route.modelName || body.modelName === route.modelName)) {
      endpoint = `/rest/app-chat/conversations/${encodeURIComponent(route.conversationId)}/responses`;
      targetInput = new URL(endpoint, parsedUrl.origin).toString();
      targetInit = requestInitForReroute(input, init, {
        ...body,
        ...(route.parentResponseId ? { parentResponseId: route.parentResponseId } : {}),
        skipCancelCurrentInflightRequests: true,
      });
      clearConversationRequestRoute(route);
      pushStoreTrace("conversation_request_route_applied", {
        requestId: route.requestId,
        modelName: route.modelName,
        conversationId: route.conversationId,
        parentResponseId: route.parentResponseId,
        endpoint,
      });
    }
    const capture = generationResponseCaptureForBody(body);
    const response = await nativeFetch(targetInput, targetInit);
    if (capture) observeGenerationResponse(response, capture, endpoint);
    return response;
  };


  function officialElementVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 10 && rect.height > 10 && rect.bottom > 0 && rect.right > 0;
  }

  function officialPromptValue(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return String(element.value || "");
    }
    return String(element.innerText || element.textContent || "");
  }

  function findOfficialPromptBox() {
    const candidates = Array.from(document.querySelectorAll(
      'textarea, input[type="text"], input:not([type]), [role="textbox"], [contenteditable]'
    )).filter((element) => {
      const editable = String(element.getAttribute("contenteditable") || "").toLowerCase();
      return officialElementVisible(element) && editable !== "false";
    });
    const score = (element) => {
      const label = [
        element.getAttribute("aria-label") || "",
        element.getAttribute("placeholder") || "",
        element.getAttribute("role") || "",
        element.className || "",
      ].join(" ").toLowerCase();
      const rect = element.getBoundingClientRect();
      let value = 0;
      if (label.includes("ask grok") || label.includes("grok")) value += 5;
      if (/message|prompt|메시지|프롬프트|질문/.test(label)) value += 4;
      if (label.includes("textbox")) value += 3;
      if (element.isContentEditable) value += 2;
      if (rect.width > 260) value += 3;
      if (rect.height > 28) value += 2;
      if (officialPromptValue(element).trim()) value += 4;
      value += Math.min(8, Math.max(0, rect.bottom / Math.max(1, window.innerHeight)) * 5);
      return value;
    };
    return candidates.sort((left, right) => score(right) - score(left))[0] || null;
  }

  function dispatchOfficialPromptInput(element, value) {
    try {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertReplacementText",
        data: value,
      }));
    } catch (_) {}
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }));
    } catch (_) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function writeOfficialPrompt(prompt, requestId, variant) {
    const element = findOfficialPromptBox();
    if (!element) throw new Error("Official Imagine prompt box was not found.");
    const value = String(prompt || "");
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      dispatchOfficialPromptInput(element, value);
    } else {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("insertText", false, value);
      } catch (_) {
        element.textContent = value;
      }
      dispatchOfficialPromptInput(element, value);
    }
    await sleep(180);
    const expected = value.replace(/\s+/g, " ").trim();
    const actual = officialPromptValue(element).replace(/\s+/g, " ").trim();
    if (expected && !actual.includes(expected)) {
      throw new Error("Official Imagine prompt input could not be confirmed.");
    }
    pushStoreTrace("store_generation_ui_prompt_ready", {
      requestId,
      variant,
      promptLength: value.length,
    });
  }

  function officialActionButtonText(element) {
    return [
      element?.innerText || "",
      element?.textContent || "",
      element?.getAttribute?.("aria-label") || "",
      element?.getAttribute?.("title") || "",
    ].join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findOfficialVideoActionButton(variant) {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((element) => officialElementVisible(element)
        && !element.disabled
        && element.getAttribute("aria-disabled") !== "true");
    const extend = variant === "videoExtension";
    const patterns = extend
      ? ["extend video", "video extend", "continue video", "영상 연장", "비디오 연장", "동영상 연장", "연장하기"]
      : ["create video", "make video", "generate video", "동영상 만들기", "비디오 만들기", "영상 만들기"];
    return candidates.find((element) => {
      const text = officialActionButtonText(element);
      return patterns.some((pattern) => text.includes(pattern));
    }) || null;
  }

  async function clickOfficialVideoAction({ requestId, variant, prompt }) {
    await writeOfficialPrompt(prompt, requestId, variant);
    await sleep(250);
    const button = findOfficialVideoActionButton(variant);
    if (!button) throw new Error(`Official Imagine ${variant} action button was not found.`);
    const buttonText = officialActionButtonText(button);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    button.click();
    pushStoreTrace("store_generation_ui_action_clicked", {
      requestId,
      variant,
      buttonText,
      url: location.href,
    });
    return {
      state() {
        return { state: "pending", error: "" };
      },
      promise: Promise.resolve(null),
    };
  }

  function storeSnapshot(state, containerId, expectedType) {
    const byContainer = expectedType === "video" ? state?.videoByMediaId : state?.imageByMediaId;
    const list = byContainer && containerId ? byContainer[containerId] : null;
    const items = Array.isArray(list) ? list : [];
    const last = items.length ? items[items.length - 1] : null;
    return {
      containerId,
      expectedType,
      itemCount: items.length,
      lastId: last?.id || last?.itemId || "",
      lastProgress: last?.progress,
      lastHasUrl: Boolean(itemUrl(last, expectedType)),
      lastUrl: itemUrl(last, expectedType),
      lastThumb: itemThumbUrl(last),
      byIdExists: Boolean(containerId && state?.byId && state.byId[containerId]),
    };
  }

  function postDebugSummary(state, id) {
    const value = resolvedMediaId(state, id);
    const post = value && state?.byId ? state.byId[value] : null;
    if (!value) return { id: "" };
    if (!post) return { id: value, byIdExists: false };
    return {
      id: value,
      byIdExists: true,
      mediaType: post.mediaType || "",
      mimeType: post.mimeType || "",
      mediaUrl: post.mediaUrl || "",
      thumbnailImageUrl: itemThumbUrl(post),
      prompt: post.prompt || post.originalPrompt || "",
      userId: post.userId || "",
      originalPostId: post.originalPostId || "",
      rootPostId: post.rootPostId || "",
      parentPostId: post.parentPostId || "",
      isGenerated: Boolean(post.isGenerated),
      fromMediaStoreV2: Boolean(post.fromMediaStoreV2),
      isTemporaryVideoGenPlaceholder: Boolean(post.isTemporaryVideoGenPlaceholder),
    };
  }

  function hasChildItem(items, id) {
    const value = id ? String(id) : "";
    return Boolean(value && Array.isArray(items) && items.some((item) => String(item?.id || item?.itemId || "") === value));
  }

  function videoGenerationPreflight(state, containerId, videoInputAsset, requestId) {
    const imageItems = state?.imageByMediaId?.[containerId] || [];
    const videoItems = state?.videoByMediaId?.[containerId] || [];
    let loginChecked = "";
    if (typeof state?.loginCheck === "function") {
      try {
        loginChecked = String(state.loginCheck("generateVideoForImage"));
      } catch (error) {
        loginChecked = `error:${error?.message || String(error)}`;
      }
    }
    pushStoreTrace("store_generation_video_preflight", {
      requestId,
      loggedIn: state?.loggedIn,
      currentUserId: state?.currentUserId || "",
      requestingLogin: state?.requestingLogin,
      loginChecked,
      hasLoginCheck: typeof state?.loginCheck === "function",
      hasResolveMediaPostForMaybeGenerated: typeof state?.resolveMediaPostForMaybeGenerated === "function",
      hasRunGenerateVideoForImage: typeof state?._runGenerateVideoForImage === "function",
      containerPost: postDebugSummary(state, containerId),
      inputPost: postDebugSummary(state, videoInputAsset),
      imageCount: Array.isArray(imageItems) ? imageItems.length : 0,
      videoCount: Array.isArray(videoItems) ? videoItems.length : 0,
      selectedImageExists: hasChildItem(imageItems, videoInputAsset),
      selectedVideoExists: hasChildItem(videoItems, videoInputAsset),
      snapshot: storeSnapshot(state, containerId, "video"),
    });
  }

  function loginCheckValue(state, reason = "generateVideoForImage") {
    if (typeof state?.loginCheck !== "function") return "";
    try {
      return String(state.loginCheck(reason));
    } catch (error) {
      return `error:${error?.message || String(error)}`;
    }
  }

  function firstKnownUserId(state, ids = []) {
    const direct = state?.currentUserId || state?.userId || state?.user?.id || state?.currentUser?.id || state?.viewer?.id || "";
    if (direct) return String(direct);
    for (const id of ids) {
      const post = id && state?.byId ? state.byId[String(id)] : null;
      if (post?.userId) return String(post.userId);
      if (post?.user?.id) return String(post.user.id);
    }
    return "";
  }

  function ensureStoreLoginState(state, record, requestId, reason, ids = []) {
    const beforeLoginChecked = loginCheckValue(state, reason);
    const alreadyReady = state?.loggedIn && state?.currentUserId && beforeLoginChecked === "true";
    if (alreadyReady) {
      pushStoreTrace("store_auth_ready", {
        requestId,
        reason,
        loggedIn: state?.loggedIn,
        currentUserId: state?.currentUserId || "",
        loginChecked: beforeLoginChecked,
      });
      return state;
    }

    const desiredUserId = firstKnownUserId(state, ids);
    let patched = false;
    if (desiredUserId) {
      const patch = {
        loggedIn: true,
        currentUserId: desiredUserId,
        requestingLogin: false,
      };
      try {
        if (typeof record?.store?.setState === "function") {
          record.store.setState(patch, false);
          patched = true;
        }
      } catch (_) {}
      try {
        Object.assign(state, patch);
        patched = true;
      } catch (_) {}
    }

    const nextState = record ? mediaStoreStateForRecord(record) : getMediaStoreState();
    const afterLoginChecked = loginCheckValue(nextState, reason);
    pushStoreTrace("store_auth_patch", {
      requestId,
      reason,
      patched,
      beforeLoginChecked,
      afterLoginChecked,
      desiredUserId,
      loggedIn: nextState?.loggedIn,
      currentUserId: nextState?.currentUserId || "",
      requestingLogin: nextState?.requestingLogin,
    });
    return nextState || state;
  }

  function wrapMediaStoreStateMethods(state, record = null) {
    if (!state || typeof state !== "object") return;
    for (const name of [
      "generateVideoForImage",
      "_runGenerateVideoForImage",
      "fetchGenerateImageEdits",
      "redoFromMediaGenInput",
      "createMediaPostFromPrompt",
      "createMediaPostFromUrl",
      "resolveMediaPostForMaybeGenerated",
      "loginCheck",
      "like"
    ]) {
      const current = state[name];
      if (typeof current !== "function" || current[METHOD_WRAP_MARK]) continue;
      const wrapped = function wrappedMediaStoreMethod(...args) {
        const callId = nextStoreCallId++;
        const origin = bridgeDirectCallDepth > 0 ? "bridge_direct" : "official_ui";
        pushStoreTrace("official_store_method_call", {
          name,
          origin,
          callId,
          argCount: args.length,
          args,
          storeId: record?.id,
          storePath: record?.path,
          storeModule: record?.moduleId,
        });
        try {
          const result = current.apply(this, args);
          if (result && typeof result.then === "function") {
            result.then(
              (value) => pushStoreTrace("official_store_method_resolve", {
                name,
                origin,
                callId,
                value,
                storeId: record?.id,
                storePath: record?.path,
                storeModule: record?.moduleId,
              }),
              (error) => pushStoreTrace("official_store_method_reject", {
                name,
                origin,
                callId,
                error: error?.message || String(error),
                storeId: record?.id,
                storePath: record?.path,
                storeModule: record?.moduleId,
              })
            );
          } else {
            pushStoreTrace("official_store_method_return", {
              name,
              origin,
              callId,
              returnType: typeof result,
              value: result,
              storeId: record?.id,
              storePath: record?.path,
              storeModule: record?.moduleId,
            });
          }
          return result;
        } catch (error) {
          pushStoreTrace("official_store_method_throw", {
            name,
            origin,
            callId,
            error: error?.message || String(error),
            storeId: record?.id,
            storePath: record?.path,
            storeModule: record?.moduleId,
          });
          throw error;
        }
      };
      Object.defineProperty(wrapped, METHOD_WRAP_MARK, { value: true });
      try {
        state[name] = wrapped;
      } catch (_) {}
    }
  }

  function mediaStoreRecord(value) {
    return capturedMediaStores.find((record) => record.store === value) || null;
  }

  function captureMediaStore(value, path, moduleId = "") {
    if (!value || typeof value.getState !== "function") return false;
    let state = null;
    try {
      state = value.getState();
    } catch (_) {
      return false;
    }
    if (!state || (typeof state.generateVideoForImage !== "function" && typeof state.fetchGenerateImageEdits !== "function")) {
      return false;
    }
    let record = mediaStoreRecord(value);
    if (!record) {
      record = {
        id: nextMediaStoreId++,
        store: value,
        path: path || "",
        moduleId: moduleId || "",
      };
      capturedMediaStores.push(record);
      pushStoreTrace("media_store_captured", { storeId: record.id, path: record.path, moduleId: record.moduleId });
    } else {
      record.path = record.path || path || "";
      record.moduleId = record.moduleId || moduleId || "";
    }
    wrapMediaStoreStateMethods(state, record);
    capturedMediaStore = capturedMediaStore || value;
    capturedMediaStorePath = capturedMediaStorePath || record.path || "";
    capturedMediaStoreModule = capturedMediaStoreModule || record.moduleId || "";
    return true;
  }

  function captureStoreV2Methods(value, path, moduleId = "") {
    if (typeof value !== "function") return false;
    if (capturedStoreV2Methods === value) return true;
    if (capturedStoreV2Methods) return true;
    capturedStoreV2Methods = value;
    capturedStoreV2MethodsPath = path || "";
    capturedStoreV2MethodsModule = moduleId || "";
    pushStoreTrace("store_v2_methods_captured", {
      storePath: capturedStoreV2MethodsPath,
      storeModule: capturedStoreV2MethodsModule,
    });
    return true;
  }

  function captureImagineModeStore(value, path, moduleId = "") {
    if (!value || typeof value.getState !== "function") return false;
    let state = null;
    try {
      state = value.getState();
    } catch (_) {
      return false;
    }
    if (
      !state
      || typeof state.setResolution !== "function"
      || typeof state.allowedVideoResolution !== "function"
      || typeof state.setAspectRatio !== "function"
      || typeof state.setVideoLength !== "function"
      || !("resolution" in state)
    ) {
      return false;
    }
    if (!capturedImagineModeStore) {
      capturedImagineModeStore = value;
      capturedImagineModeStorePath = path || "";
      capturedImagineModeStoreModule = moduleId || "";
      pushStoreTrace("imagine_mode_store_captured", {
        imagineModeStorePath: capturedImagineModeStorePath,
        imagineModeStoreModule: capturedImagineModeStoreModule,
        resolutionName: state.resolution || "",
        aspectRatio: state.aspectRatio,
        videoLength: state.videoLength,
      });
    }
    return true;
  }

  function inspectExportProperties(value, path, moduleId = "", depth = 0, seen = new Set()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    if (seen.has(value) || depth > 1) return;
    seen.add(value);
    let keys = [];
    try {
      keys = Object.getOwnPropertyNames(value);
    } catch (_) {
      return;
    }
    for (const key of keys) {
      if (key === "constructor" || key === "prototype" || key === "length" || key === "name") continue;
      let candidate = null;
      try {
        candidate = Reflect.get(value, key);
      } catch (_) {
        continue;
      }
      if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) continue;
      const candidatePath = `${path}.${key}`;
      captureMediaStore(candidate, candidatePath, moduleId);
      captureImagineModeStore(candidate, candidatePath, moduleId);
      try {
        if (candidate.getStoreV2Methods) captureStoreV2Methods(candidate.getStoreV2Methods, `${candidatePath}.getStoreV2Methods`, moduleId);
      } catch (_) {}
      try {
        if (candidate.useMediaStore) captureMediaStore(candidate.useMediaStore, `${candidatePath}.useMediaStore`, moduleId);
      } catch (_) {}
      try {
        if (candidate.useImagineModeStore) captureImagineModeStore(candidate.useImagineModeStore, `${candidatePath}.useImagineModeStore`, moduleId);
      } catch (_) {}
      try {
        if (candidate.default) captureMediaStore(candidate.default, `${candidatePath}.default`, moduleId);
      } catch (_) {}
      try {
        if (key === "getStoreV2Methods" && typeof candidate === "function") captureStoreV2Methods(candidate, candidatePath, moduleId);
      } catch (_) {}
      if (capturedMediaStore && capturedStoreV2Methods && capturedImagineModeStore) return;
      inspectExportProperties(candidate, candidatePath, moduleId, depth + 1, seen);
      if (capturedMediaStore && capturedStoreV2Methods && capturedImagineModeStore) return;
    }
  }

  function inspectExports(value, path, moduleId = "") {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    captureMediaStore(value, path, moduleId);
    captureImagineModeStore(value, path, moduleId);
    try {
      if (value.getStoreV2Methods) captureStoreV2Methods(value.getStoreV2Methods, `${path}.getStoreV2Methods`, moduleId);
    } catch (_) {}
    try {
      if (value.useMediaStore) captureMediaStore(value.useMediaStore, `${path}.useMediaStore`, moduleId);
    } catch (_) {}
    try {
      if (value.useImagineModeStore) captureImagineModeStore(value.useImagineModeStore, `${path}.useImagineModeStore`, moduleId);
    } catch (_) {}
    try {
      if (value.default) captureMediaStore(value.default, `${path}.default`, moduleId);
    } catch (_) {}
    try {
      if (value.default?.getStoreV2Methods) captureStoreV2Methods(value.default.getStoreV2Methods, `${path}.default.getStoreV2Methods`, moduleId);
    } catch (_) {}
    inspectExportProperties(value, path, moduleId);
  }

  function inspectTurbopackModule(module, ids) {
    if (!module) return;
    const moduleId = String(module.id || ids || "");
    try {
      inspectExports(module, `module:${moduleId}`, moduleId);
    } catch (_) {}
    try {
      inspectExports(module.exports, `module:${moduleId}.exports`, moduleId);
    } catch (_) {}
    try {
      inspectExports(module.namespaceObject, `module:${moduleId}.namespaceObject`, moduleId);
    } catch (_) {}
  }

  function rememberRuntime(runtime) {
    if (!runtime || capturedRuntimes.includes(runtime)) return;
    capturedRuntimes.push(runtime);
  }

  function scanRuntimeCache(runtime) {
    if (!runtime) return;
    rememberRuntime(runtime);
    try {
      const cache = runtime.c || {};
      for (const moduleId of MEDIA_STORE_MODULE_IDS) {
        const cachedModule = cache[moduleId] || cache[String(moduleId)];
        if (cachedModule) {
          inspectTurbopackModule(cachedModule, String(moduleId));
          if (capturedMediaStore && capturedStoreV2Methods && capturedImagineModeStore) return;
        }
      }
      for (const key of Object.keys(cache)) {
        inspectTurbopackModule(cache[key], key);
        if (capturedMediaStore && capturedStoreV2Methods && capturedImagineModeStore) return;
      }
    } catch (_) {}
  }

  function scanAllRuntimes() {
    for (const runtime of capturedRuntimes) {
      scanRuntimeCache(runtime);
      if (capturedMediaStore && capturedStoreV2Methods && capturedImagineModeStore) return true;
    }
    return Boolean(capturedMediaStore);
  }

  function wrapTurbopackFactory(factory, ids) {
    if (typeof factory !== "function" || factory[TURBOPACK_WRAP_MARK]) return factory;
    const wrapped = function wrappedTurbopackFactory(runtime, module, exports) {
      rememberRuntime(runtime);
      try {
        return factory.apply(this, arguments);
      } finally {
        inspectTurbopackModule(module, ids);
        setTimeout(() => inspectTurbopackModule(module, ids), 0);
        setTimeout(() => scanRuntimeCache(runtime), 100);
        setTimeout(() => scanRuntimeCache(runtime), 1000);
        setTimeout(() => scanRuntimeCache(runtime), 3000);
      }
    };
    Object.defineProperty(wrapped, TURBOPACK_WRAP_MARK, { value: true });
    return wrapped;
  }

  function wrapTurbopackChunk(chunk) {
    if (!Array.isArray(chunk) || chunk[TURBOPACK_WRAP_MARK]) return chunk;
    let cursor = 1;
    while (cursor < chunk.length) {
      let factoryIndex = cursor + 1;
      while (factoryIndex < chunk.length && typeof chunk[factoryIndex] !== "function") {
        factoryIndex += 1;
      }
      if (factoryIndex >= chunk.length) break;
      const ids = chunk.slice(cursor, factoryIndex).join(",");
      chunk[factoryIndex] = wrapTurbopackFactory(chunk[factoryIndex], ids);
      cursor = factoryIndex + 1;
    }
    try {
      Object.defineProperty(chunk, TURBOPACK_WRAP_MARK, { value: true });
    } catch (_) {}
    return chunk;
  }

  function patchTurbopackPush(value) {
    if (!value || value[TURBOPACK_WRAP_MARK] || typeof value.push !== "function") return value;
    const originalPush = value.push;
    value.push = function patchedTurbopackPush(...chunks) {
      return originalPush.apply(this, chunks.map(wrapTurbopackChunk));
    };
    try {
      Object.defineProperty(value, TURBOPACK_WRAP_MARK, { value: true });
    } catch (_) {}
    return value;
  }

  function installTurbopackCapture() {
    let currentValue = globalThis.TURBOPACK;
    if (!Array.isArray(currentValue) && (!currentValue || typeof currentValue.push !== "function")) {
      currentValue = [];
    }
    if (Array.isArray(currentValue)) {
      for (let index = 0; index < currentValue.length; index += 1) {
        currentValue[index] = wrapTurbopackChunk(currentValue[index]);
      }
    }
    patchTurbopackPush(currentValue);
    try {
      Object.defineProperty(globalThis, "TURBOPACK", {
        configurable: true,
        get() {
          return currentValue;
        },
        set(nextValue) {
          currentValue = patchTurbopackPush(nextValue);
        },
      });
    } catch (_) {
      globalThis.TURBOPACK = currentValue;
    }
  }

  installTurbopackCapture();

  const NativeWebSocket = window.WebSocket;
  const sockets = [];
  const listeners = new Set();

  function isImagineSocket(url) {
    return String(url || "").includes("/ws/imagine/listen");
  }

  function track(socket, url) {
    if (!isImagineSocket(url)) return socket;
    sockets.push(socket);
    socket.addEventListener("message", (event) => {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event.data);
        } catch (_) {}
      }
    });
    socket.addEventListener("close", () => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
    return socket;
  }

  function PatchedWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    return track(socket, url);
  }

  Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    try {
      Object.defineProperty(PatchedWebSocket, key, { value: NativeWebSocket[key] });
    } catch (_) {}
  }
  window.WebSocket = PatchedWebSocket;

  function openSocket() {
    return sockets.find((socket) => socket.readyState === NativeWebSocket.OPEN) || null;
  }

  function waitForOpenSocket(timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const socket = openSocket();
        if (socket) {
          clearInterval(timer);
          resolve(socket);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          const states = sockets.map((socket) => socket.readyState).join(",");
          reject(new Error(`existing websocket not open states=${states || "none"} url=${location.href}`));
        }
      }, 100);
    });
  }

  function waitForSocketOpen(socket, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      if (socket.readyState === NativeWebSocket.OPEN) {
        resolve(socket);
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      const onOpen = () => {
        cleanup();
        resolve(socket);
      };
      const onError = () => {
        cleanup();
        reject(new Error(`websocket error readyState=${socket.readyState} url=${location.href}`));
      };
      const onClose = (event) => {
        cleanup();
        reject(new Error(`websocket close code=${event.code} reason=${event.reason || ""} clean=${event.wasClean} elapsedMs=${Date.now() - startedAt} url=${location.href}`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`websocket open timeout readyState=${socket.readyState} elapsedMs=${Date.now() - startedAt} url=${location.href}`));
      }, timeoutMs);
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
  }

  async function ensureImagineSocket(wsUrl) {
    let socket = await waitForOpenSocket(5000).catch(() => null);
    if (socket) return socket;
    if (!location.href.includes("/imagine/saved")) {
      throw new Error(`existing websocket not open states=${sockets.map((item) => item.readyState).join(",") || "none"} url=${location.href}`);
    }
    socket = track(new NativeWebSocket(wsUrl || "wss://grok.com/ws/imagine/listen"), wsUrl || "wss://grok.com/ws/imagine/listen");
    return waitForSocketOpen(socket, 10000);
  }

  function collectEvent(raw, requestId, eventsState) {
    const text = typeof raw === "string" ? raw : "";
    if (!text) return;
    if (text.slice(0, 32).includes('"type":"image"') || text.slice(0, 80).includes('"blob"')) {
      eventsState.signalSeen = true;
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.request_id === requestId) {
        eventsState.events.push(parsed);
        eventsState.signalSeen = true;
      }
    } catch (_) {}
  }

  function mediaGenVariant(mediaGenInput) {
    const input = mediaGenInput && typeof mediaGenInput === "object" ? mediaGenInput : {};
    for (const key of ["imageToImage", "imageToVideo", "referenceToVideo", "textToVideo", "videoExtension"]) {
      if (input[key] && typeof input[key] === "object") return { kind: key, params: input[key] };
    }
    return { kind: "", params: {} };
  }

  function responseModelMap(payload) {
    return payload?.responseMetadata?.modelConfigOverride?.modelMap || {};
  }

  function imageReferenceUrls(payload) {
    const modelMap = responseModelMap(payload);
    const imageConfig = modelMap.imageEditModelConfig || {};
    const videoConfig = modelMap.videoGenModelConfig || {};
    const urls = [];
    for (const value of [
      ...(Array.isArray(imageConfig.imageReferences) ? imageConfig.imageReferences : []),
      ...(Array.isArray(videoConfig.imageReferences) ? videoConfig.imageReferences : []),
      ...(Array.isArray(payload?.grokChameleonUploadUrls) ? payload.grokChameleonUploadUrls : []),
    ]) {
      if (typeof value === "string" && value && !urls.includes(value)) urls.push(value);
    }
    return urls;
  }

  function compactStoreProbeValue(value) {
    const output = { type: typeof value };
    try {
      if (value && (typeof value === "object" || typeof value === "function")) {
        output.keys = Object.getOwnPropertyNames(value).slice(0, 30);
        if (typeof value.getState === "function") {
          const state = value.getState();
          output.stateKeys = state && typeof state === "object" ? Object.getOwnPropertyNames(state).slice(0, 50) : [];
          output.hasGenerateVideoForImage = typeof state?.generateVideoForImage === "function";
          output.hasFetchGenerateImageEdits = typeof state?.fetchGenerateImageEdits === "function";
          output.hasImageByMediaId = Boolean(state?.imageByMediaId);
          output.hasVideoByMediaId = Boolean(state?.videoByMediaId);
          output.hasById = Boolean(state?.byId);
        }
      }
    } catch (error) {
      output.error = error?.message || String(error);
    }
    return output;
  }

  function knownMediaStoreModuleProbe() {
    const probes = [];
    for (let runtimeIndex = 0; runtimeIndex < capturedRuntimes.length && probes.length < 12; runtimeIndex += 1) {
      const runtime = capturedRuntimes[runtimeIndex];
      if (!runtime) continue;
      for (const moduleId of MEDIA_STORE_MODULE_IDS) {
        try {
          const value = runtime.c?.[moduleId] || runtime.c?.[String(moduleId)];
          if (value) {
            probes.push({
              runtimeIndex,
              moduleId: String(moduleId),
              source: `runtime.c[${moduleId}]`,
              value: compactStoreProbeValue(value),
            });
          }
        } catch (error) {
          probes.push({
            runtimeIndex,
            moduleId: String(moduleId),
            source: `runtime.c[${moduleId}]`,
            error: error?.message || String(error),
          });
        }
        if (probes.length >= 12) return probes;
      }
    }
    return probes;
  }

  function getMediaStoreState() {
    scanAllRuntimes();
    if (!capturedMediaStore || typeof capturedMediaStore.getState !== "function") {
      const moduleCounts = capturedRuntimes.map((runtime) => {
        try {
          return Object.keys(runtime.c || {}).length;
        } catch (_) {
          return 0;
        }
      });
      const probe = knownMediaStoreModuleProbe();
      pushStoreTrace("media_store_missing_probe", { probe });
      throw new Error(`Official Imagine media store was not captured url=${location.href} runtimes=${capturedRuntimes.length} modules=${moduleCounts.join(",") || "none"} probe=${JSON.stringify(probe).slice(0, 1200)}`);
    }
    const record = mediaStoreRecord(capturedMediaStore);
    const state = capturedMediaStore.getState();
    wrapMediaStoreStateMethods(state, record);
    return state;
  }

  async function waitForMediaStore(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      scanAllRuntimes();
      if (capturedMediaStore) return getMediaStoreState();
      await sleep(100);
    }
    return getMediaStoreState();
  }

  function mediaStoreStateForRecord(record) {
    const state = record?.store?.getState?.();
    wrapMediaStoreStateMethods(state, record);
    return state;
  }

  function listFunctionNames(value, limit = 120) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
    const names = new Set();
    let cursor = value;
    let depth = 0;
    while (cursor && depth < 4) {
      for (const key of Object.getOwnPropertyNames(cursor)) {
        if (key === "constructor") continue;
        try {
          if (typeof Reflect.get(value, key) === "function") names.add(key);
        } catch (_) {}
      }
      cursor = Object.getPrototypeOf(cursor);
      depth += 1;
    }
    return Array.from(names).sort().slice(0, limit);
  }

  function resolveStoreV2Method(state, record, name) {
    if (typeof capturedStoreV2Methods !== "function") return { fn: null, source: "" };
    for (const candidate of [
      { source: "getStoreV2Methods(state)", value: state },
      { source: "getStoreV2Methods(recordState)", value: record?.store?.getState?.() },
      { source: "getStoreV2Methods(store)", value: record?.store },
    ]) {
      if (!candidate.value) continue;
      try {
        const methods = capturedStoreV2Methods(candidate.value);
        const fn = methods ? Reflect.get(methods, name) : null;
        if (typeof fn === "function") {
          return {
            fn: (...args) => fn(...args),
            source: candidate.source,
          };
        }
      } catch (error) {
        pushStoreTrace("store_v2_method_resolve_error", {
          name,
          error: error?.message || String(error),
          source: candidate.source,
        });
      }
    }
    return { fn: null, source: "" };
  }

  function resolveStoreMethod(state, record, name) {
    const v2Method = resolveStoreV2Method(state, record, name);
    if (v2Method.fn) return v2Method;
    for (const candidate of [
      { source: "state", owner: state },
      { source: "store", owner: record?.store },
    ]) {
      if (!candidate.owner) continue;
      try {
        const fn = Reflect.get(candidate.owner, name);
        if (typeof fn === "function") {
          const own = Object.prototype.hasOwnProperty.call(candidate.owner, name);
          return {
            fn: fn.bind(candidate.owner),
            source: own ? candidate.source : `${candidate.source}Inherited`,
          };
        }
      } catch (_) {}
    }
    return { fn: null, source: "" };
  }

  function mediaStoreRecordMatches(state, ids) {
    const values = (ids || []).filter(Boolean).map(String);
    for (const id of values) {
      if (state?.byId?.[id]) return `byId:${id}`;
      if (Array.isArray(state?.imageByMediaId?.[id])) return `imageByMediaId:${id}`;
      if (Array.isArray(state?.videoByMediaId?.[id])) return `videoByMediaId:${id}`;
      if (state?.directLoadRootContainerByChildId?.[id]) return `directLoadRootContainerByChildId:${id}`;
    }
    return "";
  }

  function preferredMediaStoreContext(ids = []) {
    scanAllRuntimes();
    if (capturedMediaStores.length === 0) {
      const state = getMediaStoreState();
      return { record: mediaStoreRecord(capturedMediaStore), state, matchedBy: "single" };
    }
    let fallback = null;
    for (const record of capturedMediaStores) {
      try {
        const state = mediaStoreStateForRecord(record);
        const matchedBy = mediaStoreRecordMatches(state, ids);
        const context = { record, state, matchedBy };
        if (!fallback) fallback = context;
        if (matchedBy) return context;
      } catch (_) {}
    }
    if (fallback) return fallback;
    const state = getMediaStoreState();
    return { record: mediaStoreRecord(capturedMediaStore), state, matchedBy: "fallback" };
  }

  function itemUrl(item, expectedType) {
    if (!item || typeof item !== "object") return "";
    if (expectedType === "video") {
      return item.mediaUrl || item.videoUrl || item.hdMediaUrl || item.url || "";
    }
    return item.mediaUrl || item.imageUrl || item.url || "";
  }

  function itemThumbUrl(item) {
    if (!item || typeof item !== "object") return "";
    return item.thumbnailImageUrl || item.thumbnailUrl || item.previewImageUrl || item.previewUrl || "";
  }

  function isTemporaryImageUrl(url) {
    return String(url || "").startsWith("data:image/");
  }

  function storeItemsForContainer(state, containerId, expectedType) {
    const byContainer = expectedType === "video" ? state?.videoByMediaId : state?.imageByMediaId;
    const list = byContainer && containerId ? byContainer[containerId] : null;
    return Array.isArray(list) ? list : [];
  }

  function storeItemId(item) {
    return String(item?.id || item?.itemId || "");
  }

  function mediaItemTimeMs(value) {
    const text = String(value || "").trim();
    if (!text) return 0;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function addTrackedVideoId(tracking, state, id) {
    const value = String(id || "").trim();
    if (!value || !tracking?.ids) return;
    tracking.ids.add(value);
    const resolved = resolvedMediaId(state, value);
    if (resolved) tracking.ids.add(resolved);
    const mapped = state?.optimisticToRealIdMap?.[value];
    if (mapped) tracking.ids.add(String(mapped));
  }

  function trackedVideoIdMatches(tracking, state, id) {
    const value = String(id || "").trim();
    if (!value || !tracking?.ids || tracking.ids.size === 0) return false;
    const values = new Set([value]);
    const resolved = resolvedMediaId(state, value);
    if (resolved) values.add(resolved);
    const mapped = state?.optimisticToRealIdMap?.[value];
    if (mapped) values.add(String(mapped));
    for (const tracked of tracking.ids) {
      if (values.has(tracked)) return true;
      const resolvedTracked = resolvedMediaId(state, tracked);
      if (resolvedTracked && values.has(resolvedTracked)) return true;
      const mappedTracked = state?.optimisticToRealIdMap?.[tracked];
      if (mappedTracked && values.has(String(mappedTracked))) return true;
    }
    return false;
  }

  function isActiveVideoGenerationItem(item) {
    const url = itemUrl(item, "video");
    const progress = Number(item?.progress);
    return Boolean(item?.isTemporaryVideoGenPlaceholder) || !url || (Number.isFinite(progress) && progress < 100);
  }

  function isFreshVideoGenerationItem(item, tracking) {
    const startedAt = Number(tracking?.startedAt || 0);
    if (!startedAt) return false;
    const createdAt = mediaItemTimeMs(item?.createTime || item?.createdAt);
    return Boolean(createdAt && createdAt >= startedAt - 3000);
  }

  function refreshTrackedVideoIds(state, containerId, beforeIds, tracking) {
    if (!tracking) return;
    for (const item of storeItemsForContainer(state, containerId, "video")) {
      const id = storeItemId(item);
      if (!id || beforeIds.has(id) || trackedVideoIdMatches(tracking, state, id)) continue;
      if (isActiveVideoGenerationItem(item) || isFreshVideoGenerationItem(item, tracking)) {
        addTrackedVideoId(tracking, state, id);
      }
    }
  }

  function hasVisibleVideoGenerationCandidate(state, containerId, beforeIds, tracking) {
    if (!tracking) return false;
    for (const item of storeItemsForContainer(state, containerId, "video")) {
      const id = storeItemId(item);
      if (!id || beforeIds.has(id)) continue;
      if (trackedVideoIdMatches(tracking, state, id)) return true;
      if (isActiveVideoGenerationItem(item) || isFreshVideoGenerationItem(item, tracking)) return true;
    }
    return false;
  }

  function shouldCollectStoreItem(state, item, expectedType, beforeIds, tracking) {
    const id = storeItemId(item);
    if (!id || beforeIds.has(id)) return false;
    if (expectedType !== "video" || !tracking) return true;
    if (trackedVideoIdMatches(tracking, state, id)) return true;
    if (isActiveVideoGenerationItem(item) || isFreshVideoGenerationItem(item, tracking)) {
      addTrackedVideoId(tracking, state, id);
      return true;
    }
    return false;
  }

  function hasFinalStoreMediaEvent(event, expectedType) {
    if (!event) return false;
    const url = expectedType === "video" ? event.videoUrl : event.imageUrl;
    if (!url) return false;
    return expectedType !== "image" || !isTemporaryImageUrl(url);
  }

  function collectStoreEvents(state, containerId, expectedType, requestId, prompt, beforeIds, tracking = null, conversationId = "", parentResponseId = "", sourceIds = []) {
    const events = [];
    const items = storeItemsForContainer(state, containerId, expectedType);
    for (const item of items) {
      const id = storeItemId(item);
      if (!shouldCollectStoreItem(state, item, expectedType, beforeIds, tracking)) continue;
      const url = itemUrl(item, expectedType);
      const progress = Number.isFinite(Number(item?.progress)) ? Number(item.progress) : (url ? 100 : 1);
      const base = {
        progress,
        prompt: item?.prompt || prompt || "",
        modelName: item?.modelName || item?.model || "",
        createdAt: item?.createTime || item?.createdAt || new Date().toISOString(),
        rootPostId: containerId || "",
        parentPostId: item?.parentPostId || containerId || "",
        originalPostId: item?.originalPostId || "",
        originalRefType: item?.originalRefType || "",
        conversationId: item?.conversationId
          || item?.conversation_id
          || conversationId
          || (containerId && !sourceIds.map(String).includes(String(containerId)) ? containerId : ""),
        responseId: item?.responseId || item?.response_id || "",
        parentResponseId: item?.parentResponseId || item?.parent_response_id || parentResponseId || "",
      };
      if (expectedType === "video") {
        events.push({
          ...base,
          moderated: Boolean(item?.moderated),
          videoId: id,
          videoPostId: id,
          videoUrl: url || "",
          thumbnailImageUrl: itemThumbUrl(item),
          resolutionName: item?.resolutionName || "",
          videoDuration: item?.duration || item?.videoDuration || "",
        });
      } else {
        events.push({
          ...base,
          imageId: id,
          assetId: id,
          imageUrl: url || "",
          mediaUrl: url || "",
          temporaryDataUrl: isTemporaryImageUrl(url),
          resolutionName: item?.resolutionName || item?.resolution || "",
        });
      }
    }
    return events;
  }

  function currentIds(state, containerId, expectedType) {
    const ids = new Set();
    for (const item of storeItemsForContainer(state, containerId, expectedType)) {
      const id = storeItemId(item);
      if (id) ids.add(id);
    }
    return ids;
  }

  function storeContainerIds(state, expectedType) {
    const byContainer = expectedType === "video" ? state?.videoByMediaId : state?.imageByMediaId;
    return Object.keys(byContainer || {}).map(String).filter(Boolean);
  }

  function allCurrentIds(state, expectedType) {
    const ids = new Set();
    const byContainer = expectedType === "video" ? state?.videoByMediaId : state?.imageByMediaId;
    for (const items of Object.values(byContainer || {})) {
      for (const item of Array.isArray(items) ? items : []) {
        const id = storeItemId(item);
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  function generationContainerIds(state, primaryContainerId, tracking = null, expectedType = "image", sourceIds = []) {
    const ids = [];
    const add = (value) => {
      const id = String(value?.id || value || "").trim();
      if (id && !ids.includes(id)) ids.push(id);
    };
    add(primaryContainerId);
    add(resolvedMediaId(state, primaryContainerId));
    add(state?.currentRootContainerId);
    add(state?.currentRootContainer);
    add(state?.selectedRootContainerId);
    for (const value of tracking?.containerSeedIds || []) add(value);
    for (const sourceId of sourceIds || []) {
      add(state?.directLoadRootContainerByChildId?.[sourceId]);
      add(containerPostIdFor(state, sourceId));
    }
    for (const value of [tracking?.sourceId, tracking?.assetId, ...(tracking?.containerSeedIds || [])]) {
      const seed = String(value || "").trim();
      if (!seed) continue;
      add(resolvedMediaId(state, seed));
      add(state?.directLoadRootContainerByChildId?.[seed]);
      add(containerPostIdFor(state, seed));
    }
    if (tracking?.discoverNewContainers) {
      const beforeContainers = tracking.beforeContainerIds instanceof Set
        ? tracking.beforeContainerIds
        : new Set(tracking.beforeContainerIds || []);
      const beforeItemIds = tracking.beforeItemIds instanceof Set
        ? tracking.beforeItemIds
        : new Set(tracking.beforeItemIds || []);
      const byContainer = expectedType === "video" ? state?.videoByMediaId : state?.imageByMediaId;
      for (const [candidateId, items] of Object.entries(byContainer || {})) {
        const list = Array.isArray(items) ? items : [];
        const hasNewItem = list.some((item) => {
          const itemId = storeItemId(item);
          return itemId && !beforeItemIds.has(itemId);
        });
        if (!beforeContainers.has(candidateId) || hasNewItem) {
          add(candidateId);
          add(resolvedMediaId(state, candidateId));
          add(containerPostIdFor(state, candidateId));
          for (const item of list) {
            const itemId = storeItemId(item);
            if (itemId && !beforeItemIds.has(itemId)) add(containerPostIdFor(state, itemId));
          }
        }
      }
    }
    return ids;
  }

  function canonicalGenerationContainerId(state, containerId, tracking, events, expectedType, sourceIds = []) {
    const excludedSourceIds = new Set([
      tracking?.sourceId,
      tracking?.assetId,
      ...(tracking?.sourceContainerIds || []),
      ...(sourceIds || []),
    ].map((value) => String(value || "").trim()).filter(Boolean));
    const candidates = generationContainerIds(state, containerId, tracking, expectedType, sourceIds);
    const beforeContainerIds = tracking?.beforeContainerIds instanceof Set
      ? tracking.beforeContainerIds
      : new Set(tracking?.beforeContainerIds || []);
    for (const event of events || []) {
      const eventRoot = String(event?.containerPostId || event?.rootPostId || event?.conversationId || "").trim();
      if (eventRoot && !candidates.includes(eventRoot)) candidates.push(eventRoot);
      const eventId = String(event?.videoPostId || event?.videoId || event?.imageId || event?.assetId || "").trim();
      const eventContainerId = eventId ? containerPostIdFor(state, eventId) : "";
      if (eventContainerId && !candidates.includes(eventContainerId)) candidates.push(eventContainerId);
    }
    const preferred = candidates.slice().reverse().find((candidateId) => (
      candidateId
      && !excludedSourceIds.has(candidateId)
      && (!tracking?.discoverNewContainers || !beforeContainerIds.has(candidateId))
      && storeItemsForContainer(state, candidateId, expectedType).some((item) => {
        const itemId = storeItemId(item);
        return itemId && !(tracking?.beforeItemIds instanceof Set && tracking.beforeItemIds.has(itemId));
      })
    ));
    if (preferred) return resolvedMediaId(state, preferred);
    if (tracking?.discoverNewContainers) return "";
    const mapped = candidates.slice().reverse().find((candidateId) => candidateId && !excludedSourceIds.has(candidateId));
    if (mapped) return resolvedMediaId(state, mapped);
    return resolvedMediaId(state, containerId || "");
  }

  function startStoreMethodCall(name, fn, args) {
    pushStoreTrace("store_generation_call_start", { name, origin: "bridge_direct", argCount: args.length, args });
    let state = "pending";
    let error = "";
    const settleResult = (result) => {
      if (result && typeof result.then === "function") {
        return result.then(
          (value) => {
            state = "resolved";
            pushStoreTrace("store_generation_call_resolved", { name, origin: "bridge_direct", value });
            return value;
          },
          (caught) => {
            state = "rejected";
            error = caught?.message || String(caught);
            pushStoreTrace("store_generation_call_rejected", { name, origin: "bridge_direct", error });
            return null;
          }
        );
      }
      state = "returned";
      pushStoreTrace("store_generation_call_returned", { name, origin: "bridge_direct", value: result });
      return Promise.resolve(result);
    };
    const promise = new Promise((resolve) => {
      setTimeout(() => {
        bridgeDirectCallDepth += 1;
        let result;
        let threw = null;
        try {
          result = fn(...args);
        } catch (caught) {
          threw = caught;
        } finally {
          bridgeDirectCallDepth -= 1;
        }
        if (threw) {
          state = "threw";
          error = threw?.message || String(threw);
          pushStoreTrace("store_generation_call_threw", { name, origin: "bridge_direct", error });
          resolve(null);
          return;
        }
        settleResult(result).then(resolve, () => resolve(null));
      }, 0);
    });
    return {
      state() {
        return { state, error };
      },
      promise,
    };
  }

  function isRateLimitedStoreCall(info) {
    return Boolean(info && ["rejected", "threw"].includes(info.state) && /rate\s*limited/i.test(String(info.error || "")));
  }

  async function retryRateLimitedStoreCall(name, fn, args, requestId, callState, maxRetries = 2, conversationRoute = null) {
    let current = callState;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const checkDeadline = Date.now() + 3000;
      let info = current ? current.state() : null;
      while (Date.now() < checkDeadline) {
        info = current ? current.state() : null;
        if (isRateLimitedStoreCall(info)) break;
        if (info && info.state !== "pending") return current;
        await sleep(250);
      }
      if (!isRateLimitedStoreCall(info)) return current;
      const delayMs = attempt === 1 ? 12000 : 25000;
      pushStoreTrace("store_generation_call_retry", {
        requestId,
        name,
        attempt,
        delayMs,
        error: info?.error || "",
      });
      await sleep(delayMs);
      if (conversationRoute?.conversationId) armConversationRequestRoute(conversationRoute);
      current = startStoreMethodCall(name, fn, args);
    }
    return current;
  }

  async function waitForStoreEvents(containerId, expectedType, requestId, prompt, beforeIds, timeoutMs, callState = null, record = null, tracking = null, conversationId = "", parentResponseId = "", sourceIds = [], responseCapture = null) {
    let deadline = Number(tracking?.baseDeadlineAt || 0) || (Date.now() + timeoutMs);
    const absoluteDeadline = Number(tracking?.absoluteDeadlineAt || 0) || deadline;
    let lastEvents = [];
    const rememberedEvents = new Map();
    let lastSnapshotLogAt = 0;
    let pollCount = 0;
    let lastSnapshotKey = "";
    while (Date.now() < deadline) {
      const state = record ? mediaStoreStateForRecord(record) : getMediaStoreState();
      const activeContainerIds = generationContainerIds(state, containerId, tracking, expectedType, sourceIds);
      if (expectedType === "video" && tracking) {
        for (const activeContainerId of activeContainerIds) {
          refreshTrackedVideoIds(state, activeContainerId, beforeIds, tracking);
        }
        for (const trackedId of tracking.ids || []) {
          if (!trackedId || beforeIds.has(trackedId) || rememberedEvents.has(trackedId)) continue;
          rememberedEvents.set(trackedId, {
            progress: 1,
            prompt: prompt || "",
            rootPostId: containerId || "",
            parentPostId: containerId || "",
            videoId: trackedId,
            videoPostId: trackedId,
            videoUrl: "",
            thumbnailImageUrl: "",
          });
        }
      }
      const snapshotContainerId = activeContainerIds.slice().reverse().find((id) => (
        storeItemsForContainer(state, id, expectedType).length > 0
      )) || containerId;
      const snapshot = storeSnapshot(state, snapshotContainerId, expectedType);
      const stateInfo = callState ? callState.state() : null;
      const snapshotKey = [
        activeContainerIds.join(","),
        snapshot.itemCount,
        snapshot.lastId,
        snapshot.lastProgress,
        snapshot.lastHasUrl,
        stateInfo?.state,
        stateInfo?.error,
      ].join("|");
      pollCount += 1;
      if (pollCount === 1 || snapshotKey !== lastSnapshotKey || Date.now() - lastSnapshotLogAt >= 10000) {
        pushStoreTrace("store_generation_poll", {
          requestId,
          snapshot,
          callState: stateInfo,
          activeContainerIds,
          trackedIds: tracking?.ids ? Array.from(tracking.ids).slice(0, 20) : [],
          pollCount,
        });
        lastSnapshotLogAt = Date.now();
        lastSnapshotKey = snapshotKey;
      }
      lastEvents = activeContainerIds.flatMap((activeContainerId) => collectStoreEvents(
        state,
        activeContainerId,
        expectedType,
        requestId,
        prompt,
        beforeIds,
        tracking,
        conversationId,
        parentResponseId,
        sourceIds,
      ));
      lastEvents.push(...generationCaptureEvents(responseCapture, expectedType, conversationId, parentResponseId));
      for (const event of lastEvents) {
        const eventId = String(event?.videoPostId || event?.videoId || event?.imageId || event?.assetId || "").trim();
        if (eventId) rememberedEvents.set(eventId, event);
      }
      let retainedEvents = Array.from(rememberedEvents.values());
      if (retainedEvents.some((event) => hasFinalStoreMediaEvent(event, expectedType))) return retainedEvents;
      if (expectedType === "video" && tracking && retainedEvents.length > 0) {
        const now = Date.now();
        const globalModerated = Boolean(state?.videoGenModerated);
        if (!globalModerated) tracking.globalModerationArmed = true;
        const globalModerationSignal = globalModerated && tracking.globalModerationArmed;
        if (globalModerationSignal) tracking.globalModerationArmed = false;
        const moderated = Boolean(
          globalModerationSignal
          || lastEvents.some((event) => event?.moderated)
          || retainedEvents.some((event) => event?.moderated)
        );
        if (moderated) {
          if (!tracking.moderatedSeenAt) {
            tracking.moderatedSeenAt = now;
            const stabilityStartedAt = tracking.firstCandidateSeenAt || now;
            tracking.moderatedStableAt = stabilityStartedAt + Number(tracking.candidateStabilizeMs || 10000);
            pushStoreTrace("store_generation_moderation_grace_start", {
              requestId,
              containerId,
              candidateStabilizeMs: tracking.candidateStabilizeMs,
              moderatedStableAt: tracking.moderatedStableAt,
              trackedIds: Array.from(tracking.ids || []).slice(0, 20),
            });
          }
          for (const [eventId, event] of rememberedEvents.entries()) {
            rememberedEvents.set(eventId, { ...event, moderated: true });
          }
          retainedEvents = Array.from(rememberedEvents.values());
          if (now >= Number(tracking.moderatedStableAt || 0)) {
            pushStoreTrace("store_generation_moderation_grace_complete", {
              requestId,
              containerId,
              stableMs: now - (tracking.firstCandidateSeenAt || tracking.moderatedSeenAt),
              trackedIds: Array.from(tracking.ids || []).slice(0, 20),
            });
            return retainedEvents;
          }
        }
        const hasInProgressCandidate = retainedEvents.some((event) => {
          const progress = Number(event?.progress);
          return !event?.videoUrl && Number.isFinite(progress) && progress > 0 && progress < 100;
        });
        if (!tracking.firstCandidateSeenAt) {
          tracking.firstCandidateSeenAt = now;
          pushStoreTrace("store_generation_candidate_stabilize_start", {
            requestId,
            containerId,
            candidateStabilizeMs: tracking.candidateStabilizeMs,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
        }
        const storeObservationMs = Number(tracking.storeObservationMs || 8000);
        if (hasInProgressCandidate && now - tracking.firstCandidateSeenAt >= storeObservationMs) {
          pushStoreTrace("store_generation_candidate_handoff", {
            requestId,
            containerId,
            observedMs: now - tracking.firstCandidateSeenAt,
            storeObservationMs,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
          return retainedEvents;
        }
        if (!tracking.retainTrackedCandidateUntilDeadline && !hasInProgressCandidate && now - tracking.firstCandidateSeenAt >= Number(tracking.candidateStabilizeMs || 10000)) {
          pushStoreTrace("store_generation_candidate_stable", {
            requestId,
            containerId,
            stableMs: now - tracking.firstCandidateSeenAt,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
          return retainedEvents;
        } else if (hasInProgressCandidate && (!tracking.lastInProgressLogAt || now - tracking.lastInProgressLogAt >= 10000)) {
          tracking.lastInProgressLogAt = now;
          pushStoreTrace("store_generation_candidate_still_in_progress", {
            requestId,
            containerId,
            maxProgress: Math.max(...retainedEvents.map((event) => Number(event?.progress) || 0)),
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
        }
      }
      if (expectedType === "video" && tracking) {
        const stateName = String(stateInfo?.state || "");
        const canStopWithoutCandidate = tracking.ids?.size > 0 || ["resolved", "returned", "rejected", "threw"].includes(stateName);
        const hasVisibleCandidate = activeContainerIds.some((activeContainerId) => (
          hasVisibleVideoGenerationCandidate(state, activeContainerId, beforeIds, tracking)
        ));
        if (tracking.retainTrackedCandidateUntilDeadline && tracking.ids?.size > 0 && deadline < absoluteDeadline) {
          deadline = absoluteDeadline;
          pushStoreTrace("store_generation_tracked_candidate_deadline_retained", {
            requestId,
            containerId,
            waitTier: tracking.waitTier || "",
            deadline,
            trackedIds: Array.from(tracking.ids).slice(0, 20),
          });
        }
        if (hasVisibleCandidate) {
          tracking.noCandidateSince = 0;
          const lateCandidateGraceMs = Number(tracking.lateCandidateGraceMs || 0);
          if (lateCandidateGraceMs > 0) {
            const extendedDeadline = Math.min(absoluteDeadline, Date.now() + lateCandidateGraceMs);
            if (extendedDeadline > deadline) {
              deadline = extendedDeadline;
              if (!tracking.lastGraceLogAt || Date.now() - tracking.lastGraceLogAt >= 5000) {
                tracking.lastGraceLogAt = Date.now();
                pushStoreTrace("store_generation_late_candidate_grace", {
                  requestId,
                  containerId,
                  extendedDeadline,
                  absoluteDeadline,
                  trackedIds: Array.from(tracking.ids || []).slice(0, 20),
                });
              }
            }
          }
        } else if (canStopWithoutCandidate) {
          const now = Date.now();
          if (!tracking.noCandidateSince) tracking.noCandidateSince = now;
          const noCandidateMs = now - tracking.noCandidateSince;
          const noCandidateMaxMs = Number(tracking.noCandidateMaxMs || 0);
          if (noCandidateMaxMs > 0 && noCandidateMs >= noCandidateMaxMs) {
            pushStoreTrace("store_generation_video_no_candidate_stop", {
              requestId,
              containerId,
              callState: stateInfo,
              trackedIds: tracking?.ids ? Array.from(tracking.ids).slice(0, 20) : [],
              noCandidateMs,
              snapshot,
            });
            return retainedEvents;
          }
        }
      }
      await sleep(500);
    }
    const finalState = record ? mediaStoreStateForRecord(record) : getMediaStoreState();
    const finalContainerIds = generationContainerIds(finalState, containerId, tracking, expectedType, sourceIds);
    const finalSnapshotContainerId = finalContainerIds.slice().reverse().find((id) => (
      storeItemsForContainer(finalState, id, expectedType).length > 0
    )) || containerId;
    const finalEvents = finalContainerIds.flatMap((finalContainerId) => collectStoreEvents(
      finalState,
      finalContainerId,
      expectedType,
      requestId,
      prompt,
      beforeIds,
      tracking,
      conversationId,
      parentResponseId,
      sourceIds,
    ));
    finalEvents.push(...generationCaptureEvents(responseCapture, expectedType, conversationId, parentResponseId));
    for (const event of finalEvents) {
      const eventId = String(event?.videoPostId || event?.videoId || event?.imageId || event?.assetId || "").trim();
      if (eventId) rememberedEvents.set(eventId, event);
    }
    const finalRetainedEvents = Array.from(rememberedEvents.values());
    pushStoreTrace("store_generation_poll_timeout", {
      requestId,
      snapshot: storeSnapshot(finalState, finalSnapshotContainerId, expectedType),
      activeContainerIds: finalContainerIds,
      callState: callState ? callState.state() : null,
      finalEventCount: finalEvents.length,
      finalMediaFound: finalRetainedEvents.some((event) => hasFinalStoreMediaEvent(event, expectedType)),
      timeoutMs,
      deadline,
      absoluteDeadline,
    });
    return finalRetainedEvents;
  }

  function mediaTypeValue(expectedType) {
    return expectedType === "video" ? "MEDIA_POST_TYPE_VIDEO" : "MEDIA_POST_TYPE_IMAGE";
  }

  function assetUrlFromFileUri(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^(?:https?:\/\/|data:|blob:)/.test(text)) return text;
    return `https://assets.grok.com/${text.replace(/^\/+/, "")}`;
  }

  function cropContainerIds(state, sourceContainerId, originalPostId) {
    const ids = [];
    const add = (value) => {
      const text = String(value || "").trim();
      if (text && !ids.includes(text)) ids.push(text);
    };
    add(containerPostIdFor(state, originalPostId));
    add(sourceContainerId);
    add(originalPostId);
    return ids;
  }

  function upsertImageIntoStore(record, state, post, containerIds, requestId) {
    const id = String(post?.id || "");
    if (!id || !record?.store || typeof record.store.setState !== "function") {
      return { updated: false, id, containerIds: [] };
    }
    const upsertListItem = (list, item) => {
      const next = Array.isArray(list) ? list.slice() : [];
      const index = next.findIndex((candidate) => String(candidate?.id || candidate?.itemId || "") === id);
      if (index >= 0) next[index] = { ...next[index], ...item };
      else next.push(item);
      return next;
    };
    const imageItem = {
      ...post,
      id,
      itemId: post.itemId || id,
      mediaType: post.mediaType || "MEDIA_POST_TYPE_IMAGE",
      mediaUrl: post.mediaUrl || post.imageUrl || post.url || "",
      thumbnailImageUrl: post.thumbnailImageUrl || post.mediaUrl || post.imageUrl || post.url || "",
      mimeType: post.mimeType || "image/png",
      originalRefType: post.originalRefType || "ORIGINAL_REF_TYPE_IMAGE_EDIT",
      images: Array.isArray(post.images) ? post.images : [],
      videos: Array.isArray(post.videos) ? post.videos : [],
      childPosts: Array.isArray(post.childPosts) ? post.childPosts : [],
    };
    const currentState = mediaStoreStateForRecord(record) || state || {};
    const byId = { ...(currentState.byId || {}) };
    byId[id] = { ...(byId[id] || {}), ...imageItem };
    const imageByMediaId = { ...(currentState.imageByMediaId || {}) };
    const directLoadRootContainerByChildId = { ...(currentState.directLoadRootContainerByChildId || {}) };
    const touched = [];
    for (const containerId of containerIds || []) {
      const key = String(containerId || "").trim();
      if (!key) continue;
      const linkedItem = {
        ...imageItem,
        originalPostId: imageItem.originalPostId || key,
        parentPostId: imageItem.parentPostId || key,
      };
      imageByMediaId[key] = upsertListItem(imageByMediaId[key], linkedItem);
      if (key !== id && byId[key] && typeof byId[key] === "object") {
        const container = { ...byId[key] };
        container.images = upsertListItem(container.images, linkedItem);
        container.childPosts = upsertListItem(container.childPosts, linkedItem);
        byId[key] = container;
      }
      if (!directLoadRootContainerByChildId[id]) directLoadRootContainerByChildId[id] = key;
      touched.push(key);
    }
    record.store.setState({ byId, imageByMediaId, directLoadRootContainerByChildId }, false);
    pushStoreTrace("store_crop_post_upsert", {
      requestId,
      id,
      containerIds: touched,
      mediaUrl: imageItem.mediaUrl || "",
      originalPostId: imageItem.originalPostId || "",
      updatedContainerFields: touched.length > 0,
    });
    return { updated: touched.length > 0, id, containerIds: touched };
  }

  function firstExistingPostId(state, ids) {
    for (const id of ids) {
      if (id && state.byId && state.byId[id]) return id;
    }
    return "";
  }

  function resolvedMediaId(state, id) {
    const value = id ? String(id) : "";
    if (!value) return "";
    return state?.optimisticToRealIdMap?.[value] || value;
  }

  function containerPostIdFor(state, id) {
    const value = resolvedMediaId(state, id);
    if (!value) return "";
    if (typeof state?.getContainerPostId === "function") {
      try {
        const containerId = state.getContainerPostId(value);
        if (containerId) return resolvedMediaId(state, containerId);
      } catch (_) {}
    }
    const directRoot = state?.directLoadRootContainerByChildId?.[value];
    if (directRoot) return resolvedMediaId(state, directRoot);
    for (const [containerId, items] of Object.entries(state?.imageByMediaId || {})) {
      if (Array.isArray(items) && items.some((item) => String(item?.id || item?.itemId || "") === value)) {
        return resolvedMediaId(state, containerId);
      }
    }
    for (const [containerId, items] of Object.entries(state?.videoByMediaId || {})) {
      if (Array.isArray(items) && items.some((item) => String(item?.id || item?.itemId || "") === value)) {
        return resolvedMediaId(state, containerId);
      }
    }
    return value;
  }

  function rootContainerIdFor(state, id) {
    return containerPostIdFor(state, id);
  }

  function syncCurrentRootContainer(state, requestId, variant, containerId) {
    if (!containerId || typeof state?.setCurrentRootContainer !== "function") return;
    try {
      state.setCurrentRootContainer(containerId);
      pushStoreTrace("store_generation_set_current_root", {
        requestId,
        variant,
        containerId,
      });
    } catch (error) {
      pushStoreTrace("store_generation_set_current_root_error", {
        requestId,
        variant,
        containerId,
        error: error?.message || String(error),
      });
    }
  }

  function normalizedAspectRatioTuple(value) {
    if (Array.isArray(value) && value.length >= 2) {
      const width = Number(value[0]);
      const height = Number(value[1]);
      if (width > 0 && height > 0) return [width, height];
    }
    const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? [width, height] : null;
  }

  function sameAspectRatio(left, right) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length >= 2
      && right.length >= 2
      && Number(left[0]) === Number(right[0])
      && Number(left[1]) === Number(right[1]);
  }

  async function applyOfficialVideoGenerationSettings({
    requestId,
    variant,
    resolutionName,
    aspectRatio,
    durationSeconds,
  }) {
    scanAllRuntimes();
    if (!capturedImagineModeStore || typeof capturedImagineModeStore.getState !== "function") {
      throw new Error("Official Imagine mode store was not captured.");
    }
    let state = capturedImagineModeStore.getState();
    const requestedResolution = ["480p", "720p", "1080p"].includes(String(resolutionName || "").toLowerCase())
      ? String(resolutionName).toLowerCase()
      : "";
    const requestedAspectRatio = normalizedAspectRatioTuple(aspectRatio);
    const requestedDuration = Number(durationSeconds || 0) || 0;
    const before = {
      resolutionName: String(state?.resolution || ""),
      aspectRatio: Array.isArray(state?.aspectRatio) ? state.aspectRatio.slice(0, 2) : state?.aspectRatio,
      videoLength: Number(state?.videoLength || 0) || 0,
    };

    let allowedResolution = requestedResolution;
    if (requestedResolution) {
      allowedResolution = String(state.allowedVideoResolution(requestedResolution) || "").toLowerCase();
      if (allowedResolution !== requestedResolution) {
        throw new Error(`Official Imagine does not allow requested video resolution ${requestedResolution}; allowed=${allowedResolution || "none"}.`);
      }
      state = capturedImagineModeStore.getState();
      state.setResolution(requestedResolution);
    }
    state = capturedImagineModeStore.getState();
    if (requestedAspectRatio && !sameAspectRatio(state.aspectRatio, requestedAspectRatio)) {
      state.setAspectRatio(requestedAspectRatio);
    }
    state = capturedImagineModeStore.getState();
    if (requestedDuration > 0 && Number(state.videoLength || 0) !== requestedDuration) {
      state.setVideoLength(requestedDuration);
    }
    await sleep(0);
    state = capturedImagineModeStore.getState();
    const after = {
      resolutionName: String(state?.resolution || "").toLowerCase(),
      aspectRatio: Array.isArray(state?.aspectRatio) ? state.aspectRatio.slice(0, 2) : state?.aspectRatio,
      videoLength: Number(state?.videoLength || 0) || 0,
    };
    if (requestedResolution && after.resolutionName !== requestedResolution) {
      throw new Error(`Official Imagine video resolution was not applied: requested=${requestedResolution} actual=${after.resolutionName || "none"}.`);
    }
    if (requestedAspectRatio && !sameAspectRatio(after.aspectRatio, requestedAspectRatio)) {
      throw new Error(`Official Imagine video aspect ratio was not applied: requested=${requestedAspectRatio.join(":")}.`);
    }
    pushStoreTrace("store_generation_official_video_settings_applied", {
      requestId,
      variant,
      requestedResolution,
      allowedResolution,
      appliedResolution: after.resolutionName,
      requestedAspectRatio,
      appliedAspectRatio: after.aspectRatio,
      requestedDuration,
      appliedDuration: after.videoLength,
      before,
      after,
      imagineModeStorePath: capturedImagineModeStorePath,
      imagineModeStoreModule: capturedImagineModeStoreModule,
    });
    return after;
  }

  function generationSourceReady(state, sourceId, rootSourceId = "") {
    const value = resolvedMediaId(state, sourceId);
    if (!value) return false;
    const rootId = resolvedMediaId(state, rootSourceId);
    if (rootId) {
      if (value === rootId && state?.byId?.[rootId]) return true;
      return hasChildItem(state?.imageByMediaId?.[rootId], value)
        || hasChildItem(state?.videoByMediaId?.[rootId], value);
    }
    if (state?.byId?.[value]) return true;
    for (const collection of [state?.imageByMediaId, state?.videoByMediaId]) {
      for (const items of Object.values(collection || {})) {
        if (Array.isArray(items) && items.some((item) => storeItemId(item) === value)) return true;
      }
    }
    return false;
  }

  async function hydrateGenerationSource(storeContext, sourceId, requestId, variant, rootSourceId = "", timeoutMs = 8000) {
    const value = String(sourceId || "").trim();
    let state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
    if (!value || generationSourceReady(state, value, rootSourceId)) return state;
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(1000, Number(timeoutMs) || 8000);
    const targets = [];
    const addTarget = (candidate) => {
      const id = String(candidate || "").trim();
      if (id && !targets.includes(id)) targets.push(id);
    };
    addTarget(rootSourceId);
    addTarget(containerPostIdFor(state, value));
    addTarget(value);
    pushStoreTrace("store_generation_source_hydration_start", {
      requestId,
      variant,
      sourceId: value,
      targets,
    });
    for (const targetId of targets) {
      state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      const fetchMethod = resolveStoreMethod(state, storeContext.record, "fetchMediaPost");
      if (!fetchMethod.fn) break;
      const callState = startStoreMethodCall("fetchMediaPost", fetchMethod.fn, [targetId]);
      await Promise.race([
        callState.promise,
        sleep(Math.max(250, Math.min(4000, deadline - Date.now()))),
      ]);
      state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      if (generationSourceReady(state, value, rootSourceId)) {
        pushStoreTrace("store_generation_source_hydration_ready", {
          requestId,
          variant,
          sourceId: value,
          targetId,
          elapsedMs: Date.now() - startedAt,
        });
        return state;
      }
      if (Date.now() >= deadline) break;
    }
    while (Date.now() < deadline) {
      state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      if (generationSourceReady(state, value, rootSourceId)) {
        pushStoreTrace("store_generation_source_hydration_ready", {
          requestId,
          variant,
          sourceId: value,
          elapsedMs: Date.now() - startedAt,
        });
        return state;
      }
      await sleep(100);
    }
    pushStoreTrace("store_generation_source_hydration_timeout", {
      requestId,
      variant,
      sourceId: value,
      elapsedMs: Date.now() - startedAt,
    });
    return state;
  }

  async function ensureContainerFromInput(state, expectedType, prompt, inputIds, urls, mimeType) {
    const existingId = firstExistingPostId(state, inputIds);
    if (existingId) return containerPostIdFor(state, existingId);
    if (urls.length > 0 && typeof state.createMediaPostFromUrl === "function") {
      const post = await state.createMediaPostFromUrl(urls[0], mimeType || (expectedType === "video" ? "video/mp4" : "image/png"));
      if (post?.id) return post.id;
    }
    if (inputIds[0]) return containerPostIdFor(state, inputIds[0]);
    if (typeof state.createMediaPostFromPrompt === "function") {
      const post = await state.createMediaPostFromPrompt(mediaTypeValue(expectedType), prompt || "");
      if (post?.id) {
        if (typeof state.like === "function") state.like(post.id).catch(() => {});
        return post.id;
      }
    }
    return inputIds[0] || "";
  }

  async function runStoreGeneration({ requestId, requestPayload, maxWaitMs }) {
    const startedAt = Date.now();
    const payload = requestPayload || {};
    await waitForMediaStore(12000);
    const variant = mediaGenVariant(payload.mediaGenInput);
    const params = variant.params || {};
    const prompt = params.prompt || payload.message || "";
    const modelMap = responseModelMap(payload);
    const videoConfig = modelMap.videoGenModelConfig || {};
    const imageConfig = modelMap.imageEditModelConfig || {};
    const rawInputAssets = Array.isArray(params.inputAssets) ? params.inputAssets.filter(Boolean) : [];
    const inputIds = rawInputAssets.map(String);
    const urls = imageReferenceUrls(payload);
    const conversationId = String(payload.grokChameleonConversationId || "").trim();
    const parentResponseId = String(payload.grokChameleonParentResponseId || "").trim();
    const directUpload = Boolean(payload.grokChameleonDirectUpload);
    const startNewConversation = Boolean(payload.grokChameleonStartNewConversation || directUpload);
    const continueExistingConversation = Boolean(conversationId) && !startNewConversation;
    const directUploadAssetIds = Array.isArray(payload.grokChameleonUploadAssetIds)
      ? payload.grokChameleonUploadAssetIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const conversationRoute = {
      requestId,
      modelName: payload.modelName,
      conversationId,
      parentResponseId,
      directUpload,
    };
    const storeContext = preferredMediaStoreContext([conversationId, parentResponseId].concat(inputIds));
    let state = storeContext.state;
    const events = [{ progress: 1, requestId, nativeStore: true, variant: variant.kind }];
    pushStoreTrace("store_generation_start", {
      requestId,
      modelName: payload.modelName,
      variant: variant.kind,
      inputIds,
      urls,
      conversationId,
      parentResponseId,
      startNewConversation,
      mediaStorePath: capturedMediaStorePath,
      mediaStoreModule: capturedMediaStoreModule,
      storeId: storeContext.record?.id,
      storePath: storeContext.record?.path,
      storeModule: storeContext.record?.moduleId,
      matchedBy: storeContext.matchedBy,
    });

    if (payload.modelName === "imagine-image-edit" || variant.kind === "imageToImage") {
      const explicitImageContainerSeedId = String(
        conversationId
        || imageConfig.containerPostId
        || imageConfig.parentPostId
        || imageConfig.rootPostId
        || imageConfig.originalPostId
        || payload.containerPostId
        || payload.parentPostId
        || payload.rootPostId
        || payload.originalPostId
        || ""
      ).trim();
      if (!startNewConversation && explicitImageContainerSeedId && typeof state.resolveRootContainerForDirectLoad === "function") {
        try {
          const userId = state?.currentUserId || state?.byId?.[explicitImageContainerSeedId]?.userId || "";
          await state.resolveRootContainerForDirectLoad(explicitImageContainerSeedId, userId);
          state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
        } catch (error) {
          pushStoreTrace("store_generation_image_root_resolve_error", {
            requestId,
            explicitImageContainerSeedId,
            error: error?.message || String(error),
          });
        }
      }
      const explicitImageContainerId = explicitImageContainerSeedId
        ? containerPostIdFor(state, explicitImageContainerSeedId)
        : "";
      const containerId = explicitImageContainerId || await ensureContainerFromInput(state, "image", prompt, inputIds, urls, "image/png");
      if (!containerId) throw new Error("Official image edit container could not be resolved.");
      const parentPostId = directUpload ? undefined : (imageConfig.parentPostId || inputIds[0] || containerId);
      if (!startNewConversation) {
        state = await hydrateGenerationSource(
          storeContext,
          parentPostId || inputIds[0] || containerId,
          requestId,
          variant.kind,
          containerId,
        );
        syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      }
      state = ensureStoreLoginState(
        state,
        storeContext.record,
        requestId,
        "fetchGenerateImageEdits",
        [containerId].concat(inputIds, directUploadAssetIds),
      );
      if (!startNewConversation) syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      const beforeIds = startNewConversation ? allCurrentIds(state, "image") : currentIds(state, containerId, "image");
      for (const sourceId of [containerId, parentPostId, inputIds[0]]) {
        const value = String(sourceId || "").trim();
        if (value) beforeIds.add(value);
      }
      if (typeof state.fetchGenerateImageEdits !== "function") throw new Error("Official fetchGenerateImageEdits is missing.");
      const imageArgs = {
        imageUrls: urls,
        prompt: prompt || " ",
        source: "imagine_feed_query_bar",
        isRedo: false,
      };
      if (!directUpload) {
        if (!startNewConversation) imageArgs.containerPostId = containerId;
        imageArgs.parentPostId = parentPostId;
        imageArgs.conversationId = continueExistingConversation ? conversationId : undefined;
        imageArgs.parentResponseId = continueExistingConversation ? parentResponseId : undefined;
        imageArgs.numOfImages = params.numOfImages;
        imageArgs.mediaGenInput = payload.mediaGenInput;
      }
      const requestedAspectRatio = params.aspectRatio || imageConfig.aspectRatio;
      const requestedResolution = params.resolutionName || imageConfig.resolutionName;
      if (requestedAspectRatio) imageArgs.aspectRatio = requestedAspectRatio;
      if (requestedResolution) imageArgs.resolutionName = requestedResolution;
      const args = [imageArgs];
      const imageTracking = {
        sourceId: directUploadAssetIds[0] || inputIds[0] || containerId,
        assetId: directUploadAssetIds[0] || inputIds[0] || "",
        sourceContainerIds: startNewConversation ? [containerId, explicitImageContainerSeedId].filter(Boolean) : [],
        containerSeedIds: [containerId, explicitImageContainerSeedId].filter(Boolean),
        beforeContainerIds: new Set(storeContainerIds(state, "image")),
        beforeItemIds: beforeIds,
        discoverNewContainers: startNewConversation,
      };
      pushStoreTrace("store_generation_image_args", {
        requestId,
        containerId,
        parentPostId,
        explicitImageContainerSeedId,
        directUpload,
        startNewConversation,
        beforeIds: Array.from(beforeIds),
        snapshot: storeSnapshot(mediaStoreStateForRecord(storeContext.record), containerId, "image"),
        storeId: storeContext.record?.id,
        storePath: storeContext.record?.path,
        storeModule: storeContext.record?.moduleId,
        matchedBy: storeContext.matchedBy,
        args,
      });
      const imageResponseCapture = armGenerationResponseCapture({
        requestId,
        modelName: payload.modelName,
        expectedType: "image",
        prompt,
      });
      if (continueExistingConversation) armConversationRequestRoute(conversationRoute);
      const callState = startStoreMethodCall("fetchGenerateImageEdits", state.fetchGenerateImageEdits.bind(state), args);
      let resultEvents = await waitForStoreEvents(
        containerId,
        "image",
        requestId,
        prompt,
        beforeIds,
        Math.max(3000, maxWaitMs || 30000),
        callState,
        storeContext.record,
        imageTracking,
        conversationId,
        parentResponseId,
        inputIds,
        imageResponseCapture,
      );
      const finalState = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      const captureCanonicalContainerId = startNewConversation
        ? generationCaptureCanonicalId(
          imageResponseCapture,
          resultEvents,
          "image",
          [containerId, ...inputIds, ...directUploadAssetIds],
        )
        : "";
      const canonicalContainerId = startNewConversation
        ? (
          captureCanonicalContainerId
          || canonicalGenerationContainerId(finalState, containerId, imageTracking, resultEvents, "image", inputIds)
        )
        : "";
      if (startNewConversation && canonicalContainerId) {
        resultEvents = resultEvents.map((event) => ({
          ...event,
          containerPostId: canonicalContainerId,
          rootPostId: canonicalContainerId,
          conversationId: event?.conversationId || canonicalContainerId,
        }));
      }
      releaseGenerationResponseCapture(imageResponseCapture);
      return {
        ok: true,
        status: 200,
        text: "",
        events: events.concat(resultEvents),
        canonicalContainerId,
        resolvedContainerId: canonicalContainerId || containerId,
        resolvedParentPostId: parentPostId || "",
        sourceContainerId: explicitImageContainerSeedId || containerId,
        baselineIds: Array.from(beforeIds),
        elapsedMs: Date.now() - startedAt,
        bridgeStatus: this.status(),
        storeTrace: storeTrace.slice(-90),
      };
    }

    if (payload.modelName === "imagine-video-gen" || ["imageToVideo", "referenceToVideo", "textToVideo", "videoExtension"].includes(variant.kind)) {
      let containerId = "";
      let parentPostId;
      let mode = "normal";
      const queryBarLocation = "imagine-query-bar-v2";
      const queryBarSource = "imagine_post_query_bar_v2";
      let location = queryBarLocation;
      let source = queryBarSource;
      let extendPostId;
      let extendCurrentTime = 0;
      let imageReferences;
      let isRedo = false;
      let videoInputAsset;
      const duration = params.duration;
      const resolutionName = String(params.resolutionName || videoConfig.resolutionName || "").trim().toLowerCase();
      const durationSeconds = Number(duration || videoConfig.videoLength || 0) || 0;
      const useOfficialUiAction = false;
      const longI2vWait = ["imageToVideo", "referenceToVideo", "videoExtension"].includes(variant.kind)
        && ["720p", "1080p"].includes(resolutionName)
        && durationSeconds >= 10;
      const tieredI2vWait = ["imageToVideo", "referenceToVideo", "videoExtension"].includes(variant.kind);
      const highResolutionVideo = ["720p", "1080p"].includes(resolutionName);
      const videoWaitTier = !tieredI2vWait
        ? "default"
        : longI2vWait
          ? "long"
          : highResolutionVideo
            ? "high_short"
            : (durationSeconds >= 10 ? "mid" : "low");
      const officialVideoWaitMs = videoWaitTier === "long"
        ? 170000
        : videoWaitTier === "high_short"
          ? 137000
          : videoWaitTier === "mid" ? 99000 : 80000;
      const videoRecoveryMs = videoWaitTier === "long"
        ? 30000
        : ["high_short", "mid"].includes(videoWaitTier) ? 20000 : 10000;
      const candidateStabilizeMs = videoWaitTier === "long" ? 30000 : 10000;
      const fileAttachmentIds = Array.isArray(payload.fileAttachments)
        ? payload.fileAttachments.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const videoSeedId = variant.kind === "videoExtension"
        ? (inputIds[0] || videoConfig.extendPostId || videoConfig.parentPostId || "")
        : (inputIds[0] || videoConfig.parentPostId || "");
      const explicitRootSeedId = (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo")
        ? (conversationId || videoConfig.rootPostId || videoConfig.originalPostId || fileAttachmentIds[0] || "")
        : (variant.kind === "videoExtension" ? (conversationId || videoConfig.rootPostId || "") : "");
      const rootSeedId = (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo")
        ? (explicitRootSeedId || videoSeedId)
        : (videoConfig.rootPostId || videoConfig.originalPostId || videoSeedId);
      if (directUpload && !conversationId && videoSeedId && !generationSourceReady(state, videoSeedId) && urls.length > 0) {
        await ensureContainerFromInput(state, "image", prompt, inputIds, urls, "image/png");
        state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      }
      if (!startNewConversation && videoSeedId && typeof state.resolveRootContainerForDirectLoad === "function") {
        try {
          const userId = state?.currentUserId || state?.byId?.[videoSeedId]?.userId || "";
          await state.resolveRootContainerForDirectLoad(videoSeedId, userId);
          state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
        } catch (error) {
          pushStoreTrace("store_generation_root_resolve_error", {
            requestId,
            videoSeedId,
            error: error?.message || String(error),
          });
        }
      }
      const rootContainerId = rootContainerIdFor(state, explicitRootSeedId || rootSeedId);
      let generateVideoMethod = resolveStoreMethod(state, storeContext.record, "generateVideoForImage");
      const stateFunctionNames = listFunctionNames(state);
      const storeFunctionNames = listFunctionNames(storeContext.record?.store);
      pushStoreTrace("store_generation_video_method_probe", {
        requestId,
        variant: variant.kind,
        videoSeedId,
        explicitRootSeedId,
        rootSeedId,
        rootContainerId,
        fileAttachmentIds,
        hasMediaGenInput: Boolean(payload.mediaGenInput),
        hasGetStoreV2Methods: typeof capturedStoreV2Methods === "function",
        storeV2MethodsPath: capturedStoreV2MethodsPath,
        storeV2MethodsModule: capturedStoreV2MethodsModule,
        hasGenerateVideoForImage: Boolean(generateVideoMethod.fn),
        generateVideoMethodSource: generateVideoMethod.source,
        source,
        location,
        methodCount: stateFunctionNames.length + storeFunctionNames.length,
        stateFunctionNames,
        storeFunctionNames,
      });

      if (variant.kind === "textToVideo") {
        containerId = await ensureContainerFromInput(state, "video", prompt, [], [], "video/mp4");
      } else if (variant.kind === "referenceToVideo") {
        const explicitReferenceUrls = Array.isArray(videoConfig.imageReferences)
          ? videoConfig.imageReferences.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const existingParentId = firstExistingPostId(state, inputIds);
        parentPostId = directUpload ? undefined : (videoConfig.parentPostId || existingParentId || inputIds[0] || undefined);
        videoInputAsset = directUploadAssetIds[0] || parentPostId || rawInputAssets[0] || inputIds[0] || undefined;
        containerId = directUpload
          ? (rootContainerId || videoInputAsset || await ensureContainerFromInput(state, "video", prompt, inputIds, urls, "video/mp4"))
          : (videoInputAsset || parentPostId || rootContainerId || videoConfig.rootPostId || videoConfig.originalPostId);
        const extraReferenceUrls = explicitReferenceUrls.length > 1
          ? explicitReferenceUrls.slice(1)
          : (urls.length > 1 ? urls.slice(1) : []);
        imageReferences = extraReferenceUrls.length > 0 ? extraReferenceUrls : undefined;
      } else if (variant.kind === "videoExtension") {
        extendPostId = inputIds[0] || videoConfig.extendPostId || videoConfig.parentPostId || "";
        containerId = extendPostId || rootContainerId || videoConfig.rootPostId;
        videoInputAsset = extendPostId;
        parentPostId = undefined;
        extendCurrentTime = Number(params.videoExtensionStartTime ?? videoConfig.videoExtensionStartTime ?? 0) || 0;
        imageReferences = undefined;
      } else {
        const existingParentId = firstExistingPostId(state, inputIds);
        parentPostId = directUpload ? undefined : (existingParentId || videoConfig.parentPostId || inputIds[0] || undefined);
        videoInputAsset = directUploadAssetIds[0] || rawInputAssets[0] || parentPostId;
        containerId = directUpload
          ? (rootContainerId || videoInputAsset || parentPostId || await ensureContainerFromInput(state, "image", prompt, inputIds, urls, "image/png"))
          : (videoInputAsset || parentPostId || rootContainerId || videoConfig.rootPostId || videoConfig.originalPostId);
        if (containerId && videoInputAsset && containerId !== videoInputAsset) {
          pushStoreTrace("store_generation_source_link_skipped", {
            requestId,
            containerId,
            videoInputAsset,
            reason: "avoid_duplicate_source_card",
          });
        }
        const explicitReferenceUrls = Array.isArray(videoConfig.imageReferences)
          ? videoConfig.imageReferences.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        imageReferences = explicitReferenceUrls.length > 0 ? explicitReferenceUrls : undefined;
      }

      if (!containerId) throw new Error("Official video container could not be resolved.");
      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
        rootContainerId || containerId,
      );
      await applyOfficialVideoGenerationSettings({
        requestId,
        variant: variant.kind,
        resolutionName,
        aspectRatio: params.aspectRatio || videoConfig.aspectRatio,
        durationSeconds,
      });
      if (!startNewConversation && (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension")) {
        syncCurrentRootContainer(state, requestId, variant.kind, rootContainerId || containerId);
      }
      state = ensureStoreLoginState(state, storeContext.record, requestId, "generateVideoForImage", [containerId, videoInputAsset, parentPostId, extendPostId].concat(inputIds, directUploadAssetIds));
      if (!startNewConversation && (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension")) {
        syncCurrentRootContainer(state, requestId, variant.kind, rootContainerId || containerId);
      }
      generateVideoMethod = resolveStoreMethod(state, storeContext.record, "generateVideoForImage");
      if (!generateVideoMethod.fn && !useOfficialUiAction) throw new Error("Official generateVideoForImage is missing.");
      const beforeIds = startNewConversation
        ? allCurrentIds(state, "video")
        : new Set([
          ...currentIds(state, containerId, "video"),
          ...currentIds(state, rootContainerId, "video"),
        ]);
      const baseDeadlineAt = startedAt + (tieredI2vWait
        ? officialVideoWaitMs
        : Math.max(3000, Number(maxWaitMs || 90000)));
      const videoTracking = {
        ids: new Set(),
        sourceId: videoInputAsset || parentPostId || extendPostId || "",
        assetId: directUploadAssetIds[0] || "",
        sourceContainerIds: startNewConversation ? [containerId, rootContainerId, explicitRootSeedId].filter(Boolean) : [],
        containerSeedIds: [containerId, rootContainerId, explicitRootSeedId].filter(Boolean),
        beforeContainerIds: new Set(storeContainerIds(state, "video")),
        beforeItemIds: beforeIds,
        discoverNewContainers: startNewConversation,
        startedAt: Date.now(),
        waitTier: videoWaitTier,
        retainTrackedCandidateUntilDeadline: tieredI2vWait,
        noCandidateMaxMs: tieredI2vWait ? 0 : 10000,
        noCandidateSince: 0,
        baseDeadlineAt,
        absoluteDeadlineAt: tieredI2vWait ? baseDeadlineAt : baseDeadlineAt + 15000,
        lateCandidateGraceMs: tieredI2vWait ? 0 : 15000,
        candidateStabilizeMs,
        storeObservationMs: 8000,
        recoveryMs: videoRecoveryMs,
        firstCandidateSeenAt: 0,
        lastGraceLogAt: 0,
        moderatedSeenAt: 0,
        moderatedStableAt: 0,
        globalModerationArmed: !Boolean(state?.videoGenModerated),
      };
      pushStoreTrace("store_generation_wait_policy", {
        requestId,
        variant: variant.kind,
        resolutionName,
        durationSeconds,
        longI2vWait,
        waitTier: videoWaitTier,
        officialVideoWaitMs,
        recoveryMs: videoRecoveryMs,
        baseDeadlineAt: videoTracking.baseDeadlineAt,
        absoluteDeadlineAt: videoTracking.absoluteDeadlineAt,
        noCandidateMaxMs: videoTracking.noCandidateMaxMs,
        lateCandidateGraceMs: videoTracking.lateCandidateGraceMs,
        candidateStabilizeMs: videoTracking.candidateStabilizeMs,
        storeObservationMs: videoTracking.storeObservationMs,
        startNewConversation,
      });
      videoGenerationPreflight(state, containerId, videoInputAsset, requestId);
      const onVideoGenerationStart = (inflightId) => {
        const callbackState = mediaStoreStateForRecord(storeContext.record);
        addTrackedVideoId(videoTracking, callbackState, inflightId);
        if (!videoTracking.firstCandidateSeenAt) videoTracking.firstCandidateSeenAt = Date.now();
        refreshTrackedVideoIds(callbackState, containerId, beforeIds, videoTracking);
        pushStoreTrace("store_generation_video_start_callback", {
          requestId,
          containerId,
          inflightId,
          trackedIds: Array.from(videoTracking.ids).slice(0, 20),
          snapshot: storeSnapshot(callbackState, containerId, "video"),
        });
      };
      const args = [
        containerId,
        videoInputAsset,
        mode,
        location,
        undefined,
        prompt,
        extendPostId,
        extendCurrentTime,
        duration,
        false,
        undefined,
        source,
        isRedo,
        imageReferences,
        onVideoGenerationStart,
        payload.mediaGenInput
      ];
      pushStoreTrace("store_generation_video_args", {
        requestId,
        variant: variant.kind,
        containerId,
        parentPostId,
        videoInputAsset,
        extendPostId,
        extendCurrentTime,
        duration,
        source,
        location,
        isRedo,
        imageReferences,
        videoConfigImageReferences: Array.isArray(videoConfig.imageReferences) ? videoConfig.imageReferences : [],
        beforeIds: Array.from(beforeIds),
        snapshot: storeSnapshot(mediaStoreStateForRecord(storeContext.record), containerId, "video"),
        storeId: storeContext.record?.id,
        storePath: storeContext.record?.path,
        storeModule: storeContext.record?.moduleId,
        matchedBy: storeContext.matchedBy,
        args,
      });
      let callState;
      if (useOfficialUiAction) {
        callState = await clickOfficialVideoAction({ requestId, variant: variant.kind, prompt });
      } else {
        const videoResponseCapture = armGenerationResponseCapture({
          requestId,
          modelName: payload.modelName,
          expectedType: "video",
          prompt,
        });
        if (continueExistingConversation) armConversationRequestRoute(conversationRoute);
        callState = startStoreMethodCall("generateVideoForImage", generateVideoMethod.fn, args);
        callState = await retryRateLimitedStoreCall("generateVideoForImage", generateVideoMethod.fn, args, requestId, callState, 2, conversationRoute);
        videoTracking.responseCapture = videoResponseCapture;
      }
      const videoResponseCapture = videoTracking.responseCapture || null;
      const remainingWaitMs = Math.max(1000, videoTracking.baseDeadlineAt - Date.now());
      let resultEvents = await waitForStoreEvents(
        containerId,
        "video",
        requestId,
        prompt,
        beforeIds,
        remainingWaitMs,
        callState,
        storeContext.record,
        videoTracking,
        conversationId,
        parentResponseId,
        inputIds,
        videoResponseCapture,
      );
      const finalState = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      const captureCanonicalContainerId = startNewConversation
        ? generationCaptureCanonicalId(
          videoResponseCapture,
          resultEvents,
          "video",
          [containerId, ...inputIds, ...directUploadAssetIds],
        )
        : "";
      const canonicalContainerId = startNewConversation
        ? (
          captureCanonicalContainerId
          || canonicalGenerationContainerId(finalState, containerId, videoTracking, resultEvents, "video", inputIds)
        )
        : "";
      if (startNewConversation && canonicalContainerId) {
        resultEvents = resultEvents.map((event) => ({
          ...event,
          containerPostId: canonicalContainerId,
          rootPostId: canonicalContainerId,
          conversationId: event?.conversationId || canonicalContainerId,
        }));
      }
      releaseGenerationResponseCapture(videoResponseCapture);
      return {
        ok: true,
        status: 200,
        text: "",
        events: events.concat(resultEvents),
        canonicalContainerId,
        resolvedContainerId: canonicalContainerId || containerId,
        resolvedParentPostId: parentPostId || videoInputAsset || extendPostId || "",
        sourceContainerId: rootContainerId || videoConfig.rootPostId || videoConfig.originalPostId || "",
        baselineIds: Array.from(beforeIds),
        elapsedMs: Date.now() - startedAt,
        bridgeStatus: this.status(),
        storeTrace: storeTrace.slice(-90),
      };
    }

    throw new Error(`Unsupported official store generation payload model=${payload.modelName || ""} variant=${variant.kind || ""}`);
  }

  async function runCropImage({ requestId, imageData, fileName, mimeType, originalPostId, sourceContainerId }) {
    const startedAt = Date.now();
    await waitForMediaStore(12000);
    const ids = [sourceContainerId, originalPostId].filter(Boolean).map(String);
    const storeContext = preferredMediaStoreContext(ids);
    let state = ensureStoreLoginState(storeContext.state, storeContext.record, requestId, "createMediaPostFromUrl", ids);
    const blob = await fetch(String(imageData || "")).then((response) => {
      if (!response.ok) throw new Error(`Crop data URL could not be read: ${response.status}`);
      return response.blob();
    });
    const uploadForm = new FormData();
    uploadForm.append("file", blob, fileName || "cropped.png");
    pushStoreTrace("store_crop_upload_start", {
      requestId,
      originalPostId,
      sourceContainerId,
      fileName,
      mimeType,
      size: blob.size,
    });
    const uploadResponse = await fetch("/http/upload-file-v2/direct", {
      method: "POST",
      credentials: "include",
      body: uploadForm,
    });
    const uploadText = await uploadResponse.text();
    let uploadJson = {};
    try {
      uploadJson = uploadText.trim() ? JSON.parse(uploadText) : {};
    } catch (_) {}
    if (!uploadResponse.ok) {
      throw new Error(`Crop upload HTTP ${uploadResponse.status}: ${uploadText.slice(0, 500)}`);
    }
    const metadata = uploadJson.fileMetadata || {};
    const fileId = String(metadata.fileMetadataId || "");
    const fileUri = String(metadata.fileUri || "");
    const mediaUrl = assetUrlFromFileUri(fileUri);
    if (!fileId || !mediaUrl) throw new Error("Crop upload response did not include file metadata.");
    state = mediaStoreStateForRecord(storeContext.record) || state;
    const createCroppedImagePost = typeof state?.createCroppedImagePost === "function"
      ? state.createCroppedImagePost.bind(state)
      : null;
    let createJson = {};
    let post = {};
    let storeUpdate = { updated: false, officialMethod: false, id: fileId, containerIds: [] };
    if (createCroppedImagePost) {
      const callState = startStoreMethodCall("createCroppedImagePost", createCroppedImagePost, [{
        parentPostId: String(originalPostId || ""),
        mediaUrl,
      }]);
      const officialPost = await callState.promise;
      post = officialPost && typeof officialPost === "object" ? officialPost : {};
      createJson = { post };
      storeUpdate = {
        updated: Boolean(post?.id),
        officialMethod: true,
        id: post?.id || fileId,
        containerIds: cropContainerIds(mediaStoreStateForRecord(storeContext.record) || state, sourceContainerId, originalPostId),
        callState: callState.state(),
      };
      if (typeof state?.fetchMediaPost === "function") {
        startStoreMethodCall("fetchMediaPost", state.fetchMediaPost.bind(state), [String(originalPostId || "")]);
      }
      if (typeof state?.setLastViewedMediaId === "function" && post?.id) {
        startStoreMethodCall("setLastViewedMediaId", state.setLastViewedMediaId.bind(state), [
          String(sourceContainerId || originalPostId || ""),
          String(post.id),
        ]);
      }
    } else {
      const createPayload = {
        mediaType: "MEDIA_POST_TYPE_IMAGE",
        mediaUrl,
        originalPostId: String(originalPostId || ""),
        originalRefType: "ORIGINAL_REF_TYPE_IMAGE_EDIT",
      };
      pushStoreTrace("store_crop_post_create_start", {
        requestId,
        payload: createPayload,
      });
      const createResponse = await fetch("/rest/media/post/create", {
        method: "POST",
        credentials: "include",
        headers: {
          "accept": "application/json, text/plain, */*",
          "content-type": "application/json",
        },
        body: JSON.stringify(createPayload),
      });
      const createText = await createResponse.text();
      try {
        createJson = createText.trim() ? JSON.parse(createText) : {};
      } catch (_) {}
      if (!createResponse.ok) {
        throw new Error(`Crop post create HTTP ${createResponse.status}: ${createText.slice(0, 500)}`);
      }
      post = createJson.post || {};
    }
    if (!post.id) post.id = fileId;
    if (!post.mediaUrl) post.mediaUrl = mediaUrl;
    if (!post.mimeType) post.mimeType = metadata.fileMimeType || mimeType || "image/png";
    if (!post.originalPostId) post.originalPostId = String(originalPostId || "");
    if (!post.originalRefType) post.originalRefType = "ORIGINAL_REF_TYPE_IMAGE_EDIT";
    if (!storeUpdate.officialMethod) {
      state = mediaStoreStateForRecord(storeContext.record) || state;
      const containers = cropContainerIds(state, sourceContainerId, originalPostId);
      storeUpdate = upsertImageIntoStore(storeContext.record, state, post, containers, requestId);
    }
    return {
      ok: true,
      status: 200,
      upload: uploadJson,
      result: createJson,
      post,
      fileId,
      mediaUrl,
      originalPostId: String(originalPostId || ""),
      sourceContainerId: String(sourceContainerId || ""),
      storeUpdate,
      elapsedMs: Date.now() - startedAt,
      bridgeStatus: this.status(),
      storeTrace: storeTrace.slice(-90),
    };
  }

  window.__grokChameleonImagineBridge = {
    status() {
      return {
        url: location.href,
        socketCount: sockets.length,
        socketStates: sockets.map((socket) => socket.readyState),
        hasOpenSocket: Boolean(openSocket()),
        hasMediaStore: Boolean(capturedMediaStore),
        mediaStorePath: capturedMediaStorePath,
        mediaStoreModule: capturedMediaStoreModule,
        mediaStoreCount: capturedMediaStores.length,
        hasStoreV2Methods: typeof capturedStoreV2Methods === "function",
        storeV2MethodsPath: capturedStoreV2MethodsPath,
        storeV2MethodsModule: capturedStoreV2MethodsModule,
        hasImagineModeStore: Boolean(capturedImagineModeStore),
        imagineModeStorePath: capturedImagineModeStorePath,
        imagineModeStoreModule: capturedImagineModeStoreModule,
        mediaStores: capturedMediaStores.slice(0, 12).map((record) => ({
          id: record.id,
          path: record.path,
          moduleId: record.moduleId,
        })),
        turbopackRuntimeCount: capturedRuntimes.length,
        turbopackModuleCounts: capturedRuntimes.map((runtime) => {
          try {
            return Object.keys(runtime.c || {}).length;
          } catch (_) {
            return 0;
          }
        }),
      };
    },
    mediaContext(ids = []) {
      const values = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
      try {
        const context = preferredMediaStoreContext(values);
        return {
          ok: true,
          hasMediaStore: Boolean(context.state),
          matchedBy: context.matchedBy || "",
          ids: values,
          status: this.status(),
        };
      } catch (error) {
        return {
          ok: false,
          error: error?.message || String(error),
          ids: values,
          status: this.status(),
        };
      }
    },
    async runT2I({ wsUrl, requestId, resetPayload, createPayload, maxWaitMs, expectedCount }) {
      const startedAt = Date.now();
      const socket = await ensureImagineSocket(wsUrl);
      const state = { events: [], signalSeen: false };
      const listener = (raw) => collectEvent(raw, requestId, state);
      const wantedCount = Math.max(1, Number(expectedCount) || 1);
      const receiveLimit = wantedCount + 3;
      let completedGraceStartedAt = 0;
      let lastCompletedCount = 0;
      listeners.add(listener);
      try {
        socket.send(JSON.stringify(resetPayload));
        await new Promise((resolve) => setTimeout(resolve, 250));
        socket.send(JSON.stringify(createPayload));
        await new Promise((resolve) => {
          const done = () => {
            const completed = state.events.filter((event) => String(event.current_status || "").toLowerCase() === "completed").length;
            const terminal = state.events.some((event) => {
              const text = JSON.stringify(event || {}).toLowerCase();
              const status = String(event?.current_status || event?.status || "").toLowerCase();
              return status.includes("moderated")
                || status.includes("failed")
                || status.includes("error")
                || text.includes("content_policy_violation")
                || text.includes("content was moderated")
                || text.includes("rejected by content moderation");
            });
            if (terminal) return true;
            if (completed >= receiveLimit) return true;
            if (completed >= wantedCount) {
              if (completed !== lastCompletedCount) {
                lastCompletedCount = completed;
                completedGraceStartedAt = Date.now();
              }
              return completedGraceStartedAt && Date.now() - completedGraceStartedAt >= 2500;
            }
            return false;
          };
          const timer = setInterval(() => {
            if (done()) {
              clearInterval(timer);
              resolve();
            }
          }, 250);
          const cleanup = () => {
            clearInterval(timer);
            resolve();
          };
          socket.addEventListener("close", cleanup, { once: true });
          socket.addEventListener("error", cleanup, { once: true });
        });
      } finally {
        listeners.delete(listener);
      }
      return {
        ok: true,
        events: state.events,
        signalSeen: state.signalSeen,
        elapsedMs: Date.now() - startedAt,
        bridgeStatus: this.status(),
      };
    },
    runStoreGeneration,
    runCropImage,
  };
})();
