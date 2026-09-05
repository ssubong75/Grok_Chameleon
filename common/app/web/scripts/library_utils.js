// Common text, file, and media helpers
function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extensionFor(name = "") {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function mediaTypeForName(name = "") {
  const ext = extensionFor(name);
  if (imageExtensions.has(ext)) return "image";
  if (videoExtensions.has(ext)) return "video";
  return "";
}

function fileBaseName(name = "") {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(0, dot) : name;
}

function readableName(name = "") {
  return decodeURIComponent(name)
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || name;
}

function safeFileStem(name = "") {
  const stem = name
    .normalize("NFKC")
    .replace(/[/:\\]/g, "-")
    .replace(/[^\p{L}\p{N} ._-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return stem || "prompt";
}

function promptTitleFromText(text = "") {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 48) || "Prompt";
}
