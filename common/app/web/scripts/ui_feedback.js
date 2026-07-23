// Toasts, error messages, and clipboard helpers
const ERROR_TOAST_DURATION_MS = 7200;
const SAVED_ERROR_LOGS_KEY = "grok_studio_w_saved_error_logs";

async function copyText(text) {
  const value = String(text || "");
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Use the fallback below for local or non-secure browser contexts.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function saveErrorText(message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    saved_at: new Date().toISOString(),
    message: String(message || "Unknown error"),
  };
  let logs = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_ERROR_LOGS_KEY) || "[]");
    logs = Array.isArray(parsed) ? parsed : [];
  } catch {
    logs = [];
  }
  logs.unshift(entry);
  localStorage.setItem(SAVED_ERROR_LOGS_KEY, JSON.stringify(logs.slice(0, 50)));
}

function isModerationError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("content_policy_violation")
    || text.includes("moderation")
    || text.includes("moderate")
    || text.includes("image_query_rejected")
    || text.includes("image query is not allowed")
    || text.includes("rejection_reason")
    || text.includes("safety")
    || text.includes("검열");
}

function isCreditLimitError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("run out of credits")
    || text.includes("out of credits")
    || text.includes("credit limit")
    || text.includes("spending-limit")
    || text.includes("spending limit")
    || text.includes("need a grok subscription")
    || text.includes("upgrade at")
    || text.includes("credits or need");
}

function isUsageLimitError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("usage limit reached")
    || text.includes("usage_pool_exhausted")
    || text.includes("insufficient balance");
}

function isTimeoutError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("time out")
    || text.includes("timed out")
    || text.includes("timeout");
}

function errorToastMessage(message) {
  const text = String(message || "Unknown error").trim();
  if (isUsageLimitError(text)) return "Usage Limit Reached";
  if (isTimeoutError(text)) return "Time Out";
  if (isModerationError(text)) return "Moderated";
  if (isCreditLimitError(text)) return "Credit Limit";
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const payload = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const payloadError = payload?.error;
      const summary = typeof payloadError === "string"
        ? payloadError
        : payloadError?.message || payload?.message || payload?.detail;
      if (summary) return String(summary).trim().slice(0, 240);
    } catch {
      // Fall back to the first readable line.
    }
  }
  const readable = text
    .replace(/^xAI API error HTTP? \d+:\s*/i, "")
    .replace(/^xAI API error \d+:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && line !== "{" && line !== "}");
  return (readable || "Unknown error").slice(0, 240);
}

function toast(message, kind = "info") {
  if (kind !== "error") return;
  const toastEl = document.getElementById("toast");
  if (!toastEl) return;
  const text = String(message || "");
  const messageEl = document.createElement("span");
  messageEl.className = "toast-message";
  messageEl.textContent = text;
  const copyButton = document.createElement("button");
  copyButton.className = "toast-save-button";
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    clearTimeout(toast.timer);
    let copiedOk = false;
    try {
      const copied = await copyText(library_state.lastErrorText || text);
      if (!copied) throw new Error("Copy failed");
      copiedOk = true;
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        toastEl.hidden = true;
      }, 900);
    } catch {
      saveErrorText(library_state.lastErrorText || text);
      copyButton.textContent = "Failed";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    }
    copyButton.disabled = copiedOk;
  });
  const closeButton = document.createElement("button");
  closeButton.className = "toast-close-button";
  closeButton.type = "button";
  closeButton.textContent = "X";
  closeButton.setAttribute("aria-label", "Close error");
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    clearTimeout(toast.timer);
    toastEl.hidden = true;
  });
  toastEl.replaceChildren(messageEl, copyButton, closeButton);
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, ERROR_TOAST_DURATION_MS);
}

function toastError(message) {
  toast(message, "error");
}

function resultHasLucky(result) {
  if (!result) return false;
  const hasItemLucky = (item) => (typeof mediaItemLucky === "function" ? mediaItemLucky(item) : Boolean(item?.lucky || item?.lucky_recovery));
  if (result.lucky || hasItemLucky(result.item)) return true;
  if (Array.isArray(result.items) && result.items.some(hasItemLucky)) return true;
  if (Array.isArray(result.posts) && result.posts.some((post) => (
    post?.lucky || hasItemLucky(post?.representative_item) || (Array.isArray(post?.items) && post.items.some(hasItemLucky))
  ))) return true;
  return false;
}

function showLuckyNotice() {
  let notice = document.getElementById("luckyNotice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "luckyNotice";
    notice.className = "lucky_notice";
    notice.setAttribute("aria-live", "polite");
    notice.textContent = "Lucky!";
    document.body.append(notice);
  }
  clearTimeout(showLuckyNotice.timer);
  notice.hidden = false;
  requestAnimationFrame(() => {
    const media = document.querySelector(
      ".workspace.i_detail_open .i_detail_media, .workspace.b_detail_open .b_detail_media"
    );
    if (media) {
      media.append(notice);
      notice.classList.add("in_detail_media");
    } else {
      document.body.append(notice);
      notice.classList.remove("in_detail_media");
    }
    notice.classList.add("show");
  });
  showLuckyNotice.timer = window.setTimeout(() => {
    notice.classList.remove("show");
    window.setTimeout(() => {
      notice.hidden = true;
    }, 240);
  }, 5000);
}

function hideErrorPanel() {
  const errorPanel = document.getElementById("errorPanel");
  if (errorPanel) errorPanel.hidden = true;
}

function showErrorPanel(title, message) {
  const text = String(message || "Unknown error");
  library_state.lastErrorText = text;
  hideErrorPanel();
  toastError(errorToastMessage(text));
}
