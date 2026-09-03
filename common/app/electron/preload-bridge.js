(() => {
  const TURBOPACK_WRAP_MARK = Symbol.for("grokChameleonTurbopackWrapped");
  const METHOD_WRAP_MARK = Symbol.for("grokChameleonStoreMethodWrapped");
  const STORE_TRACE_LIMIT = 180;
  const CONFIRMED_IMAGE_MODERATION_STABILIZE_MS = 1000;
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
  const capturedRuntimeCacheKeys = new WeakSet();
  const capturedMediaStores = [];
  const mediaStoreReadyWaiters = [];
  const storeTrace = [];
  const runtimeScanTimers = new WeakMap();
  const runtimeScanTimerGroups = new Set();
  const runtimeScansInProgress = new WeakSet();

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
        "candidateStabilizeMs", "confirmedModerationStabilizeMs", "requireMaterialized",
        "fileAttachments", "resolvedImageReferences", "videoGenModelConfig",
        "imageEditModelConfig", "mediaGenInput", "params", "url", "mimeType",
        "filename", "fileName", "grokChameleonDirectUpload", "grokChameleonUploadAssetIds", "grokChameleonUploadUrls",
        "activeContainerIds", "canonicalContainerId", "discoverNewContainers", "startNewConversation",
        "moderationDetectedAtMs", "moderationElapsedMs", "moderated", "provisionalModerated",
        "videoGenModerated", "captureDone", "captureRequestCount", "grokChameleonTerminalModeration",
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
      apiError: "",
      moderated: false,
      moderationReason: "",
      provisionalModerated: false,
      provisionalModerationReason: "",
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
    const activeCaptures = generationResponseCaptures.filter((capture) => (
      !capture.released && !capture.done
    ));
    // Electron's CDP occasionally gives main no request body for the official
    // generation endpoint.  The bridge has one generation in flight per hidden
    // account window, so bind an unlabelled response only when that makes the
    // association unambiguous.  Do not use this fallback for a known, mismatched
    // model: that would allow an ordinary conversation response to finish it.
    if (!body || typeof body !== "object" || !String(body.modelName || "")) {
      return activeCaptures.length === 1 ? activeCaptures[0] : null;
    }
    const modelName = String(body.modelName || "");
    const variant = mediaGenVariant(body.mediaGenInput);
    const bodyPrompt = String(variant.params?.prompt || body.message || "").replace(/\s*--mode=custom\s*$/i, "").trim();
    for (let index = activeCaptures.length - 1; index >= 0; index -= 1) {
      const capture = activeCaptures[index];
      if (capture.modelName && capture.modelName !== modelName) continue;
      if (capture.prompt && bodyPrompt && capture.prompt.trim() !== bodyPrompt) continue;
      return capture;
    }
    return null;
  }

  function generationPayloadModerationReason(value) {
    if (!value || typeof value !== "object") return "";
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
      for (const [rawKey, child] of Object.entries(current)) {
        const key = String(rawKey || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const text = typeof child === "string" ? child.trim().toLowerCase() : "";
        const asserted = child === true || child === 1 || /^(?:true|1|yes|moderated|contentpolicyviolation)$/.test(text);
        if (
          asserted
          && ["moderated", "ismoderated", "contentmoderated", "contentpolicyviolation"].includes(key)
        ) {
          return key;
        }
        if (
          ["status", "state", "code", "reason", "error", "message", "detail"].includes(key)
          && /(?:\bmoderated\b|content[_\s-]*policy[_\s-]*violation|rejected by content moderation)/i.test(text)
        ) {
          return key;
        }
        if (child && typeof child === "object") stack.push(child);
      }
    }
    return "";
  }

  function updateGenerationCaptureMetadata(capture, value) {
    if (!capture || !value || typeof value !== "object") return;
    const moderationReason = generationPayloadModerationReason(value);
    if (moderationReason) {
      // Image and video responses can both report prompt screening while generation
      // continues. Metadata is therefore diagnostic only; a terminal streaming frame,
      // or a response that ends without any terminal frame, decides the final result.
      capture.provisionalModerated = true;
      capture.provisionalModerationReason = capture.provisionalModerationReason || moderationReason;
    }
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
      if (!capture.apiError) {
        const errorValue = current.error;
        if (errorValue && typeof errorValue === "object" && errorValue.message) {
          capture.apiError = String(errorValue.message || "").trim();
        } else if (typeof errorValue === "string") {
          capture.apiError = errorValue.trim();
        }
      }
      if (!capture.apiError && Array.isArray(current.streamErrors)) {
        const streamError = current.streamErrors.find((item) => item && (item.message || typeof item === "string"));
        if (streamError) {
          capture.apiError = String(streamError.message || streamError || "").trim();
        }
      }
      for (const child of Object.values(current)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    if (
      capture.apiError
      && generationPayloadModerationReason({ error: capture.apiError })
    ) {
      // A moderation-shaped error before the terminal generation frame is another
      // provisional screening signal, not a transport failure.
      capture.provisionalModerated = true;
      capture.provisionalModerationReason = capture.provisionalModerationReason || "error";
      capture.apiError = "";
    }
  }

  function finalizeGenerationCapture(capture) {
    if (!capture || capture.moderated) return;
    const hasTerminalResponse = capture.events.some((event) => event?.grokChameleonTerminalResponse === true);
    if (!hasTerminalResponse && capture.provisionalModerated) {
      // Some rejected requests end after an id-less moderation payload. It is final only
      // after the response stream itself has closed; while the stream is open the same
      // payload is just the initial prompt-screening phase.
      capture.moderated = true;
      capture.moderationReason = capture.provisionalModerationReason || "moderated";
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
    const progressValue = Number(node.progress ?? node.percentageComplete ?? node.percentage_complete);
    const progress = Number.isFinite(progressValue) ? progressValue : (url ? 100 : 1);
    const nodeModerationReason = generationPayloadModerationReason(node);
    const moderated = Boolean(nodeModerationReason);
    const terminalResponse = progress >= 100;
    const terminalModeration = terminalResponse && moderated;
    if (!id && !url && !Object.prototype.hasOwnProperty.call(node, "progress")) return;
    // A later frame can revise moderation for the same id/progress pair.
    const key = [type, id, progress, url, moderated ? "1" : "0"].join("|");
    if (capture.eventKeys.has(key)) return;
    capture.eventKeys.add(key);
    if (terminalResponse) {
      // Final-only semantics: an early true is provisional, and a later terminal
      // success is allowed to clear it. Never promote metadata to progress=100.
      capture.events = capture.events.filter((event) => !event?.grokChameleonTerminalResponse);
      capture.moderated = terminalModeration;
      capture.moderationReason = terminalModeration
        ? (capture.moderationReason || nodeModerationReason || capture.provisionalModerationReason || "moderated")
        : "";
    }
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
      moderated,
    };
    if (type === "video") {
      capture.events.push({
        ...base,
        grokChameleonTerminalResponse: terminalResponse,
        grokChameleonTerminalModeration: terminalModeration,
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
        grokChameleonTerminalResponse: terminalResponse,
        grokChameleonTerminalModeration: terminalModeration,
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
      finalizeGenerationCapture(capture);
      pushStoreTrace("generation_response_capture_done", {
        requestId: capture.requestId,
        status: capture.status,
        eventCount: capture.events.length,
        conversationId: capture.conversationId,
        rootPostId: capture.rootPostId,
        moderated: capture.moderated,
        provisionalModerated: capture.provisionalModerated,
        error: capture.error,
      });
    }
  }

  function normalizedGenerationApiError(message) {
    const text = String(message || "").trim();
    if (!text) return "";
    if (/rate\s*limit|used up .*credits|usage.*(?:limit|exhaust)/i.test(text)) {
      return `Rate limited: ${text}`;
    }
    return text;
  }

  function acceptGenerationNetworkResponse(payload = {}) {
    let requestBody = payload.requestBody;
    if (typeof requestBody === "string") {
      try {
        requestBody = JSON.parse(requestBody);
      } catch (_) {
        requestBody = null;
      }
    }
    const capture = generationResponseCaptureForBody(requestBody);
    if (!capture) {
      pushStoreTrace("generation_response_network_unmatched", {
        endpoint: payload.endpoint || "",
        status: Number(payload.status || 0),
        modelName: requestBody?.modelName || "",
      });
      return { matched: false, requestId: "" };
    }
    capture.requestCount += 1;
    capture.status = Number(payload.status || 0);
    pushStoreTrace("generation_response_network_start", {
      requestId: capture.requestId,
      endpoint: payload.endpoint || "",
      status: capture.status,
      requestCount: capture.requestCount,
      matchedWithoutRequestBody: !String(requestBody?.modelName || ""),
    });
    for (const line of String(payload.body || "").split(/\r?\n/)) {
      parseGenerationCaptureLine(capture, line);
    }
    if (capture.status >= 400 && !capture.apiError) {
      capture.apiError = `Imagine request failed (HTTP ${capture.status}).`;
    }
    capture.done = true;
    finalizeGenerationCapture(capture);
    pushStoreTrace("generation_response_network_done", {
      requestId: capture.requestId,
      status: capture.status,
      eventCount: capture.events.length,
      conversationId: capture.conversationId,
      rootPostId: capture.rootPostId,
      apiError: capture.apiError,
      moderated: capture.moderated,
      provisionalModerated: capture.provisionalModerated,
    });
    return { matched: true, requestId: capture.requestId, eventCount: capture.events.length };
  }

  function generationCaptureEvents(capture, expectedType, conversationId = "", parentResponseId = "") {
    if (!capture) return [];
    const capturedEvents = capture.events
      .filter((event) => expectedType === "video"
        ? (event.videoId || event.videoUrl || event.grokChameleonTerminalModeration)
        : (event.imageId || event.imageUrl || event.grokChameleonTerminalModeration))
      .map((event) => ({
        ...event,
        rootPostId: event.rootPostId || capture.rootPostId || capture.conversationId || conversationId || "",
        conversationId: event.conversationId || capture.conversationId || conversationId || "",
        responseId: event.responseId || capture.responseId || "",
        parentResponseId: event.parentResponseId || capture.parentResponseId || parentResponseId || "",
      }));
    // Moderated responses can contain no media id or URL. Preserve only a confirmed
    // terminal verdict; provisional prompt-screening signals must not become a synthetic
    // progress=100 event while the response is still open.
    const hasCapturedTerminalModeration = capturedEvents.some((event) => (
      event?.moderated === true
      && (event?.grokChameleonTerminalModeration === true || Number(event?.progress) >= 100)
    ));
    if (capture.moderated && !hasCapturedTerminalModeration) {
      capturedEvents.push({
        moderated: true,
        moderationSignal: "official_response",
        moderationReason: capture.moderationReason || "",
        grokChameleonTerminalModeration: true,
        progress: 100,
        prompt: capture.prompt || "",
        modelName: capture.modelName || "",
        rootPostId: capture.rootPostId || capture.conversationId || conversationId || "",
        conversationId: capture.conversationId || conversationId || "",
        responseId: capture.responseId || "",
        parentResponseId: capture.parentResponseId || parentResponseId || "",
      });
    }
    return capturedEvents;
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

  // The native media store can retain its UI-only conversation metadata after an
  // extension.  That metadata is not part of Grok's normal media-generation
  // request and, when it leaks into the next i2v request, the service rejects
  // the request as an anti-bot violation.  Keep the request's actual generation
  // settings untouched; only omit the two proven UI-state additions.
  function canonicalImagineGenerationRequestBody(body, capture, route) {
    if (
      !body
      || typeof body !== "object"
      || String(body.modelName || "") !== "imagine-video-gen"
      || !body.mediaGenInput
      || (!capture && !route)
    ) return body;
    const removed = [];
    const next = { ...body };
    for (const key of ["responseMetadata", "kind"]) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
      delete next[key];
      removed.push(key);
    }
    if (removed.length) {
      pushStoreTrace("conversation_request_payload_normalized", {
        requestId: capture?.requestId || route?.requestId || "",
        variant: mediaGenVariant(next.mediaGenInput).kind,
        removed,
      });
    }
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
    const capture = generationResponseCaptureForBody(body);
    const canonicalBody = canonicalImagineGenerationRequestBody(body, capture, route);
    let targetInput = input;
    let targetInit = canonicalBody === body ? init : requestInitForReroute(input, init, canonicalBody);
    let endpoint = parsedUrl.pathname;
    if (route && (!route.modelName || body.modelName === route.modelName)) {
      endpoint = `/rest/app-chat/conversations/${encodeURIComponent(route.conversationId)}/responses`;
      targetInput = new URL(endpoint, parsedUrl.origin).toString();
      // Traced 2026-08-10: grok.com posts to {conversation}/responses with no
      // parentResponseId — the path already names the thread. The id we were adding comes
      // from the responseId the generation stream reports, and that id cannot be looked up
      // afterwards: grok.com answered "Response not found." and the app killed a job whose
      // video it had in fact finished. Send what the site sends and let the path route it.
      targetInit = requestInitForReroute(input, init, {
        ...canonicalBody,
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
    // Without an id here the store login patch never ran, and an unauthenticated store
    // resolves fetchGenerateImageEdits immediately without generating anything -- the edit
    // "succeeded" in 1.5s with no image. The exact posts asked for are often not loaded
    // yet, so fall back to any post the store already holds, then to the owner id carried
    // in an asset url (assets.grok.com/users/<id>/...). Every post here belongs to the
    // signed-in account, so any of them names the same owner.
    for (const post of Object.values(state?.byId || {})) {
      const owner = post?.userId || post?.user?.id || "";
      if (owner) return String(owner);
    }
    for (const value of ids) {
      const matched = /\/users\/([0-9a-f-]{36})\//i.exec(String(value || ""));
      if (matched) return matched[1];
    }
    return "";
  }

  // Store capture only says the page module exists.  A freshly opened or switched account
  // can expose that module before Grok has populated its session fields.  Do not create
  // source posts, alter a conversation, or patch the store here: wait for the page's own
  // account state before any Imagine generation is allowed to call an official method.
  function storeAccountReadiness(state) {
    return {
      loggedIn: state?.loggedIn === true,
      currentUserId: String(state?.currentUserId || "").trim(),
    };
  }

  async function waitForStoreAccountReady(record, requestId, action, timeoutMs = 12000) {
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(1000, Number(timeoutMs) || 12000);
    let state = record ? mediaStoreStateForRecord(record) : getMediaStoreState();
    let readiness = storeAccountReadiness(state);
    while (!readiness.loggedIn || !readiness.currentUserId) {
      if (Date.now() >= deadline) {
        pushStoreTrace("store_account_prepare_timeout", {
          requestId,
          action,
          elapsedMs: Date.now() - startedAt,
          loggedIn: readiness.loggedIn,
          currentUserId: readiness.currentUserId,
        });
        throw new Error("Imagine media store is still preparing for the selected account.");
      }
      await sleep(250);
      state = record ? mediaStoreStateForRecord(record) : getMediaStoreState();
      readiness = storeAccountReadiness(state);
    }
    pushStoreTrace("store_account_ready", {
      requestId,
      action,
      elapsedMs: Date.now() - startedAt,
      currentUserId: readiness.currentUserId,
    });
    return state;
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
    const firstCapture = !capturedMediaStore;
    capturedMediaStore = capturedMediaStore || value;
    capturedMediaStorePath = capturedMediaStorePath || record.path || "";
    capturedMediaStoreModule = capturedMediaStoreModule || record.moduleId || "";
    cancelAllRuntimeScans();
    if (firstCapture) releaseMediaStoreReadyWaiters();
    return true;
  }

  // The main process used to discover readiness by re-injecting a status probe every
  // 250ms. Those probes need the page's JS thread, which is exactly what the Grok
  // bundle monopolises while it loads, so they timed out precisely when the answer
  // mattered. Waiters registered here resolve from inside the page the moment the
  // store appears, so the main process only has to ask once.
  function releaseMediaStoreReadyWaiters() {
    while (mediaStoreReadyWaiters.length) {
      const waiter = mediaStoreReadyWaiters.shift();
      try {
        waiter();
      } catch (_) {}
    }
  }

  function whenMediaStoreReady(timeoutMs) {
    if (capturedMediaStore) return Promise.resolve(true);
    const limit = Math.max(0, Number(timeoutMs) || 0);
    if (!limit) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      let sweep = 0;
      let expiry = 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (sweep) clearInterval(sweep);
        if (expiry) clearTimeout(expiry);
        const index = mediaStoreReadyWaiters.indexOf(notify);
        if (index >= 0) mediaStoreReadyWaiters.splice(index, 1);
        resolve(value);
      };
      const notify = () => finish(true);
      mediaStoreReadyWaiters.push(notify);
      // Module factories schedule their own scans as chunks arrive, but sweep here too
      // so readiness never depends on one of those timers being the last to fire.
      sweep = setInterval(() => {
        try {
          scanAllRuntimes();
        } catch (_) {}
        if (capturedMediaStore) finish(true);
      }, 100);
      expiry = setTimeout(() => finish(Boolean(capturedMediaStore)), limit);
    });
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

  function runtimeCacheIdentity(runtime) {
    if (!runtime || (typeof runtime !== "object" && typeof runtime !== "function")) return null;
    const cache = runtime.c;
    if (cache && (typeof cache === "object" || typeof cache === "function")) return cache;
    return runtime;
  }

  function rememberRuntime(runtime) {
    const cacheKey = runtimeCacheIdentity(runtime);
    if (!cacheKey || capturedRuntimeCacheKeys.has(cacheKey)) return;
    capturedRuntimeCacheKeys.add(cacheKey);
    capturedRuntimes.push(runtime);
  }

  function runtimeScanComplete(requireAll = false) {
    if (!capturedMediaStore) return false;
    return !requireAll || Boolean(capturedStoreV2Methods && capturedImagineModeStore);
  }

  function scanRuntimeCache(runtime, requireAll = false) {
    const cacheKey = runtimeCacheIdentity(runtime);
    if (!cacheKey || runtimeScanComplete(requireAll) || runtimeScansInProgress.has(cacheKey)) return;
    rememberRuntime(runtime);
    runtimeScansInProgress.add(cacheKey);
    try {
      const cache = runtime.c || {};
      for (const moduleId of MEDIA_STORE_MODULE_IDS) {
        const cachedModule = cache[moduleId] || cache[String(moduleId)];
        if (cachedModule) {
          inspectTurbopackModule(cachedModule, String(moduleId));
          if (runtimeScanComplete(requireAll)) return;
        }
      }
      for (const key of Object.keys(cache)) {
        inspectTurbopackModule(cache[key], key);
        if (runtimeScanComplete(requireAll)) return;
      }
    } catch (_) {
    } finally {
      runtimeScansInProgress.delete(cacheKey);
    }
  }

  function scanAllRuntimes(requireAll = false) {
    for (const runtime of capturedRuntimes) {
      scanRuntimeCache(runtime, requireAll);
      if (runtimeScanComplete(requireAll)) return true;
    }
    return Boolean(capturedMediaStore);
  }

  function cancelAllRuntimeScans() {
    for (const timers of runtimeScanTimerGroups) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
    runtimeScanTimerGroups.clear();
  }

  function scheduleRuntimeScan(runtime, delayMs) {
    const cacheKey = runtimeCacheIdentity(runtime);
    if (!cacheKey || capturedMediaStore) return;
    let timers = runtimeScanTimers.get(cacheKey);
    if (!timers) {
      timers = new Map();
      runtimeScanTimers.set(cacheKey, timers);
    }
    runtimeScanTimerGroups.add(timers);
    const key = Number(delayMs) || 0;
    const previous = timers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      if (timers.get(key) === timer) timers.delete(key);
      if (timers.size === 0) runtimeScanTimerGroups.delete(timers);
      if (!capturedMediaStore) scanRuntimeCache(runtime);
    }, key);
    timers.set(key, timer);
  }

  function wrapTurbopackFactory(factory, ids) {
    if (typeof factory !== "function" || factory[TURBOPACK_WRAP_MARK]) return factory;
    const wrapped = function wrappedTurbopackFactory(runtime, module, exports) {
      rememberRuntime(runtime);
      try {
        return factory.apply(this, arguments);
      } finally {
        inspectTurbopackModule(module, ids);
        scheduleRuntimeScan(runtime, 100);
        scheduleRuntimeScan(runtime, 1000);
        scheduleRuntimeScan(runtime, 3000);
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
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.request_id === requestId) {
        const event = { ...parsed };
        delete event.blob;
        eventsState.events.push(event);
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

  // Find the store as soon as the page is up, instead of when a generation asks for it.
  // Nothing ever clears capturedMediaStore, so one successful capture serves this document
  // for its whole life -- the scan only ever ran repeatedly because it started too late. The
  // store lives in a Turbopack module that may not be evaluated at DOMContentLoaded, so this
  // retries on load and once more after, and does nothing at all once the store is in hand.
  let mediaStorePrimed = false;
  async function primeMediaStore(timeoutMs = 20000) {
    if (capturedMediaStore || mediaStorePrimed) return Boolean(capturedMediaStore);
    mediaStorePrimed = true;
    try {
      await waitForMediaStore(timeoutMs);
    } catch (_) {
    } finally {
      mediaStorePrimed = false;
    }
    if (capturedMediaStore) {
      pushStoreTrace("media_store_primed", {
        path: capturedMediaStorePath,
        moduleId: capturedMediaStoreModule,
        readyState: document.readyState,
      });
    }
    return Boolean(capturedMediaStore);
  }

  function schedulePrimeMediaStore() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => primeMediaStore(), { once: true });
    } else {
      primeMediaStore();
    }
    window.addEventListener("load", () => primeMediaStore(), { once: true });
    // A route change can pull the module in later than the first two attempts.
    setTimeout(() => primeMediaStore(), 8000);
  }

  schedulePrimeMediaStore();

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
    if (event?.moderated === true && !isTerminalModerationEvent(event, expectedType)) return false;
    const url = expectedType === "video" ? event.videoUrl : event.imageUrl;
    if (!url) return false;
    return expectedType !== "image" || !isTemporaryImageUrl(url);
  }

  function isTerminalVideoModerationEvent(event) {
    return Boolean(
      event?.moderated === true
      && (
        event?.grokChameleonTerminalModeration === true
        || Number(event?.progress) >= 100
      )
    );
  }

  function isTerminalImageModerationEvent(event) {
    return Boolean(
      event?.moderated === true
      && (
        event?.grokChameleonTerminalModeration === true
        || Number(event?.progress) >= 100
      )
    );
  }

  function isTerminalModerationEvent(event, expectedType) {
    return expectedType === "video"
      ? isTerminalVideoModerationEvent(event)
      : isTerminalImageModerationEvent(event);
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
          moderated: Boolean(item?.moderated),
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

  function finalRateLimitedStoreCallError(callState, events, expectedType) {
    const info = callState ? callState.state() : null;
    if (!isRateLimitedStoreCall(info)) return "";
    const values = Array.isArray(events) ? events : [];
    if (values.some((event) => hasFinalStoreMediaEvent(event, expectedType))) return "";
    return String(info.error || "").trim() || "Rate limited";
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
        Boolean(state?.videoGenModerated),
        Boolean(responseCapture?.done),
        Boolean(responseCapture?.moderated),
        Boolean(responseCapture?.provisionalModerated),
      ].join("|");
      pollCount += 1;
      if (pollCount === 1 || snapshotKey !== lastSnapshotKey || Date.now() - lastSnapshotLogAt >= 10000) {
        pushStoreTrace("store_generation_poll", {
          requestId,
          snapshot,
          callState: stateInfo,
          activeContainerIds,
          trackedIds: tracking?.ids ? Array.from(tracking.ids).slice(0, 20) : [],
          videoGenModerated: Boolean(state?.videoGenModerated),
          captureDone: Boolean(responseCapture?.done),
          captureRequestCount: Number(responseCapture?.requestCount || 0),
          moderated: Boolean(responseCapture?.moderated),
          provisionalModerated: Boolean(responseCapture?.provisionalModerated),
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
      // A policy response can legitimately use the API error field and omit all media.
      // Its terminal moderation signal below is more specific than a generic API error.
      const responseApiError = responseCapture?.moderated
        ? ""
        : normalizedGenerationApiError(responseCapture?.apiError);
      if (responseApiError) {
        pushStoreTrace("store_generation_response_error", {
          requestId,
          containerId,
          expectedType,
          error: responseApiError,
        });
        throw new Error(responseApiError);
      }
      for (const event of lastEvents) {
        const eventId = String(event?.videoPostId || event?.videoId || event?.imageId || event?.assetId || "").trim();
        if (eventId) rememberedEvents.set(eventId, event);
      }
      let retainedEvents = Array.from(rememberedEvents.values());
      if (tracking) {
        const terminalModerationSignals = lastEvents.filter((event) => isTerminalModerationEvent(event, expectedType));
        if (terminalModerationSignals.length > 0) {
          const detectedAt = tracking.moderatedSeenAt || Date.now();
          tracking.moderatedSeenAt = detectedAt;
          for (const event of terminalModerationSignals) {
            const eventId = String(expectedType === "video"
              ? (event?.videoPostId || event?.videoId || "")
              : (event?.imageId || event?.assetId || event?.postId || "")
            ).trim();
            if (!eventId) continue;
            rememberedEvents.set(eventId, {
              ...event,
              grokChameleonTerminalModeration: true,
              grokChameleonModerationDetectedAtMs: detectedAt,
            });
          }
          retainedEvents = Array.from(rememberedEvents.values());
          const idlessSignals = terminalModerationSignals
            .filter((event) => !String(expectedType === "video"
              ? (event?.videoPostId || event?.videoId || "")
              : (event?.imageId || event?.assetId || event?.postId || "")
            ).trim())
            .map((event) => ({
              ...event,
              grokChameleonTerminalModeration: true,
              grokChameleonModerationDetectedAtMs: detectedAt,
            }));
          pushStoreTrace("store_generation_terminal_moderation", {
            requestId,
            containerId,
            expectedType,
            moderationDetectedAtMs: detectedAt,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
          return retainedEvents.concat(idlessSignals);
        }
      }
      if (retainedEvents.some((event) => hasFinalStoreMediaEvent(event, expectedType))) return retainedEvents;
      if (isRateLimitedStoreCall(stateInfo)) {
        pushStoreTrace("store_generation_rate_limited_stop", {
          requestId,
          containerId,
          expectedType,
          callState: stateInfo,
          retainedEventCount: retainedEvents.length,
        });
        return retainedEvents;
      }
      if (expectedType === "image" && tracking && retainedEvents.length > 0) {
        const imageCandidates = retainedEvents.filter((event) => String(
          event?.imageId || event?.assetId || event?.postId || ""
        ).trim());
        const allImageCandidatesModerated = imageCandidates.length > 0
          && imageCandidates.every(isTerminalImageModerationEvent);
        if (allImageCandidatesModerated) {
          const now = Date.now();
          if (!tracking.moderatedSeenAt) {
            tracking.moderatedSeenAt = now;
            pushStoreTrace("store_generation_image_moderation_fast_path_start", {
              requestId,
              containerId,
              moderationDetectedAtMs: tracking.moderatedSeenAt,
              trackedIds: imageCandidates.map((event) => String(
                event?.imageId || event?.assetId || event?.postId || ""
              ).trim()).slice(0, 20),
            });
          }
          for (const [eventId, event] of rememberedEvents.entries()) {
            if (event?.moderated === true) {
              rememberedEvents.set(eventId, {
                ...event,
                grokChameleonModerationDetectedAtMs: tracking.moderatedSeenAt,
              });
            }
          }
          retainedEvents = Array.from(rememberedEvents.values());
          if (now - tracking.moderatedSeenAt >= CONFIRMED_IMAGE_MODERATION_STABILIZE_MS) {
            pushStoreTrace("store_generation_image_moderation_fast_path_complete", {
              requestId,
              containerId,
              moderationDetectedAtMs: tracking.moderatedSeenAt,
              moderationElapsedMs: now - tracking.moderatedSeenAt,
            });
            return retainedEvents;
          }
        } else {
          tracking.moderatedSeenAt = 0;
        }
      }
      // An official i2i response may be moderated before it creates any media entry.
      // Such a signal has no id, so it intentionally never enters rememberedEvents.
      // Return it after the same short stabilization window used for store-backed image
      // moderation instead of eventually reporting a misleading missing-media failure.
      if (expectedType === "image" && tracking) {
        const idlessModerationSignals = lastEvents.filter((event) => Boolean(
          isTerminalImageModerationEvent(event)
          && !String(event?.imageId || event?.assetId || event?.postId || "").trim()
        ));
        if (idlessModerationSignals.length) {
          const now = Date.now();
          if (!tracking.moderatedSeenAt) {
            tracking.moderatedSeenAt = now;
            pushStoreTrace("store_generation_image_response_moderation_start", {
              requestId,
              containerId,
              moderationDetectedAtMs: tracking.moderatedSeenAt,
            });
          }
          if (now - tracking.moderatedSeenAt >= CONFIRMED_IMAGE_MODERATION_STABILIZE_MS) {
            pushStoreTrace("store_generation_image_response_moderation_complete", {
              requestId,
              containerId,
              moderationDetectedAtMs: tracking.moderatedSeenAt,
              moderationElapsedMs: now - tracking.moderatedSeenAt,
            });
            return retainedEvents.concat(idlessModerationSignals.map((event) => ({
              ...event,
              grokChameleonModerationDetectedAtMs: tracking.moderatedSeenAt,
            })));
          }
        }
      }
      if (expectedType === "video" && tracking && retainedEvents.length > 0) {
        const now = Date.now();
        const globalModerated = Boolean(state?.videoGenModerated);
        if (!globalModerated) tracking.globalModerationArmed = true;
        const globalModerationSignal = globalModerated && tracking.globalModerationArmed;
        if (globalModerationSignal) tracking.globalModerationArmed = false;
        // The global store flag and sub-100 candidate flags belong to the early
        // prompt-screening/generation phases. Observe them for diagnostics, but
        // never convert them into a final moderation verdict.
        const provisionalModeration = Boolean(
          globalModerationSignal
          || lastEvents.some((event) => event?.moderated === true)
          || retainedEvents.some((event) => event?.moderated === true)
        );
        if (provisionalModeration && !tracking.provisionalModerationLogged) {
          tracking.provisionalModerationLogged = true;
          pushStoreTrace("store_generation_video_moderation_provisional", {
            requestId,
            containerId,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
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
        if (
          !tracking.retainTrackedCandidateUntilDeadline
          && hasInProgressCandidate
          && now - tracking.firstCandidateSeenAt >= storeObservationMs
        ) {
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
        const hasRequestEvidence = Boolean(
          Number(responseCapture?.requestCount || 0) > 0
          || tracking.ids?.size > 0
          || hasVisibleCandidate
        );
        const requestWatchStartedAt = Number(tracking.requestWatchStartedAt || 0);
        const requestStartMaxMs = Number(tracking.requestStartMaxMs || 0);
        const callReturnedWithoutRequest = Boolean(
          responseCapture
          && requestWatchStartedAt > 0
          && requestStartMaxMs > 0
          && !hasRequestEvidence
          && ["resolved", "returned"].includes(stateName)
          && Date.now() - requestWatchStartedAt >= requestStartMaxMs
        );
        if (callReturnedWithoutRequest) {
          tracking.requestNotStarted = true;
          pushStoreTrace("store_generation_video_request_not_started", {
            requestId,
            containerId,
            sourceId: tracking.sourceId || "",
            callState: stateInfo,
            requestCount: Number(responseCapture?.requestCount || 0),
            elapsedMs: Date.now() - requestWatchStartedAt,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
            snapshot,
          });
          return retainedEvents;
        }
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
    const finalTerminalModerationSignals = finalEvents.filter((event) => (
      isTerminalModerationEvent(event, expectedType)
    ));
    const finalDetectedAt = finalTerminalModerationSignals.length > 0
      ? (tracking?.moderatedSeenAt || Date.now())
      : 0;
    for (const event of finalEvents) {
      const eventId = String(event?.videoPostId || event?.videoId || event?.imageId || event?.assetId || "").trim();
      if (eventId) {
        rememberedEvents.set(eventId, isTerminalModerationEvent(event, expectedType)
          ? {
              ...event,
              grokChameleonTerminalModeration: true,
              grokChameleonModerationDetectedAtMs: finalDetectedAt,
            }
          : event);
      }
    }
    const finalRetainedEvents = Array.from(rememberedEvents.values());
    const finalIdlessModerationSignals = finalTerminalModerationSignals
      .filter((event) => !String(expectedType === "video"
        ? (event?.videoPostId || event?.videoId || "")
        : (event?.imageId || event?.assetId || event?.postId || "")
      ).trim())
      .map((event) => ({
        ...event,
        grokChameleonTerminalModeration: true,
        grokChameleonModerationDetectedAtMs: finalDetectedAt,
      }));
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
    return finalRetainedEvents.concat(finalIdlessModerationSignals);
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

  function containerHasSourceId(state, containerId, sourceId) {
    const container = resolvedMediaId(state, containerId);
    const source = resolvedMediaId(state, sourceId);
    if (!container || !source) return false;
    if (container === source) return true;
    const directRoot = resolvedMediaId(state, state?.directLoadRootContainerByChildId?.[source]);
    if (directRoot && directRoot === container) return true;
    return Boolean(
      hasChildItem(state?.imageByMediaId?.[container], source)
      || hasChildItem(state?.videoByMediaId?.[container], source)
    );
  }

  function collectionContainerIdFor(state, sourceId, preferredRootId = "") {
    const source = resolvedMediaId(state, sourceId);
    const preferredRoot = resolvedMediaId(state, preferredRootId);
    if (!source) return "";
    // A caller-supplied root is authoritative only when the official store proves
    // that the exact selected child belongs to it. This prevents a stale route id
    // from replacing a real source container while preserving root/child identity.
    if (preferredRoot && preferredRoot !== source && containerHasSourceId(state, preferredRoot, source)) {
      return preferredRoot;
    }
    for (const collection of [state?.imageByMediaId, state?.videoByMediaId]) {
      for (const [containerId, items] of Object.entries(collection || {})) {
        if (Array.isArray(items) && items.some((item) => (
          resolvedMediaId(state, storeItemId(item)) === source
        ))) {
          return resolvedMediaId(state, containerId);
        }
      }
    }
    return "";
  }

  function containerPostIdFor(state, id, preferredRootId = "") {
    const value = resolvedMediaId(state, id);
    if (!value) return "";

    // The official helper can temporarily return the child itself even though the
    // same store already exposes root -> child membership. Trust concrete membership
    // before that self fallback; otherwise generateVideoForImage receives child/child
    // and resolves without sending a network request.
    const collectionRoot = collectionContainerIdFor(state, value, preferredRootId);
    if (collectionRoot) return collectionRoot;

    const directRoot = resolvedMediaId(state, state?.directLoadRootContainerByChildId?.[value]);
    if (directRoot && directRoot !== value) return directRoot;

    let officialContainerId = "";
    if (typeof state?.getContainerPostId === "function") {
      try {
        officialContainerId = resolvedMediaId(state, state.getContainerPostId(value));
      } catch (_) {}
    }
    if (officialContainerId && officialContainerId !== value) return officialContainerId;
    return officialContainerId || value;
  }

  function rootContainerIdFor(state, id, preferredRootId = "") {
    return containerPostIdFor(state, id, preferredRootId);
  }

  function assertVideoGenerationIdentity(state, {
    requestId,
    variant,
    containerId,
    sourceId,
    preferredRootId,
    videoInputAsset,
    extendPostId,
    imageReferences,
    directUpload,
  }) {
    const container = resolvedMediaId(state, containerId);
    const source = resolvedMediaId(state, sourceId);
    const preferredRoot = resolvedMediaId(state, preferredRootId);
    const verifiedDistinctRoot = Boolean(
      !directUpload
      && preferredRoot
      && source
      && preferredRoot !== source
      && containerHasSourceId(state, preferredRoot, source)
    );
    if (!container) throw new Error("Official video container could not be resolved.");
    if (verifiedDistinctRoot && container !== preferredRoot) {
      throw new Error(`Imagine source identity mismatch: root=${preferredRoot} selected=${source} callRoot=${container}.`);
    }
    if (variant === "imageToVideo") {
      const inputAsset = resolvedMediaId(state, videoInputAsset);
      if (!source || !inputAsset || source !== inputAsset) {
        throw new Error(`Imagine i2v source identity mismatch: selected=${source || "none"} input=${inputAsset || "none"}.`);
      }
    } else if (variant === "referenceToVideo") {
      if (videoInputAsset !== undefined) {
        throw new Error("Imagine reference-to-video must leave the image input argument empty.");
      }
      if (!Array.isArray(imageReferences) || imageReferences.length === 0) {
        throw new Error("Imagine reference-to-video has no reference images.");
      }
    } else if (variant === "videoExtension") {
      const extensionSource = resolvedMediaId(state, extendPostId);
      if (!source || !extensionSource || source !== extensionSource) {
        throw new Error(`Imagine Extend source identity mismatch: selected=${source || "none"} extend=${extensionSource || "none"}.`);
      }
    }
    pushStoreTrace("store_generation_video_identity_verified", {
      requestId,
      variant,
      containerId: container,
      sourceId: source,
      preferredRootId: preferredRoot,
      verifiedDistinctRoot,
      videoInputAsset: resolvedMediaId(state, videoInputAsset),
      extendPostId: resolvedMediaId(state, extendPostId),
      referenceCount: Array.isArray(imageReferences) ? imageReferences.length : 0,
      directUpload: Boolean(directUpload),
    });
  }

  function assertImageGenerationIdentity(state, {
    requestId,
    variant,
    containerId,
    sourceId,
    preferredRootId,
    directUpload,
  }) {
    const container = resolvedMediaId(state, containerId);
    const source = resolvedMediaId(state, sourceId);
    const preferredRoot = resolvedMediaId(state, preferredRootId);
    const verifiedDistinctRoot = Boolean(
      !directUpload
      && preferredRoot
      && source
      && preferredRoot !== source
      && containerHasSourceId(state, preferredRoot, source)
    );
    if (!container) throw new Error("Official image edit container could not be resolved.");
    if (!directUpload && !source) throw new Error("Official image edit source could not be resolved.");
    if (verifiedDistinctRoot && container !== preferredRoot) {
      throw new Error(`Imagine image source identity mismatch: root=${preferredRoot} selected=${source} callRoot=${container}.`);
    }
    pushStoreTrace("store_generation_image_identity_verified", {
      requestId,
      variant,
      containerId: container,
      sourceId: source,
      preferredRootId: preferredRoot,
      verifiedDistinctRoot,
      directUpload: Boolean(directUpload),
    });
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
    scanAllRuntimes(true);
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

  function generationSourceReady(state, sourceId, rootSourceId = "", requireMaterialized = false) {
    const value = resolvedMediaId(state, sourceId);
    if (!value) return false;
    const sourceLoaded = Boolean(state?.byId?.[value]);
    const rootId = resolvedMediaId(state, rootSourceId);
    const sourceInRootCollection = Boolean(
      rootId
      && value !== rootId
      && (
        hasChildItem(state?.imageByMediaId?.[rootId], value)
        || hasChildItem(state?.videoByMediaId?.[rootId], value)
      )
    );
    const sourceIsExactRootChild = Boolean(
      sourceInRootCollection
      && state?.byId?.[rootId]
    );
    // Official post pages materialize a generated child in the root container's
    // image/video collection without necessarily adding a separate byId entry for
    // that child.  generateVideoForImage accepts that representation as long as
    // the root itself is loaded and the exact selected child belongs to it.
    if (requireMaterialized) return sourceLoaded || sourceIsExactRootChild;
    if (rootId) {
      if (value === rootId) return sourceLoaded;
      // fetchMediaPost(root) can populate a root's image/video collection before
      // it materializes a separate byId entry for every child.  That collection is
      // the official store's positive evidence that this source is ready; requiring
      // both representations made valid card sources look absent.
      return sourceLoaded
        || sourceInRootCollection;
    }
    if (sourceLoaded) return true;
    for (const collection of [state?.imageByMediaId, state?.videoByMediaId]) {
      for (const items of Object.values(collection || {})) {
        if (Array.isArray(items) && items.some((item) => storeItemId(item) === value)) return true;
      }
    }
    return false;
  }

  async function hydrateGenerationSource(storeContext, sourceId, requestId, variant, rootSourceId = "", timeoutMs = 8000, requireMaterialized = false) {
    const value = String(sourceId || "").trim();
    let state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
    if (!value || generationSourceReady(state, value, rootSourceId, requireMaterialized)) return state;
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(1000, Number(timeoutMs) || 8000);
    const targets = [];
    const addTarget = (candidate) => {
      const id = String(candidate || "").trim();
      if (id && !targets.includes(id)) targets.push(id);
    };
    addTarget(rootSourceId);
    addTarget(containerPostIdFor(state, value, rootSourceId));
    addTarget(value);
    pushStoreTrace("store_generation_source_hydration_start", {
      requestId,
      variant,
      sourceId: value,
      targets,
      requireMaterialized,
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
      if (generationSourceReady(state, value, rootSourceId, requireMaterialized)) {
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
      if (generationSourceReady(state, value, rootSourceId, requireMaterialized)) {
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

  async function reResolveGenerationSource(storeContext, state, rootSourceId, requestId, variant) {
    const rootId = String(rootSourceId || "").trim();
    if (!rootId || typeof state?.resolveRootContainerForDirectLoad !== "function") return state;
    try {
      const userId = state?.currentUserId || state?.byId?.[rootId]?.userId || "";
      await state.resolveRootContainerForDirectLoad(rootId, userId);
    } catch (_) {}
    return storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
  }

  async function requireGenerationSourceReady({
    storeContext,
    state,
    sourceId,
    rootSourceId,
    requestId,
    variant,
    directUpload = false,
    strict = false,
    requireMaterialized = false,
  }) {
    const source = String(sourceId || "").trim();
    const root = String(rootSourceId || "").trim();
    if (!source || !root) throw new Error("Imagine source preparation could not resolve the source container.");
    if (directUpload) return state;

    let preparedState = state;
    // An initially cold store often knows only the selected child id.  Resolving
    // that child can reveal its real root container, so carry the discovered root
    // into the next hydration/readiness pass instead of continuing to test the
    // child against itself as a root.
    let readyRoot = root;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      preparedState = await hydrateGenerationSource(
        storeContext,
        source,
        requestId,
        variant,
        readyRoot,
        8000,
        requireMaterialized,
      );
      if (generationSourceReady(preparedState, source, readyRoot, requireMaterialized)) return preparedState;
      if (attempt === 0) {
        preparedState = await reResolveGenerationSource(
          storeContext,
          preparedState,
          readyRoot,
          requestId,
          variant,
        );
        readyRoot = containerPostIdFor(preparedState, source, readyRoot) || readyRoot;
      }
    }
    pushStoreTrace("store_generation_source_hydration_unconfirmed", {
      requestId,
      variant,
      sourceId: source,
      rootSourceId: readyRoot,
      strict,
      requireMaterialized,
    });
    if (strict) {
      throw new Error("Imagine could not load the selected source from the official page.");
    }
    return preparedState;
  }

  async function ensureContainerFromInput(
    state,
    expectedType,
    prompt,
    inputIds,
    urls,
    mimeType,
    { allowCreate = true } = {},
  ) {
    const existingId = firstExistingPostId(state, inputIds);
    if (existingId) return containerPostIdFor(state, existingId);
    // A preparation pass is a readiness check, never an official write.  Creating a
    // media post here survives a later failed generation as a source-only card.
    if (!allowCreate) return inputIds[0] ? containerPostIdFor(state, inputIds[0]) : "";
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

  async function runStoreGeneration({ requestId, requestPayload, maxWaitMs, prepareOnly = false }) {
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
    // Aspect-ratio edits use Grok's image-edit wire shape (without mediaGenInput),
    // so the server supplies the already-existing source post through this bridge-only key.
    const bridgeInputAssets = rawInputAssets.length === 0 && Array.isArray(payload.grokChameleonBridgeInputAssetIds)
      ? payload.grokChameleonBridgeInputAssetIds.filter(Boolean)
      : [];
    const inputIds = (rawInputAssets.length > 0 ? rawInputAssets : bridgeInputAssets).map(String);
    const urls = imageReferenceUrls(payload);
    const conversationId = String(payload.grokChameleonConversationId || "").trim();
    const parentResponseId = String(payload.grokChameleonParentResponseId || "").trim();
    const directUpload = Boolean(payload.grokChameleonDirectUpload);
    // Grok creates a new conversation for both single-image and reference-image
    // i2v. Reusing the source card's conversation can point at the preceding
    // generation instead, and the request is then rejected. Only videoExtension
    // continues the video conversation.
    const imageToVideoStartsNewConversation = ["imageToVideo", "referenceToVideo"].includes(variant.kind);
    let startNewConversation = Boolean(
      payload.grokChameleonStartNewConversation
      || directUpload
      || imageToVideoStartsNewConversation
    );
    let continueExistingConversation = Boolean(conversationId) && !startNewConversation;
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
    let state = await waitForStoreAccountReady(storeContext.record, requestId, variant.kind);
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
      imageToVideoStartsNewConversation,
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
        || imageConfig.rootPostId
        || payload.containerPostId
        || payload.rootPostId
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
      // containerPostIdFor answers "which conversation holds this asset", so seeding it with
      // the edit's source files the edit inside that conversation. That is right when the
      // asset already belongs to the thread being continued, and wrong when it does not:
      // grok.com opens a new conversation for an edit off another card's asset (traced
      // 2026-08-14), and following the source's container instead put the result in the
      // t2i batch card the source came from. Only look up a container when continuing.
      const explicitImageContainerId = explicitImageContainerSeedId && !startNewConversation
        ? containerPostIdFor(state, explicitImageContainerSeedId, explicitImageContainerSeedId)
        : "";
      // An account-library i2i source must already be a real Grok asset.  Do not use the
      // URL fallback for it: createMediaPostFromUrl creates an official, source-only post.
      // In particular, preflight must be read-only; otherwise a failed edit leaves that
      // artificial post behind as a duplicate card on grok.com.  Hydration below fetches
      // the selected asset when it is absent from the WebView store.
      const existingImageSourceId = firstExistingPostId(state, inputIds) || inputIds[0] || "";
      const existingImageContainerId = existingImageSourceId
        ? containerPostIdFor(state, existingImageSourceId, explicitImageContainerSeedId)
        : "";
      // The official edit call takes the card/container holding the selected image and the
      // selected image itself as two different ids. Prefer the container discovered from
      // the child: a conversation id is only a hydration hint and is not always the card
      // id (standalone saved/clone assets are their own containers).
      let containerId = directUpload
        ? (
          prepareOnly
            ? (directUploadAssetIds[0] || inputIds[0] || "")
            : await ensureContainerFromInput(state, "image", prompt, inputIds, urls, "image/png")
        )
        : (existingImageContainerId || explicitImageContainerId);
      if (!containerId) throw new Error("Official image edit container could not be resolved.");
      const parentPostId = directUpload ? undefined : (imageConfig.parentPostId || inputIds[0] || containerId);
      // Loading the source into the store is about whether the source exists on grok.com,
      // not about which conversation the edit joins. An edit off an account asset needs it
      // even when it opens a new conversation: without it fetchGenerateImageEdits runs
      // against a store holding neither the source nor a signed-in user and returns in a
      // second having generated nothing. A direct upload has no media post to load, so
      // hydrating only burns the timeout on fetchMediaPost calls for unrelated
      // conversations that containerPostIdFor happens to hand back. Pointing the store's
      // current root at an existing conversation stays conditional on continuing one.
      state = await requireGenerationSourceReady({
        storeContext,
        state,
        sourceId: parentPostId || inputIds[0] || containerId,
        rootSourceId: explicitImageContainerSeedId || containerId,
        requestId,
        variant: variant.kind,
        directUpload,
        strict: true,
      });
      if (!directUpload) {
        // Hydration can reveal that a child which initially looked standalone actually
        // belongs to a root card. Re-resolve after loading so containerPostId never gets
        // the selected child merely because the relation was cold at call entry.
        const hydratedImageContainerId = containerPostIdFor(
          state,
          parentPostId || inputIds[0] || containerId,
          explicitImageContainerSeedId || containerId,
        );
        if (hydratedImageContainerId) containerId = hydratedImageContainerId;
      }
      if (!startNewConversation) {
        syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      }
      state = ensureStoreLoginState(
        state,
        storeContext.record,
        requestId,
        "fetchGenerateImageEdits",
        [containerId].concat(inputIds, directUploadAssetIds, urls),
      );
      if (!directUpload) {
        const finalImageContainerId = containerPostIdFor(
          state,
          parentPostId || inputIds[0] || containerId,
          explicitImageContainerSeedId || containerId,
        );
        if (finalImageContainerId) containerId = finalImageContainerId;
      }
      assertImageGenerationIdentity(state, {
        requestId,
        variant: variant.kind,
        containerId,
        sourceId: parentPostId || inputIds[0] || containerId,
        preferredRootId: explicitImageContainerSeedId || containerId,
        directUpload,
      });
      if (!startNewConversation) syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      if (prepareOnly) {
        return {
          ok: true,
          status: 200,
          ready: true,
          preflight: true,
          variant: variant.kind,
          elapsedMs: Date.now() - startedAt,
        };
      }
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
        forceNewConversation: startNewConversation || undefined,
      };
      if (!directUpload) {
        // Keep the source root and selected child present even when the result starts a
        // fresh conversation. The official store has a dedicated force flag for output
        // placement; removing the root instead conflates that decision with source lookup.
        imageArgs.containerPostId = containerId;
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
        moderatedSeenAt: 0,
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
      const imageRateLimitError = finalRateLimitedStoreCallError(callState, resultEvents, "image");
      if (imageRateLimitError) {
        releaseGenerationResponseCapture(imageResponseCapture);
        pushStoreTrace("store_generation_rate_limited", {
          requestId,
          expectedType: "image",
          error: imageRateLimitError,
        });
        throw new Error(imageRateLimitError);
      }
      const finalState = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      const captureCanonicalContainerId = startNewConversation
        ? generationCaptureCanonicalId(
          imageResponseCapture,
          resultEvents,
          "image",
          [containerId, ...inputIds, ...directUploadAssetIds],
        )
        : "";
      // canonicalGenerationContainerId falls back to any leftover store container when no
      // container holds a new item (line 1933), which for a direct upload is whatever
      // conversation the store still had open -- the previous edit's. Reporting that as the
      // canonical container filed the result under the earlier card, so two uploads edited
      // in a row showed up as one card until the bundle relation caught up minutes later.
      // A direct upload starts its own conversation, so take only the id the site actually
      // returned and leave it empty otherwise.
      const canonicalContainerId = startNewConversation
        ? (
          captureCanonicalContainerId
          || (directUpload
            ? ""
            : canonicalGenerationContainerId(finalState, containerId, imageTracking, resultEvents, "image", inputIds))
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
      // Grok stamps this straight into the message as "--mode=<value>" while the payload
      // carries its own mode inside mediaGenInput. Leaving the default here sent a request
      // that said normal in one place and custom in the other, and grok.com answered 403.
      // Follow whatever the payload asked for, and only fall back when it names nothing.
      let mode = String(params.mode || videoConfig.mode || "").trim() || "normal";
      const queryBarLocation = "imagine-query-bar-v2";
      const queryBarSource = "imagine_post_query_bar_v2";
      let location = queryBarLocation;
      let source = queryBarSource;
      let extendPostId;
      let extendCurrentTime = 0;
      let imageReferences;
      let isRedo = false;
      let videoInputAsset;
      let videoRequestInputIds = inputIds;
      let videoRequestMediaGenInput = payload.mediaGenInput;
      let videoConversationId = conversationId;
      let videoParentResponseId = parentResponseId;
      const duration = params.duration;
      const resolutionName = String(params.resolutionName || videoConfig.resolutionName || "").trim().toLowerCase();
      const durationSeconds = Number(duration || videoConfig.videoLength || 0) || 0;
      const useOfficialUiAction = false;
      // T2V has no source container to create or hydrate.  Its preflight only
      // establishes the selected account's official Saved/media store; creating a
      // placeholder video post here would be a write before generation.
      if (prepareOnly && variant.kind === "textToVideo") {
        return {
          ok: true,
          status: 200,
          ready: true,
          preflight: true,
          variant: variant.kind,
          elapsedMs: Date.now() - startedAt,
        };
      }
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
        ? (conversationId || videoConfig.rootPostId || fileAttachmentIds[0] || "")
        : (variant.kind === "videoExtension" ? (conversationId || videoConfig.rootPostId || "") : "");
      const rootSeedId = (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo")
        ? (explicitRootSeedId || videoSeedId)
        : (videoConfig.rootPostId || videoSeedId);
      if (!prepareOnly && directUpload && !conversationId && videoSeedId && !generationSourceReady(state, videoSeedId) && urls.length > 0) {
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
      // The first generateVideoForImage argument is always the loaded source root.
      // Starting a new output conversation is a separate official argument; blanking
      // the root here changed valid root/child sources into child/child no-op calls.
      // Resolve the callable container from the selected child first. Depending on how the
      // official store materialized the card this is either the child itself (standalone
      // saved/clone asset) or the root card containing it. conversation/root ids remain
      // hydration fallbacks, not unconditional replacements for that answer.
      let rootContainerId = rootContainerIdFor(
        state,
        videoSeedId || explicitRootSeedId || rootSeedId,
        explicitRootSeedId || rootSeedId,
      );
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
        containerId = await ensureContainerFromInput(
          state, "video", prompt, [], [], "video/mp4", { allowCreate: !prepareOnly },
        );
      } else if (variant.kind === "referenceToVideo") {
        const explicitReferenceUrls = Array.isArray(videoConfig.imageReferences)
          ? videoConfig.imageReferences.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const existingParentId = firstExistingPostId(state, inputIds);
        parentPostId = directUpload ? undefined : (videoConfig.parentPostId || existingParentId || inputIds[0] || undefined);
        // Official referenceToVideo leaves generateVideoForImage argument 2 empty. Its
        // sources are the reference URL array; parentPostId remains local readiness state
        // only and must not leak into the image-to-video parent slot.
        videoInputAsset = undefined;
        containerId = directUpload
          ? (rootContainerId || directUploadAssetIds[0] || await ensureContainerFromInput(
            state, "video", prompt, inputIds, urls, "video/mp4", { allowCreate: !prepareOnly },
          ))
          : (rootContainerId || videoConfig.rootPostId || parentPostId);
        const allReferenceUrls = explicitReferenceUrls.length > 0 ? explicitReferenceUrls : urls;
        imageReferences = allReferenceUrls.length > 0 ? allReferenceUrls : undefined;
      } else if (variant.kind === "videoExtension") {
        extendPostId = inputIds[0] || videoConfig.extendPostId || videoConfig.parentPostId || "";
        containerId = rootContainerId || videoConfig.rootPostId || extendPostId;
        // For a new extension the official argument 2 is the video's original image when
        // known, while argument 7 is the selected video child. Never duplicate the video
        // child into the image-parent slot.
        parentPostId = videoConfig.parentPostId || videoConfig.originalPostId || undefined;
        videoInputAsset = parentPostId;
        extendCurrentTime = Number(params.videoExtensionStartTime ?? videoConfig.videoExtensionStartTime ?? 0) || 0;
        imageReferences = undefined;
      } else {
        const existingParentId = firstExistingPostId(state, inputIds);
        parentPostId = directUpload ? undefined : (existingParentId || videoConfig.parentPostId || inputIds[0] || undefined);
        videoInputAsset = directUploadAssetIds[0] || rawInputAssets[0] || parentPostId;
        containerId = directUpload
          ? (rootContainerId || videoInputAsset || parentPostId || await ensureContainerFromInput(
            state, "image", prompt, inputIds, urls, "image/png", { allowCreate: !prepareOnly },
          ))
          : (rootContainerId || videoConfig.rootPostId || videoInputAsset || parentPostId);
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
      const generationSourceId = () => (
        variant.kind === "videoExtension"
          ? (extendPostId || containerId)
          : (videoInputAsset || parentPostId || containerId)
      );
      const generationRootId = () => rootContainerId || containerId;
      // I2V can start a new output conversation while still using the selected
      // source's existing root for hydration and the official method call.
      const sourceHydrationRootId = () => (
        explicitRootSeedId || rootSeedId || rootContainerId || containerId
      );
      const needsSourceReadiness = ["imageToVideo", "referenceToVideo", "videoExtension"].includes(variant.kind);
      let sourceReady = !needsSourceReadiness || (directUpload
        ? Boolean(generationSourceId() && generationRootId())
        : generationSourceReady(state, generationSourceId(), sourceHydrationRootId(), true));
      if (!sourceReady) {
        state = await requireGenerationSourceReady({
          storeContext,
          state,
          sourceId: generationSourceId(),
          rootSourceId: sourceHydrationRootId(),
          requestId,
          variant: variant.kind,
          directUpload,
          strict: true,
          requireMaterialized: true,
        });
        sourceReady = true;
      }
      if (needsSourceReadiness && !directUpload) {
        // As with image edits, a fetch during readiness may be the operation that exposes
        // root -> child membership. The official call receives that resolved root as
        // argument 1; the selected child stays in its variant-specific slot (argument 2
        // for i2v, the reference array for r2v, or argument 7 for Extend).
        const hydratedRootContainerId = rootContainerIdFor(
          state,
          generationSourceId(),
          sourceHydrationRootId(),
        );
        if (hydratedRootContainerId) {
          rootContainerId = hydratedRootContainerId;
          containerId = hydratedRootContainerId;
        }
      }
      if (prepareOnly) {
        assertVideoGenerationIdentity(state, {
          requestId,
          variant: variant.kind,
          containerId,
          sourceId: generationSourceId(),
          preferredRootId: sourceHydrationRootId(),
          videoInputAsset,
          extendPostId,
          imageReferences,
          directUpload,
        });
        return {
          ok: true,
          status: 200,
          ready: true,
          preflight: true,
          variant: variant.kind,
          elapsedMs: Date.now() - startedAt,
        };
      }
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
      state = ensureStoreLoginState(state, storeContext.record, requestId, "generateVideoForImage", [containerId, videoInputAsset, parentPostId, extendPostId].concat(videoRequestInputIds, directUploadAssetIds));
      if (needsSourceReadiness && !directUpload) {
        // Login reconciliation can replace the state snapshot. Re-derive argument 1
        // from the same selected source one final time and retain an explicit root
        // only when this snapshot still proves root -> child membership.
        const finalRootContainerId = rootContainerIdFor(
          state,
          generationSourceId(),
          sourceHydrationRootId(),
        );
        if (finalRootContainerId) {
          rootContainerId = finalRootContainerId;
          containerId = finalRootContainerId;
        }
      }
      if (!startNewConversation && (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension")) {
        syncCurrentRootContainer(state, requestId, variant.kind, rootContainerId || containerId);
      }
      assertVideoGenerationIdentity(state, {
        requestId,
        variant: variant.kind,
        containerId,
        sourceId: generationSourceId(),
        preferredRootId: sourceHydrationRootId(),
        videoInputAsset,
        extendPostId,
        imageReferences,
        directUpload,
      });
      generateVideoMethod = resolveStoreMethod(state, storeContext.record, "generateVideoForImage");
      if (!generateVideoMethod.fn && !useOfficialUiAction) throw new Error("Official generateVideoForImage is missing.");
      const beforeIds = allCurrentIds(state, "video");
      const baseDeadlineAt = startedAt + (tieredI2vWait
        ? officialVideoWaitMs
        : Math.max(3000, Number(maxWaitMs || 90000)));
      const videoTracking = {
        ids: new Set(),
        sourceId: generationSourceId() || "",
        assetId: directUploadAssetIds[0] || "",
        sourceContainerIds: startNewConversation ? [containerId, rootContainerId, explicitRootSeedId].filter(Boolean) : [],
        containerSeedIds: [containerId, rootContainerId, explicitRootSeedId].filter(Boolean),
        beforeContainerIds: new Set(storeContainerIds(state, "video")),
        beforeItemIds: beforeIds,
        discoverNewContainers: startNewConversation,
        startedAt: Date.now(),
        waitTier: videoWaitTier,
        retainTrackedCandidateUntilDeadline: tieredI2vWait || variant.kind === "textToVideo",
        noCandidateMaxMs: tieredI2vWait ? 0 : 10000,
        noCandidateSince: 0,
        requestStartMaxMs: 5000,
        requestWatchStartedAt: 0,
        requestNotStarted: false,
        baseDeadlineAt,
        absoluteDeadlineAt: tieredI2vWait ? baseDeadlineAt : baseDeadlineAt + 15000,
        lateCandidateGraceMs: tieredI2vWait ? 0 : 15000,
        candidateStabilizeMs,
        storeObservationMs: 8000,
        recoveryMs: videoRecoveryMs,
        firstCandidateSeenAt: 0,
        lastGraceLogAt: 0,
        moderatedSeenAt: 0,
        provisionalModerationLogged: false,
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
        requestStartMaxMs: videoTracking.requestStartMaxMs,
        lateCandidateGraceMs: videoTracking.lateCandidateGraceMs,
        candidateStabilizeMs: videoTracking.candidateStabilizeMs,
        storeObservationMs: videoTracking.storeObservationMs,
        startNewConversation,
      });
      videoGenerationPreflight(state, containerId, videoInputAsset, requestId);
      if (
        needsSourceReadiness
        && !directUpload
        && !generationSourceReady(state, generationSourceId(), sourceHydrationRootId(), true)
      ) {
        pushStoreTrace("store_generation_video_source_not_materialized", {
          requestId,
          variant: variant.kind,
          sourceId: generationSourceId(),
          rootSourceId: sourceHydrationRootId(),
        });
        throw new Error("Imagine could not load the selected source from the official page; generation was not sent.");
      }
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
        undefined,
        startNewConversation || undefined,
        videoRequestMediaGenInput
      ];
      const activeConversationRoute = continueExistingConversation
        ? {
            ...conversationRoute,
            conversationId: videoConversationId,
            parentResponseId: videoParentResponseId,
          }
        : null;
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
      videoTracking.requestWatchStartedAt = Date.now();
      if (useOfficialUiAction) {
        callState = await clickOfficialVideoAction({ requestId, variant: variant.kind, prompt });
      } else {
        const videoResponseCapture = armGenerationResponseCapture({
          requestId,
          modelName: payload.modelName,
          expectedType: "video",
          prompt,
        });
        if (activeConversationRoute) armConversationRequestRoute(activeConversationRoute);
        callState = startStoreMethodCall("generateVideoForImage", generateVideoMethod.fn, args);
        callState = await retryRateLimitedStoreCall("generateVideoForImage", generateVideoMethod.fn, args, requestId, callState, 2, activeConversationRoute);
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
        videoConversationId,
        videoParentResponseId,
        videoRequestInputIds,
        videoResponseCapture,
      );
      if (videoTracking.requestNotStarted) {
        releaseGenerationResponseCapture(videoResponseCapture);
        throw new Error("Imagine video generation did not start on the official page; no generation request was sent.");
      }
      const videoRateLimitError = finalRateLimitedStoreCallError(callState, resultEvents, "video");
      if (videoRateLimitError) {
        releaseGenerationResponseCapture(videoResponseCapture);
        pushStoreTrace("store_generation_rate_limited", {
          requestId,
          expectedType: "video",
          error: videoRateLimitError,
        });
        throw new Error(videoRateLimitError);
      }
      const finalState = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      const captureCanonicalContainerId = startNewConversation
        ? generationCaptureCanonicalId(
          videoResponseCapture,
          resultEvents,
          "video",
          [containerId, ...videoRequestInputIds, ...directUploadAssetIds],
        )
        : "";
      const canonicalContainerId = startNewConversation
        ? (
          captureCanonicalContainerId
          || canonicalGenerationContainerId(finalState, containerId, videoTracking, resultEvents, "video", videoRequestInputIds)
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
        resolvedParentPostId: generationSourceId() || "",
        sourceContainerId: rootContainerId || videoConfig.rootPostId || containerId || "",
        baselineIds: Array.from(beforeIds),
        elapsedMs: Date.now() - startedAt,
        bridgeStatus: this.status(),
        storeTrace: storeTrace.slice(-90),
      };
    }

    throw new Error(`Unsupported official store generation payload model=${payload.modelName || ""} variant=${variant.kind || ""}`);
  }

  async function runCropImage({ requestId, imageData, fileName, mimeType, originalPostId, sourceItemId, sourceContainerId, width, height }) {
    const startedAt = Date.now();
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
    await waitForMediaStore(12000);
    const ids = [sourceContainerId, originalPostId].filter(Boolean).map(String);
    const storeContext = preferredMediaStoreContext(ids);
    const state = ensureStoreLoginState(
      storeContext.state,
      storeContext.record,
      requestId,
      "createCroppedImagePost",
      ids,
    );
    const officialMethod = resolveStoreMethod(state, storeContext.record, "createCroppedImagePost");
    if (!officialMethod.fn) throw new Error("Official Grok Crop method is unavailable.");
    const officialArgs = {
      containerPostId: String(sourceContainerId || originalPostId || ""),
      parentPostId: String(originalPostId || ""),
      mediaUrl,
      width: Math.max(1, Number(width) || 1),
      height: Math.max(1, Number(height) || 1),
    };
    const officialCall = startStoreMethodCall(
      "createCroppedImagePost",
      officialMethod.fn,
      [officialArgs],
    );
    const officialResult = await officialCall.promise;
    const officialState = officialCall.state();
    if (["rejected", "threw"].includes(officialState.state)) {
      throw new Error(officialState.error || "Official Grok Crop failed.");
    }
    let post = {};

    const normalizeId = (value) => String(value || "").trim().toLowerCase();
    const canonicalUrl = (value) => {
      const text = String(value || "").trim();
      if (!text) return "";
      try {
        const parsed = new URL(text, location.origin);
        parsed.search = "";
        parsed.hash = "";
        return parsed.href;
      } catch (_) {
        return text.split(/[?#]/, 1)[0];
      }
    };
    const relationIds = (root) => {
      const found = new Set();
      const relationKey = (key) => {
        const compact = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return [
          "inputasset", "originalpost", "originalasset", "parentpost", "parentasset",
          "sourcepost", "sourceasset", "rootpost", "rootasset", "mediareference",
          "referenceasset", "referenceimage",
        ].some((token) => compact.includes(token)) || ["reference", "references"].includes(compact);
      };
      const visit = (value, relation = false) => {
        if (Array.isArray(value)) {
          value.forEach((item) => visit(item, relation));
          return;
        }
        if (value && typeof value === "object") {
          Object.entries(value).forEach(([key, item]) => visit(item, relation || relationKey(key)));
          return;
        }
        if (!relation || typeof value !== "string") return;
        for (const match of value.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
          found.add(match[0].toLowerCase());
        }
      };
      visit(root);
      return found;
    };
    const assetMediaUrl = (asset) => assetUrlFromFileUri(
      asset?.mediaUrl
      || asset?.imageUrl
      || asset?.url
      || asset?.assetUrl
      || asset?.fileUri
      || asset?.key
      || "",
    );
    let expectedPostId = "";
    const expectedSourceId = normalizeId(originalPostId);
    const expectedSourceIds = new Set([originalPostId, sourceItemId]
      .flatMap((value) => String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])
      .map((value) => value.toLowerCase()));
    const expectedFileId = normalizeId(fileId);
    const expectedMediaUrl = canonicalUrl(mediaUrl);
    const postIsLinked = (candidate) => Boolean(
      candidate
      && expectedPostId
      && normalizeId(candidate.id || candidate.postId || candidate.mediaPostId) === expectedPostId
      && [candidate.originalPostId, candidate.original_post_id, candidate.parentPostId, candidate.parent_post_id]
        .some((value) => normalizeId(value) === expectedSourceId)
    );
    const assetIsLinked = (asset) => {
      if (!asset || typeof asset !== "object") return false;
      const identityMatches = [asset.assetId, asset.id, asset.postId, asset.mediaPostId]
        .some((value) => {
          const normalized = normalizeId(value);
          return Boolean(normalized) && normalized === expectedFileId;
        })
        || (expectedMediaUrl && canonicalUrl(assetMediaUrl(asset)) === expectedMediaUrl);
      const assetPostId = normalizeId(asset.postId || asset.mediaPostId);
      const linkedSources = relationIds(asset);
      return identityMatches && Boolean(assetPostId) && Array.from(expectedSourceIds).some((value) => linkedSources.has(value));
    };
    const requestJson = async (path, options = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(path, {
          credentials: "include",
          ...options,
          signal: controller.signal,
        });
        const text = await response.text();
        let json = {};
        try {
          json = text.trim() ? JSON.parse(text) : {};
        } catch (_) {}
        if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
        return json;
      } finally {
        clearTimeout(timer);
      }
    };
    let verifiedPost = null;
    let savedAsset = null;
    let lastVerificationError = "";
    const verificationDeadline = Date.now() + 12000;
    while (Date.now() < verificationDeadline && (!verifiedPost || !savedAsset)) {
      const [postAttempt, assetAttempt] = await Promise.all([
        verifiedPost ? Promise.resolve(verifiedPost) : (async () => {
          try {
            const data = await requestJson("/rest/media/post/get", {
              method: "POST",
              headers: { "accept": "application/json, text/plain, */*", "content-type": "application/json" },
              body: JSON.stringify({ id: post.id }),
            });
            const candidate = data?.post && typeof data.post === "object" ? data.post : null;
            if (postIsLinked(candidate)) return candidate;
          } catch (error) {
            lastVerificationError = error?.message || String(error);
          }
          try {
            const data = await requestJson("/rest/media/post/bulk-get", {
              method: "POST",
              headers: { "accept": "application/json, text/plain, */*", "content-type": "application/json" },
              body: JSON.stringify({ ids: [post.id] }),
            });
            return (Array.isArray(data?.posts) ? data.posts : []).find(postIsLinked) || null;
          } catch (error) {
            lastVerificationError = error?.message || String(error);
            return null;
          }
        })(),
        savedAsset ? Promise.resolve(savedAsset) : (async () => {
          try {
            const data = await requestJson(`/rest/assets/${encodeURIComponent(fileId)}`);
            const candidate = data?.asset && typeof data.asset === "object" ? data.asset : data;
            if (assetIsLinked(candidate)) return candidate;
          } catch (error) {
            lastVerificationError = error?.message || String(error);
          }
          try {
            const query = new URLSearchParams({
              pageSize: "40",
              orderBy: "ORDER_BY_CREATE_TIME",
              workspaceKind: "WORKSPACE_KIND_IMAGINE_ALL",
            });
            const data = await requestJson(`/rest/assets?${query}`);
            return (Array.isArray(data?.assets) ? data.assets : []).find(assetIsLinked) || null;
          } catch (error) {
            lastVerificationError = error?.message || String(error);
            return null;
          }
        })(),
      ]);
      if (postAttempt) verifiedPost = postAttempt;
      if (assetAttempt) {
        savedAsset = assetAttempt;
        expectedPostId = normalizeId(savedAsset.postId || savedAsset.mediaPostId);
        post = { id: expectedPostId };
      }
      if (!verifiedPost || !savedAsset) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!verifiedPost || !savedAsset) {
      throw new Error(
        "Grok did not confirm the cropped image in its Saved data."
        + (lastVerificationError ? ` ${lastVerificationError}` : ""),
      );
    }
    return {
      ok: true,
      status: 200,
      upload: uploadJson,
      result: officialResult && typeof officialResult === "object" ? officialResult : { value: officialResult ?? null },
      post: verifiedPost,
      verifiedPost,
      savedAsset,
      savedVerified: true,
      fileId,
      mediaUrl,
      originalPostId: String(originalPostId || ""),
      sourceContainerId: String(sourceContainerId || ""),
      // This renderer is temporary. Do not pretend its in-memory store is persistence;
      // the host accepts this result only after re-reading the post and Saved asset.
      storeUpdate: { updated: false, mode: "remote_verification_required" },
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
    acceptGenerationNetworkResponse,
    async awaitMediaStore(timeoutMs = 0) {
      const ready = await whenMediaStoreReady(timeoutMs);
      return {
        ok: true,
        waited: true,
        hasMediaStore: Boolean(ready && capturedMediaStore),
        status: this.status(),
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
      await waitForMediaStore(12000);
      await waitForStoreAccountReady(null, requestId, "textToImage");
      const socket = await ensureImagineSocket(wsUrl);
      const state = { events: [], signalSeen: false };
      const listener = (raw) => collectEvent(raw, requestId, state);
      const wantedCount = Math.max(1, Number(expectedCount) || 1);
      const receiveLimit = wantedCount + 3;
      let completedGraceStartedAt = 0;
      let lastCompletedCount = 0;
      let lastCandidateCount = 0;
      listeners.add(listener);
      try {
        socket.send(JSON.stringify(resetPayload));
        await new Promise((resolve) => setTimeout(resolve, 250));
        socket.send(JSON.stringify(createPayload));
        await new Promise((resolve) => {
          const done = () => {
            const terminalIds = new Set();
            const candidateIds = new Set();
            const requestTerminal = state.events.some((event) => {
              const text = JSON.stringify(event || {}).toLowerCase();
              const status = String(event?.current_status || event?.status || "").toLowerCase();
              const eventId = String(event?.image_id || event?.job_id || event?.id || "").trim();
              const progress = Number(event?.percentage_complete);
              if (eventId) candidateIds.add(eventId);
              const candidateTerminal = status === "completed"
                || event?.moderated === true
                || (
                  String(event?.type || "").toLowerCase() === "image"
                  && Number.isFinite(progress)
                  && progress >= 100
                  && typeof event?.moderated === "boolean"
                );
              if (eventId && candidateTerminal) terminalIds.add(eventId);
              const failed = status.includes("failed")
                || status.includes("error")
                || text.includes("content_policy_violation")
                || text.includes("content was moderated")
                || text.includes("rejected by content moderation");
              return failed || (!eventId && status.includes("moderated"));
            });
            const terminalCount = terminalIds.size;
            if (requestTerminal) return true;
            if (terminalCount >= receiveLimit) return true;
            if (terminalCount >= wantedCount) {
              if (terminalCount !== lastCompletedCount || candidateIds.size !== lastCandidateCount) {
                lastCompletedCount = terminalCount;
                lastCandidateCount = candidateIds.size;
                completedGraceStartedAt = Date.now();
              }
              return completedGraceStartedAt && Date.now() - completedGraceStartedAt >= 3000;
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
    primeMediaStore,
  };
})();
