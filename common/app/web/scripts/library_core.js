// Library/account/file/media helpers
  function openPromptSave(prompt = null) {
    if (!promptSave) return;
    const titleInput = promptSave.querySelector(".prompt_save_title");
    const promptInput = promptSave.querySelector(".prompt_save_original");
    const translationInput = promptSave.querySelector(".prompt_save_translation");
    const currentPrompt = normalizeNfcText(
      prompt ? prompt.text || "" : document.getElementById("composer_input")?.value || "",
    );
    promptSave.dataset.editFileName = prompt?.file_name || "";
    promptSave.dataset.editPromptId = prompt?.id || "";
    promptSave.classList.toggle("editing_prompt", Boolean(prompt));
    promptSave.setAttribute("aria-label", prompt ? "Edit prompt" : "New prompt");
    if (titleInput) titleInput.value = normalizeNfcText(prompt?.title || "");
    if (promptInput) promptInput.value = currentPrompt;
    if (translationInput) translationInput.value = normalizeNfcText(prompt?.translation || "");
    resetPromptTranslationDialog({
      translate: Boolean(currentPrompt) && !prompt?.translation,
      sourceCode: prompt?.source_language_code || "en",
      targetCode: prompt?.target_language_code || "ko",
      automaticPair: !prompt?.translation,
      sourceText: prompt?.translation_source_text || (prompt?.translation ? currentPrompt.trim() : ""),
      translatedAt: prompt?.translated_at || "",
    });
    promptSave.hidden = false;
    requestAnimationFrame(() => {
      for (const input of [promptInput, translationInput]) {
        if (!input) continue;
        input.scrollTop = 0;
        input.scrollLeft = 0;
        if (typeof input.setSelectionRange === "function") input.setSelectionRange(0, 0);
      }
      (prompt ? promptInput : titleInput)?.focus({ preventScroll: true });
    });
  }

  function closePromptSave() {
    if (!promptSave) return;
    cancelPromptTranslationWork();
    closePromptTranslationLanguageMenu();
    promptSave.hidden = true;
    promptSave.dataset.editFileName = "";
    promptSave.dataset.editPromptId = "";
    promptSave.classList.remove("editing_prompt");
  }

  function syncCollectionRows() {
    const firstList = document.querySelector(".collection_1st_card_list");
    if (firstList?.getClientRects().length) {
      const panel = firstList.closest(".collection_1st");
      const heading = panel?.querySelector(".collection_1st_heading");
      if (panel && heading) {
        const panelStyle = getComputedStyle(panel);
        const panelGap = parseFloat(panelStyle.rowGap || panelStyle.gap || "0") || 0;
        const paddingY = (parseFloat(panelStyle.paddingTop) || 0) + (parseFloat(panelStyle.paddingBottom) || 0);
        const listStyle = getComputedStyle(firstList);
        const gap = parseFloat(listStyle.rowGap || listStyle.gap || "0") || 0;
        const availableHeight = panel.clientHeight - paddingY - heading.offsetHeight - panelGap;
        if (availableHeight > 0) {
          const rowHeight = Math.max(50, (availableHeight - (gap * 7)) / 8);
          const listHeight = (rowHeight * 8) + (gap * 7);
          firstList.style.setProperty("--g-1st-row-height", `${rowHeight}px`);
          firstList.style.setProperty("--g-1st-list-height", `${listHeight}px`);
        }
      }
    }

    const secondGrid = document.querySelector(".collection_2nd_card_grid");
    if (secondGrid?.getClientRects().length) {
      const style = getComputedStyle(secondGrid);
      const gap = parseFloat(style.rowGap || style.gap || "0") || 0;
      const availableHeight = secondGrid.clientHeight;
      if (availableHeight > 0) {
        const rowHeight = Math.max(50, (availableHeight - (gap * 7)) / 8);
        secondGrid.style.setProperty("--g-2nd-row-height", `${rowHeight}px`);
      }
    }
  }

  function scheduleCollectionRows() {
    requestAnimationFrame(() => requestAnimationFrame(syncCollectionRows));
  }

  function libraryNow() {
    return new Date().toISOString();
  }

  function defaultLibraryJson() {
    const now = libraryNow();
    return {
      library_version: 1,
      created_at: now,
      updated_at: now,
      folders: {
        created: "created",
        upload: "upload",
        collection: "collection",
        prompt: "prompt",
        account: "account",
      },
      posts: [],
      collections: [],
      prompts: [],
      settings: {
          last_screen: "i_main",
        sort: "created_desc",
      },
    };
  }

  function mergeLibraryJson(data) {
    const base = defaultLibraryJson();
    return {
      ...base,
      ...(data && typeof data === "object" ? data : {}),
      folders: {
        ...base.folders,
        ...(data?.folders || {}),
      },
      settings: {
        ...base.settings,
        ...(data?.settings || {}),
      },
      posts: Array.isArray(data?.posts) ? data.posts : [],
      collections: Array.isArray(data?.collections) ? data.collections : [],
      prompts: Array.isArray(data?.prompts) ? data.prompts : [],
    };
  }

  function setLibraryMessage(message) {
    const firstList = document.querySelector(".collection_1st_card_list");
    const secondGrid = document.querySelector(".collection_2nd_card_grid");
    if (firstList && !library_state.collections.length) {
      firstList.replaceChildren(emptyLibraryNode(message || "No category yet."));
      return;
    }
    if (secondGrid && !library_state.selectedCollectionPath) {
      secondGrid.replaceChildren(emptyLibraryNode(message || ""));
    }
  }

  function emptyLibraryNode(message) {
    const empty = document.createElement("div");
    empty.className = "collection_empty";
    empty.textContent = message;
    return empty;
  }

  async function sortedDirectoryEntries(dirHandle) {
    const entries = [];
    for await (const entry of dirHandle.values()) {
      entries.push(entry);
    }
    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  async function getOptionalDirectory(parentHandle, name) {
    try {
      return await parentHandle.getDirectoryHandle(name);
    } catch {
      return null;
    }
  }

  async function getOptionalFile(parentHandle, name) {
    try {
      return await parentHandle.getFileHandle(name);
    } catch {
      return null;
    }
  }

  async function readJsonFile(parentHandle, name) {
    const fileHandle = await getOptionalFile(parentHandle, name);
    if (!fileHandle) return null;
    try {
      const text = await (await fileHandle.getFile()).text();
      return text.trim() ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  async function writeJsonFile(parentHandle, name, data) {
    const fileHandle = await parentHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(`${JSON.stringify(data, null, 2)}\n`);
    await writable.close();
  }

  async function writeTextFile(parentHandle, name, text) {
    const fileHandle = await parentHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function openLibraryDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("grok_studio_lab_q", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("handles");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveLibraryHandle(handle) {
    const db = await openLibraryDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, "root");
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  }

  async function loadLibraryHandle() {
    const db = await openLibraryDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", "readonly");
      const request = transaction.objectStore("handles").get("root");
      request.onsuccess = () => resolve(request.result || null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  }

  async function hasLibraryPermission(handle, mode = "readwrite") {
    if (!handle?.queryPermission || !handle?.requestPermission) return true;
    const options = { mode };
    if (await handle.queryPermission(options) === "granted") return true;
    return await handle.requestPermission(options) === "granted";
  }

  async function ensureLibraryRoot(rootHandle) {
    for (const folder of libraryFolders) {
      await rootHandle.getDirectoryHandle(folder, { create: true });
    }
    const existing = await readJsonFile(rootHandle, "library.json");
    const library = mergeLibraryJson(existing);
    if (!existing) await writeJsonFile(rootHandle, "library.json", library);
    return library;
  }

  function revokeLibraryObjectUrls() {
    for (const url of library_state.objectUrls) URL.revokeObjectURL(url);
    library_state.objectUrls = [];
  }

  function addLibraryObjectUrl(file) {
    const url = URL.createObjectURL(file);
    library_state.objectUrls.push(url);
    return url;
  }

  function claimUniqueMediaItemId(preferred, usedIds) {
    const base = String(preferred || "item").trim() || "item";
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate.toLocaleLowerCase())) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  async function mediaItemsInFolder(dirHandle) {
    const items = [];
    const usedItemIds = new Set();
    for (const entry of await sortedDirectoryEntries(dirHandle)) {
      if (entry.kind !== "file") continue;
      const type = mediaTypeForName(entry.name);
      if (!type) continue;
      const file = await entry.getFile();
      items.push({
        item_id: claimUniqueMediaItemId(fileBaseName(entry.name), usedItemIds),
        type,
        file: entry.name,
        mime_type: file.type || `${type}/${extensionFor(entry.name)}`,
        size: file.size,
        last_modified: file.lastModified,
        object_url: addLibraryObjectUrl(file),
        role: "result",
      });
    }
    return items.sort((a, b) => b.last_modified - a.last_modified || a.file.localeCompare(b.file));
  }

  function postField(meta, key) {
    if (!meta || typeof meta !== "object") return "";
    return meta[key]
      || meta.imagine_media_post?.[key]
      || meta.data?.[0]?.[key]
      || meta.data?.[0]?.imagine_media_post?.[key]
      || meta.raw_events?.[0]?.[key]
      || "";
  }

  function remoteItemFromMeta(meta) {
    const url = postField(meta, "media_url")
      || postField(meta, "mediaUrl")
      || postField(meta, "url");
    if (!url) return null;
    const mimeType = postField(meta, "mime_type") || postField(meta, "mimeType") || "";
    const type = mimeType.startsWith("video/") || /\.(mov|mp4|webm|m4v)(\?|$)/i.test(url) ? "video" : "image";
    return {
      item_id: postField(meta, "imagine_image_id") || postField(meta, "id") || fileBaseName(url.split("/").pop() || "remote"),
      type,
      file: "",
      url,
      object_url: url,
      mime_type: mimeType,
      role: "remote",
    };
  }

  function mediaItemsFromMeta(meta) {
    if (!Array.isArray(meta?.items)) return [];
    const usedItemIds = new Set();
    return meta.items.map((item, index) => {
      const url = item.url || item.media_url || item.mediaUrl || "";
      const file = item.file || "";
      const type = item.type || mediaTypeForName(file || url) || (String(item.mime_type || item.mimeType || "").startsWith("video/") ? "video" : "image");
      return {
        ...item,
        item_id: claimUniqueMediaItemId(
          item.item_id || item.id || fileBaseName(file || url.split("/").pop() || `item-${index + 1}`),
          usedItemIds,
        ),
        type,
        file,
        url,
        object_url: item.object_url || url,
        mime_type: item.mime_type || item.mimeType || "",
        role: item.role || "result",
        relation: item.relation || "",
        prompt: item.prompt || "",
        title: item.title || "",
      };
    }).filter((item) => item.file || item.url);
  }

  function mediaItemKey(item) {
    return String(item?.item_id || item?.file || item?.url || "");
  }

  function mediaPreviewUrl(item) {
    const type = String(item?.type || item?.mime_type || item?.mime || "").toLowerCase();
    if (type === "image" || type.startsWith("image/")) {
      return item?.object_url
        || item?.url
        || item?.media_url
        || item?.mediaUrl
        || item?.remote_url
        || item?.thumbnail_url
        || item?.poster_url
        || "";
    }
    return item?.thumbnail_url
      || item?.poster_url
      || "";
  }

  function videoPreviewUrl(item) {
    return item?.type === "video" ? (item.object_url || item.url || "") : "";
  }
