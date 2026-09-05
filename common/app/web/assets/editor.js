const params = new URLSearchParams(window.location.search);
const itemId = params.get("item_id") || "";
const sourceUrl = params.get("source") || "";
const imageName = params.get("name") || "Image";
const returnPath = safeReturnPath(params.get("return") || "");
const editorProvider = params.get("provider") || "";
const editorSaveTarget = params.get("save_target") || "";

const image = document.querySelector("#editorImage");
const imageCanvas = document.querySelector("#imageCanvas");
const paintCanvas = document.querySelector("#paintCanvas");
const objectLayer = document.querySelector("#objectLayer");
const selectionOverlay = document.querySelector("#selectionOverlay");
const cropOverlay = document.querySelector("#cropOverlay");
const floatingToolbarLayer = document.querySelector("#floatingToolbarLayer");
const status = document.querySelector("#editorStatus");
const closeButton = document.querySelector("#closeEditorBtn");
const saveButton = document.querySelector("#saveEditorBtn");
const workspace = document.querySelector(".image-workspace");
const stage = document.querySelector(".image-stage");
const board = document.querySelector(".canvas-board");
const toolRail = document.querySelector(".tool-rail");
const optionPanel = document.querySelector(".option-panel");
const rightTools = document.querySelector(".right-tools");
const handButton = document.querySelector('[data-action="hand"]');
const fontToggle = document.querySelector("[data-font-toggle]");
const fontLabel = document.querySelector("[data-font-label]");
const fontMenu = document.querySelector("[data-font-menu]");
const fontPicker = document.querySelector(".font-picker");
const imagePaint = imageCanvas?.getContext("2d");
const paint = paintCanvas?.getContext("2d");
const baseCanvas = document.createElement("canvas");
const basePaint = baseCanvas.getContext("2d");

let currentTool = "";
let viewState = { zoom: 1, panX: 0, panY: 0, rotate: 0, flipX: 1, flipY: 1 };
let undoStack = [];
let redoStack = [];
let handMode = false;
let isDragging = false;
let dragStart = null;
let gesture = null;
let selectedObjectId = "";
let clipboardObject = null;
let pixelClipboard = null;
let objectCounter = 0;
let objectDrag = null;
let filterBaselineCanvas = null;
let isRestoringHistory = false;
let initialHistoryState = null;
let activeColorTarget = "";
let selectionMiniToolbar = null;
let colorPopup = null;
let colorPopupTarget = "";
let colorPopupHue = 0;
let systemFonts = [];
let fontsLoaded = false;
let fontsLoading = false;
let spacePanMode = false;
let selectionHandles = null;
let selectionFrame = null;
let eyedropperMode = false;
let eyedropperPreview = null;
let activeColorPopupTool = "";

const objects = [];
const HISTORY_LIMIT = 50;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 20;
const DEFAULT_ACCENT = "#fbad2e";
const DEFAULT_FONT_STACK = 'Arial, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const SELECTION_SAFE_MARGIN = 36;
const DEFAULT_OPACITY_VALUE = 0;
const OBJECT_CREATE_MIN_SIZE = 10;
const TEXT_PREVIEW_WIDTH_FACTOR = 0.54;
const TEXT_CARET_SEED = "\u200B";
const TRANSPARENT_PIXEL_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const TRANSPARENT_FILL_TARGETS = new Set([
  "shapeFill",
  "shapeStrokeColor",
  "iconFill",
  "iconStrokeColor",
  "textFill",
  "textStrokeColor",
]);
const IMAGE_EDITOR_SAVED_KEY = "grokStudioImageEditorSavedItemId";
const IMAGE_EDITOR_SAVE_TARGET_KEY = "grokStudioImageEditorSaveTarget";

function safeReturnPath(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname.endsWith("/editor.html")) return "";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "";
  }
}

function editorImageLoadUrl(value) {
  const text = String(value || "").trim();
  if (!text || /^(?:data|blob):/i.test(text)) return text;
  try {
    const url = new URL(text, window.location.origin);
    if (url.origin === window.location.origin) return text;
    if (!/^https?:$/i.test(url.protocol)) return text;
    const params = new URLSearchParams({ kind: "image", url: url.toString() });
    return `/api/imagine/remote/media?${params.toString()}`;
  } catch {
    return text;
  }
}

const editor = {
  selectionShape: "rect",
  selectionRect: null,
  selectionInverted: false,
  selectionFeather: 0,
  cropRatio: "",
  drawMode: "free",
  drawColor: "#15aee8",
  drawSize: 12,
  drawOpacity: DEFAULT_OPACITY_VALUE,
  eraserSoft: false,
  eraserSize: 32,
  eraserOpacity: DEFAULT_OPACITY_VALUE,
  shapeType: "rect",
  shapeFill: "transparent",
  shapeStrokeColor: DEFAULT_ACCENT,
  shapeStroke: 2,
  shapeFeather: 0,
  shapeOpacity: DEFAULT_OPACITY_VALUE,
  shapeFillOpacity: DEFAULT_OPACITY_VALUE,
  shapeStrokeOpacity: DEFAULT_OPACITY_VALUE,
  iconName: "arrow",
  iconFill: DEFAULT_ACCENT,
  iconStrokeColor: "#ffffff",
  iconOpacity: DEFAULT_OPACITY_VALUE,
  iconFillOpacity: DEFAULT_OPACITY_VALUE,
  iconStrokeOpacity: DEFAULT_OPACITY_VALUE,
  textSize: 50,
  textFont: "Arial",
  textFill: DEFAULT_ACCENT,
  textStrokeColor: "#ffffff",
  textOpacity: DEFAULT_OPACITY_VALUE,
  textFillOpacity: DEFAULT_OPACITY_VALUE,
  textStrokeOpacity: DEFAULT_OPACITY_VALUE,
  textBold: false,
  textItalic: false,
  textUnderline: false,
  textAlign: "center",
};

const filters = {
  grayscale: false,
  invert: false,
  sepia: false,
  sepia2: false,
  blur: false,
  sharpen: false,
  emboss: false,
  noiseEnabled: false,
  pixelate: false,
  "color-filter": false,
  distance: 0,
  brightness: 50,
  noise: 20,
  pixelateValue: 0,
  threshold: 45,
  tintOpacity: 100,
  blend: "",
  tintColor: "#18c4b0",
  multiplyColor: "#565de6",
  blendColor: DEFAULT_ACCENT,
};

const iconPaths = {
  bubble1: "M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z",
  bubble2: "M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z",
  bubble3: "M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z",
};

const fillableIconPaths = {
  bubble: { viewBox: "0 0 100 100", path: "M16 24 h68 v42 h-38 l-17 17 v-17 h-13 z" },
  heart: { viewBox: "0 0 100 100", path: "M50 86 C20 60 8 46 15 28 C21 12 42 14 50 31 C58 14 79 12 85 28 C92 46 80 60 50 86Z" },
  polygon: { viewBox: "0 0 100 100", path: "M25 12 H75 L98 50 L75 88 H25 L2 50 Z" },
  custom: { viewBox: "0 0 100 100", path: "M14 18 H72 V32 H28 V76 H82 V44 H96 V90 H14 Z M70 10 H96 V36 H84 V30 L58 56 L50 48 L76 22 H70 Z" },
};

const fillableIconNames = new Set([...Object.keys(fillableIconPaths), ...Object.keys(iconPaths)]);
const spriteOnlyIconNames = new Set(["star", "star2", "location"]);

const iconSpriteIds = {
  arrow: "ic-icon-arrow",
  arrow2: "ic-icon-arrow-2",
  arrow3: "ic-icon-arrow-3",
  star: "ic-icon-star",
  star2: "ic-icon-star-2",
  polygon: "ic-icon-polygon",
  location: "ic-icon-location",
  heart: "ic-icon-heart",
  bubble: "ic-icon-bubble",
  custom: "ic-icon-load",
};

const spriteIconCanvasPaths = {
  arrow: {
    viewBox: "0 0 32 32",
    paths: [{ d: "M2.5 11.5v9h18v5.293L30.293 16 20.5 6.207V11.5h-18z", fill: false, stroke: true }],
  },
  arrow2: {
    viewBox: "0 0 32 32",
    paths: [{ d: "M21.793 18.5H2.5v-5h18.935l-7.6-8h5.872l10.5 10.5-10.5 10.5h-5.914l8-8z", fill: false, stroke: true, lineCap: "round", lineJoin: "round" }],
  },
  arrow3: {
    viewBox: "0 0 32 32",
    paths: [{ d: "M25.288 16.42L14.208 27.5H6.792l11.291-11.291L6.826 4.5h7.381l11.661 11.661-.58.258z", fill: false, stroke: true, lineCap: "round", lineJoin: "round" }],
  },
  star: {
    viewBox: "0 0 32 32",
    paths: [{ d: "M25.292 29.878l-1.775-10.346 7.517-7.327-10.388-1.51L16 1.282l-4.646 9.413-10.388 1.51 7.517 7.327-1.775 10.346L16 24.993l9.292 4.885z", fill: false, stroke: true }],
  },
  star2: {
    viewBox: "0 0 32 32",
    paths: [{ d: "M19.446 31.592l2.265-3.272 3.946.25.636-3.94 3.665-1.505-1.12-3.832 2.655-2.962-2.656-2.962 1.12-3.832-3.664-1.505-.636-3.941-3.946.25-2.265-3.271L16 3.024 12.554 1.07 10.289 4.34l-3.946-.25-.636 3.941-3.665 1.505 1.12 3.832L.508 16.33l2.656 2.962-1.12 3.832 3.664 1.504.636 3.942 3.946-.25 2.265 3.27L16 29.638l3.446 1.955z", fill: false, stroke: true }],
  },
  location: {
    viewBox: "0 0 32 32",
    paths: [{ d: "M16 31.28C23.675 23.302 27.5 17.181 27.5 13c0-6.351-5.149-11.5-11.5-11.5S4.5 6.649 4.5 13c0 4.181 3.825 10.302 11.5 18.28z", fill: false, stroke: true }],
    circles: [{ cx: 16, cy: 13, r: 4.5, fill: false, stroke: true }],
  },
};

document.title = "Grok Studio Image Editor";

fetch("/assets/tui-icons.svg")
  .then((response) => (response.ok ? response.text() : ""))
  .then((svg) => {
    if (!svg) return;
    const holder = document.createElement("div");
    holder.className = "toast-icon-sprite";
    holder.innerHTML = svg;
    document.body.prepend(holder);
  })
  .catch(() => {});

if (image) {
  image.alt = imageName;
  image.draggable = false;
  image.addEventListener("load", () => {
    baseCanvas.width = image.naturalWidth;
    baseCanvas.height = image.naturalHeight;
    basePaint?.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    basePaint?.drawImage(image, 0, 0);
    layoutCanvasBoard();
    resetView({ record: false });
    initializeEditorTool();
    initialHistoryState = captureHistoryState();
    window.requestAnimationFrame(() => resetHistory());
  });
  if (sourceUrl) image.src = editorImageLoadUrl(sourceUrl);
  else setStatus("No image source.");
}

closeButton?.addEventListener("click", () => returnToMainApp());
saveButton?.addEventListener("click", saveEdit);

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (error) {
    throw new Error(`Connection failed: ${error?.message || "Could not reach the app server."}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function setStatus(message) {
  if (status) status.textContent = message || "";
}

function normalizeHexColor(value, fallback = DEFAULT_ACCENT) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
  }
  return fallback;
}

function hexToRgb(value, fallback = DEFAULT_ACCENT) {
  const color = normalizeHexColor(value, fallback).slice(1);
  return {
    r: parseInt(color.slice(0, 2), 16),
    g: parseInt(color.slice(2, 4), 16),
    b: parseInt(color.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  return { h, s: max ? delta / max : 0, v: max };
}

function hsvToRgb(h, s, v) {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

function colorForTarget(target) {
  const values = {
    drawColor: editor.drawColor,
    shapeFill: editor.shapeFill === "transparent" ? "#ffffff" : editor.shapeFill,
    shapeStrokeColor: editor.shapeStrokeColor === "transparent" ? "#ffffff" : editor.shapeStrokeColor,
    iconFill: editor.iconFill === "transparent" ? "#ffffff" : editor.iconFill,
    iconStrokeColor: editor.iconStrokeColor === "transparent" ? "#ffffff" : editor.iconStrokeColor,
    textFill: editor.textFill === "transparent" ? "#ffffff" : editor.textFill,
    textStrokeColor: editor.textStrokeColor === "transparent" ? "#ffffff" : editor.textStrokeColor,
    filterTint: filters.tintColor,
    filterMultiply: filters.multiplyColor,
    filterBlend: filters.blendColor,
  };
  return normalizeHexColor(values[target] || DEFAULT_ACCENT);
}

function isTransparentFillTarget(target) {
  return TRANSPARENT_FILL_TARGETS.has(target);
}

function targetUsesTransparentFill(target) {
  if (target === "shapeFill") return editor.shapeFill === "transparent";
  if (target === "shapeStrokeColor") return editor.shapeStrokeColor === "transparent";
  if (target === "iconFill") return editor.iconFill === "transparent";
  if (target === "iconStrokeColor") return editor.iconStrokeColor === "transparent";
  if (target === "textFill") return editor.textFill === "transparent";
  if (target === "textStrokeColor") return editor.textStrokeColor === "transparent";
  return false;
}

function colorTargetOpacityInfo(target) {
  const info = {
    shapeFill: { control: "shapeOpacity", key: "shapeFillOpacity", type: "shape" },
    shapeStrokeColor: { control: "shapeOpacity", key: "shapeStrokeOpacity", type: "shape" },
    iconFill: { control: "iconOpacity", key: "iconFillOpacity", type: "icon" },
    iconStrokeColor: { control: "iconOpacity", key: "iconStrokeOpacity", type: "icon" },
    textFill: { control: "textOpacity", key: "textFillOpacity", type: "text" },
    textStrokeColor: { control: "textOpacity", key: "textStrokeOpacity", type: "text" },
  };
  return info[target] || null;
}

function opacityControlToAlpha(value = DEFAULT_OPACITY_VALUE) {
  const normalized = Math.min(100, Math.max(0, Number(value) || 0));
  return 1 - normalized / 100;
}

function colorWithOpacity(color, opacity = DEFAULT_OPACITY_VALUE) {
  if (color === "transparent") return "transparent";
  const rgb = hexToRgb(normalizeHexColor(color || DEFAULT_ACCENT));
  const alpha = opacityControlToAlpha(opacity);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function transparentFillBackground() {
  return "linear-gradient(135deg, transparent 44%, #ff5d5d 46%, #ff5d5d 54%, transparent 56%), #ffffff";
}

function iconSupportsFill(name = editor.iconName) {
  return fillableIconNames.has(name) && !spriteOnlyIconNames.has(name);
}

function setActiveColorDot(target = "") {
  activeColorTarget = target;
  optionPanel?.querySelectorAll(".color-dot[data-color-target]").forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.colorTarget === activeColorTarget);
  });
  const info = colorTargetOpacityInfo(activeColorTarget);
  if (info) setRangeValue(info.control, editor[info.key] ?? DEFAULT_OPACITY_VALUE);
  else syncWholeOpacityControl();
}

function syncWholeOpacityControl() {
  const controlByTool = {
    shape: { control: "shapeOpacity", key: "shapeOpacity" },
    icon: { control: "iconOpacity", key: "iconOpacity" },
    text: { control: "textOpacity", key: "textOpacity" },
  };
  const info = controlByTool[currentTool];
  if (info) setRangeValue(info.control, editor[info.key] ?? DEFAULT_OPACITY_VALUE);
}

function setColorForTarget(target, color) {
  if (target === "iconFill" && !iconSupportsFill()) return;
  setActiveColorDot(target);
  const next = normalizeHexColor(color);
  if (target === "drawColor") editor.drawColor = next;
  if (target === "shapeFill") editor.shapeFill = next;
  if (target === "shapeStrokeColor") editor.shapeStrokeColor = next;
  if (target === "iconFill") editor.iconFill = next;
  if (target === "iconStrokeColor") editor.iconStrokeColor = next;
  if (target === "textFill") editor.textFill = next;
  if (target === "textStrokeColor") editor.textStrokeColor = next;
  if (target === "filterTint") filters.tintColor = next;
  if (target === "filterMultiply") filters.multiplyColor = next;
  if (target === "filterBlend") filters.blendColor = next;
  updateColorDots();
  if (target.startsWith("filter")) {
    const blendByTarget = {
      filterTint: "tint",
      filterMultiply: "multiply",
      filterBlend: "blend",
    };
    filters.blend = blendByTarget[target] || filters.blend;
    filters["color-filter"] = true;
    setFilterCheckbox("color-filter", true);
    syncFilterOptionState();
    applyFilterPreview();
    pushHistory({ force: true });
  } else {
    updateActiveObjectStyle();
  }
}

function setTransparentFillForTarget(target) {
  if (!isTransparentFillTarget(target)) return;
  if (target === "iconFill" && !iconSupportsFill()) return;
  setActiveColorDot(target);
  if (target === "shapeFill") editor.shapeFill = "transparent";
  if (target === "shapeStrokeColor") editor.shapeStrokeColor = "transparent";
  if (target === "iconFill") editor.iconFill = "transparent";
  if (target === "iconStrokeColor") editor.iconStrokeColor = "transparent";
  if (target === "textFill") editor.textFill = "transparent";
  if (target === "textStrokeColor") editor.textStrokeColor = "transparent";
  updateColorDots();
  updateActiveObjectStyle();
}

function updateIconFillAvailability() {
  const enabled = iconSupportsFill();
  optionPanel?.querySelectorAll("[data-icon-fill-choice]").forEach((choice) => {
    choice.classList.toggle("disabled", !enabled);
    choice.setAttribute("aria-disabled", String(!enabled));
  });
  if (!enabled && activeColorTarget === "iconFill") setActiveColorDot("");
}

function ensureColorDotPickers() {
  document.querySelectorAll(".color-dot[data-color-target]").forEach((dot) => {
    if (!(dot instanceof HTMLElement)) return;
    const target = dot.dataset.colorTarget;
    if (!target) return;
    dot.classList.toggle("fill-target", isTransparentFillTarget(target));
  });
}

function ensureColorPopup() {
  if (colorPopup) return colorPopup;
  const popup = document.createElement("div");
  popup.className = "color-popup";
  popup.innerHTML = `
    <div class="color-popup-core">
      <div class="color-popup-field" data-color-field></div>
      <div class="color-hue-strip" data-color-hue></div>
    </div>
    <div class="color-popup-tools">
      <button type="button" class="color-eyedropper" data-color-tool="eyedropper" aria-label="Eyedropper">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.9 3.6 20.4 9l-2.1 2.1-1.3-1.3-7.6 7.6H5.9l-.9 1.9-1.3-1.3 1.9-.9v-3.5l7.6-7.6-1.3-1.3 3-2.1Z"/>
          <path d="m6 15.2 2.8 2.8"/>
        </svg>
      </button>
      <button type="button" class="color-transparent-choice" data-transparent-choice data-color-tool="transparent" aria-label="Transparent color"></button>
      <button type="button" class="color-current-choice" data-color-current data-color-tool="current" aria-label="Current color"></button>
      <label class="color-hex-field"><span>#</span><input type="text" maxlength="6" data-hex aria-label="Hex color" /></label>
    </div>
    <div class="color-rgb-row">
      <label><input type="text" inputmode="numeric" data-rgb="r" /><span>R</span></label>
      <label><input type="text" inputmode="numeric" data-rgb="g" /><span>G</span></label>
      <label><input type="text" inputmode="numeric" data-rgb="b" /><span>B</span></label>
    </div>
  `;
  popup.addEventListener("pointerdown", (event) => event.stopPropagation());
  popup.querySelector("[data-transparent-choice]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activeColorPopupTool = "transparent";
    syncColorPopupToolState();
    if (colorPopupTarget) {
      setTransparentFillForTarget(colorPopupTarget);
      closeColorPopup();
    }
  });
  popup.querySelector(".color-eyedropper")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!colorPopupTarget) {
      setStatus("Select a color target first.");
      return;
    }
    activeColorPopupTool = "eyedropper";
    syncColorPopupToolState();
    setEyedropperMode(true);
  });
  popup.querySelector("[data-color-current]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activeColorPopupTool = "current";
    syncColorPopupToolState();
    setEyedropperMode(false);
  });
  popup.querySelector("[data-color-field]")?.addEventListener("pointerdown", (event) => {
    activeColorPopupTool = "current";
    syncColorPopupToolState();
    setEyedropperMode(false);
    pickColorFromField(event);
  });
  popup.querySelector("[data-color-hue]")?.addEventListener("pointerdown", (event) => {
    activeColorPopupTool = "current";
    syncColorPopupToolState();
    setEyedropperMode(false);
    const rect = event.currentTarget.getBoundingClientRect();
    colorPopupHue = Math.min(359, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height) * 360));
    const rgb = hsvToRgb(colorPopupHue, 1, 1);
    applyPopupColor(rgbToHex(rgb.r, rgb.g, rgb.b));
  });
  popup.addEventListener("change", handlePopupRgbInput);
  popup.addEventListener("input", handlePopupRgbInput);
  document.body.appendChild(popup);
  colorPopup = popup;
  return popup;
}

function syncColorPopupToolState() {
  colorPopup?.querySelectorAll("[data-color-tool]").forEach((item) => {
    item.classList.toggle("active", item.dataset.colorTool === activeColorPopupTool);
  });
}

function closeColorPopup() {
  setEyedropperMode(false);
  colorPopup?.classList.remove("open");
  colorPopupTarget = "";
  activeColorPopupTool = "";
  syncColorPopupToolState();
}

function syncColorPopup(target = colorPopupTarget) {
  const popup = ensureColorPopup();
  const color = colorForTarget(target);
  const rgb = hexToRgb(color);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  colorPopupHue = hsv.h;
  popup.querySelector("[data-color-current]")?.style.setProperty("--current-color", color);
  const hexInput = popup.querySelector("[data-hex]");
  if (hexInput instanceof HTMLInputElement) hexInput.value = color.slice(1).toUpperCase();
  popup.querySelector("[data-color-field]")?.style.setProperty("--field-hue", `hsl(${colorPopupHue} 100% 50%)`);
  const hasTransparent = isTransparentFillTarget(target);
  popup.classList.toggle("has-transparent", hasTransparent);
  popup.querySelector("[data-transparent-choice]")?.classList.toggle("visible", hasTransparent);
  syncColorPopupToolState();
  popup.querySelectorAll("[data-rgb]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const channel = input.dataset.rgb;
    input.value = String(rgb[channel] ?? 0);
  });
}

function openColorPopup(dot, target) {
  if (!target || (target === "iconFill" && !iconSupportsFill())) return;
  const popup = ensureColorPopup();
  colorPopupTarget = target;
  setActiveColorDot(target);
  syncColorPopup(target);
  const rect = dot.getBoundingClientRect();
  popup.classList.add("open");
  const popupRect = popup.getBoundingClientRect();
  const panelRect = optionPanel?.getBoundingClientRect();
  const centerX = panelRect ? panelRect.left + panelRect.width / 2 : rect.left + rect.width / 2;
  const left = Math.min(window.innerWidth - popupRect.width - 10, Math.max(10, centerX - popupRect.width / 2));
  const preferredTop = rect.top - popupRect.height - 8;
  const top = preferredTop > 8 ? preferredTop : rect.bottom + 8;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  activeColorPopupTool = "eyedropper";
  syncColorPopupToolState();
  setEyedropperMode(true);
}

function applyPopupColor(color) {
  if (!colorPopupTarget) return;
  setColorForTarget(colorPopupTarget, color);
  syncColorPopup(colorPopupTarget);
}

function setPopupColorPreview(color) {
  const popup = ensureColorPopup();
  const hex = normalizeHexColor(color);
  const rgb = hexToRgb(hex);
  popup.querySelector("[data-color-current]")?.style.setProperty("--current-color", hex);
  const hexInput = popup.querySelector("[data-hex]");
  if (hexInput instanceof HTMLInputElement) hexInput.value = hex.slice(1).toUpperCase();
  popup.querySelectorAll("[data-rgb]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const channel = input.dataset.rgb;
    input.value = String(rgb[channel] ?? 0);
  });
}

function pickColorFromField(event) {
  if (!colorPopupTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
  const rgb = hsvToRgb(colorPopupHue, x, 1 - y);
  applyPopupColor(rgbToHex(rgb.r, rgb.g, rgb.b));
}

function handlePopupRgbInput(event) {
  const input = event.target;
  activeColorPopupTool = "current";
  syncColorPopupToolState();
  setEyedropperMode(false);
  if (input instanceof HTMLInputElement && input.dataset.hex !== undefined && colorPopupTarget) {
    const clean = input.value.replace(/[^0-9a-f]/gi, "").slice(0, 6);
    input.value = clean.toUpperCase();
    if (clean.length === 6) applyPopupColor(`#${clean}`);
    return;
  }
  if (!(input instanceof HTMLInputElement) || !input.dataset.rgb || !colorPopupTarget) return;
  const values = { ...hexToRgb(colorForTarget(colorPopupTarget)) };
  values[input.dataset.rgb] = Math.min(255, Math.max(0, Math.round(Number(input.value) || 0)));
  applyPopupColor(rgbToHex(values.r, values.g, values.b));
}

function ensureEyedropperPreview() {
  if (eyedropperPreview) return eyedropperPreview;
  const preview = document.createElement("div");
  preview.className = "eyedropper-preview";
  preview.innerHTML = '<span data-eyedropper-color></span><strong data-eyedropper-hex>#000000</strong>';
  document.body.appendChild(preview);
  eyedropperPreview = preview;
  return preview;
}

function setEyedropperMode(enabled) {
  eyedropperMode = Boolean(enabled && colorPopupTarget);
  document.body.classList.toggle("eyedropper-active", eyedropperMode);
  if (!eyedropperMode) eyedropperPreview?.classList.remove("open");
  if (eyedropperMode) setStatus("Move over the image and click a color.");
}

function sampleCanvasColor(event) {
  if (!board || !basePaint || !baseCanvas.width || !baseCanvas.height) return "";
  const rect = board.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return "";
  const point = boardPoint(event);
  const base = boardToBase(point);
  const x = Math.min(baseCanvas.width - 1, Math.max(0, Math.round(base.x)));
  const y = Math.min(baseCanvas.height - 1, Math.max(0, Math.round(base.y)));
  const pixel = basePaint.getImageData(x, y, 1, 1).data;
  return rgbToHex(pixel[0], pixel[1], pixel[2]);
}

function updateEyedropperPreview(event, color) {
  const preview = ensureEyedropperPreview();
  preview.classList.toggle("open", Boolean(color));
  if (!color) return;
  preview.style.left = `${event.clientX}px`;
  preview.style.top = `${event.clientY + 18}px`;
  preview.querySelector("[data-eyedropper-color]")?.style.setProperty("--sample-color", color);
  const label = preview.querySelector("[data-eyedropper-hex]");
  if (label) label.textContent = color.toUpperCase();
}

function updateColorDots() {
  document.querySelectorAll(".color-dot[data-color-target]").forEach((dot) => {
    const target = dot.dataset.colorTarget;
    if (!target) return;
    if (targetUsesTransparentFill(target)) {
      dot.style.background = transparentFillBackground();
    } else {
      dot.style.background = colorForTarget(target);
    }
  });
  updateIconFillAvailability();
  setActiveColorDot(activeColorTarget);
  if (colorPopup?.classList.contains("open") && colorPopupTarget) syncColorPopup(colorPopupTarget);
}

function layoutCanvasBoard() {
  const sourceWidth = baseCanvas.width || image?.naturalWidth || 0;
  const sourceHeight = baseCanvas.height || image?.naturalHeight || 0;
  if (!stage || !board || !sourceWidth || !sourceHeight) return;
  const rect = stage.getBoundingClientRect();
  const aspect = sourceWidth / sourceHeight;
  let width = rect.width;
  let height = width / aspect;
  if (height > rect.height) {
    height = rect.height;
    width = height * aspect;
  }
  if (height > SELECTION_SAFE_MARGIN * 2) {
    const reservedScale = Math.max(0.1, (height - SELECTION_SAFE_MARGIN * 2) / height);
    width *= reservedScale;
    height *= reservedScale;
  }
  board.style.setProperty("--board-width", `${Math.max(1, Math.floor(width))}px`);
  board.style.setProperty("--board-height", `${Math.max(1, Math.floor(height))}px`);
  window.requestAnimationFrame(syncCanvasSize);
}

function syncCanvasSize() {
  if (!paintCanvas || !paint || !imageCanvas || !imagePaint || !board) return;
  const rect = board.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(rect.width));
  const nextHeight = Math.max(1, Math.round(rect.height));
  if (paintCanvas.width === nextWidth && paintCanvas.height === nextHeight && imageCanvas.width === nextWidth && imageCanvas.height === nextHeight) {
    drawVisibleImage();
    return;
  }
  const old = document.createElement("canvas");
  old.width = paintCanvas.width || nextWidth;
  old.height = paintCanvas.height || nextHeight;
  old.getContext("2d")?.drawImage(paintCanvas, 0, 0);
  imageCanvas.width = nextWidth;
  imageCanvas.height = nextHeight;
  paintCanvas.width = nextWidth;
  paintCanvas.height = nextHeight;
  paint.clearRect(0, 0, nextWidth, nextHeight);
  if (old.width && old.height) paint.drawImage(old, 0, 0, nextWidth, nextHeight);
  drawVisibleImage();
}

function drawVisibleImage() {
  if (!imagePaint || !imageCanvas || !baseCanvas.width || !baseCanvas.height) return;
  imagePaint.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  imagePaint.drawImage(baseCanvas, 0, 0, imageCanvas.width, imageCanvas.height);
}

function sameView(a, b) {
  return a.zoom === b.zoom
    && a.panX === b.panX
    && a.panY === b.panY
    && a.rotate === b.rotate
    && a.flipX === b.flipX
    && a.flipY === b.flipY;
}

function canvasImageData(canvas, ctx) {
  if (!canvas?.width || !canvas?.height || !ctx) return null;
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

function imageDataSignature(imageData) {
  if (!imageData) return "";
  const data = imageData.data;
  const step = Math.max(1, Math.floor(data.length / 4096));
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += step) {
    hash ^= data[index];
    hash = Math.imul(hash, 16777619);
  }
  return `${imageData.width}x${imageData.height}:${data.length}:${hash >>> 0}`;
}

function rectCopy(rect) {
  return rect ? { ...rect } : null;
}

function objectSnapshot(object) {
  syncObjectRecord(object);
  return {
    id: object.id,
    type: object.type,
    shape: object.shape,
    name: object.name,
    text: object.text,
    textAlign: object.textAlign,
    fontFamily: object.fontFamily,
    rotation: object.rotation || 0,
    flipX: object.flipX || 1,
    flipY: object.flipY || 1,
    fillColor: object.fillColor,
    strokeColor: object.strokeColor,
    opacity: object.opacity,
    fillOpacity: object.fillOpacity,
    strokeOpacity: object.strokeOpacity,
    strokeWidth: object.strokeWidth,
    feather: object.feather,
    sourceBoardRect: rectCopy(object.sourceBoardRect),
    sourceShape: object.sourceShape,
    sourceFeather: object.sourceFeather,
    sourceCleared: Boolean(object.sourceCleared),
    rect: rectCopy(object.rect),
    point: rectCopy(object.point),
    html: objectContentHTML(object),
    className: object.el.className.replace(/\s*\bactive\b/g, "").trim(),
    style: object.el.getAttribute("style") || "",
  };
}

function historySignature(snapshot) {
  return JSON.stringify({
    view: snapshot.view,
    base: imageDataSignature(snapshot.baseImageData),
    paint: imageDataSignature(snapshot.paintImageData),
    selectionRect: snapshot.selectionRect,
    selectionShape: snapshot.selectionShape,
    selectionInverted: snapshot.selectionInverted,
    objects: snapshot.objects.map((object) => ({
      id: object.id,
      type: object.type,
      shape: object.shape,
      name: object.name,
      text: object.text,
      textAlign: object.textAlign,
      fontFamily: object.fontFamily,
      rotation: object.rotation,
      flipX: object.flipX,
      flipY: object.flipY,
      fillColor: object.fillColor,
      strokeColor: object.strokeColor,
      opacity: object.opacity,
      fillOpacity: object.fillOpacity,
      strokeOpacity: object.strokeOpacity,
      strokeWidth: object.strokeWidth,
      feather: object.feather,
      rect: object.rect,
      point: object.point,
      html: object.html,
      className: object.className,
      style: object.style,
    })),
  });
}

function captureHistoryState() {
  const snapshot = {
    view: { ...viewState },
    baseWidth: baseCanvas.width || 0,
    baseHeight: baseCanvas.height || 0,
    baseImageData: canvasImageData(baseCanvas, basePaint),
    paintWidth: paintCanvas?.width || 0,
    paintHeight: paintCanvas?.height || 0,
    paintImageData: canvasImageData(paintCanvas, paint),
    selectionRect: rectCopy(editor.selectionRect),
    selectionShape: editor.selectionShape,
    selectionInverted: editor.selectionInverted,
    selectionFeather: editor.selectionFeather,
    selectedObjectId,
    objectCounter,
    objects: objects.filter((object) => !object.transient).map(objectSnapshot),
  };
  snapshot.signature = historySignature(snapshot);
  return snapshot;
}

function restoreObjectSnapshot(item) {
  if (!objectLayer) return null;
  const el = document.createElement("div");
  el.className = item.className || "object-item";
  el.innerHTML = item.html || "";
  el.setAttribute("style", item.style || "");
  const object = {
    id: item.id || `object-${++objectCounter}`,
    type: item.type,
    shape: item.shape,
    name: item.name,
    text: item.text,
    textAlign: item.textAlign,
    fontFamily: item.fontFamily,
    rotation: item.rotation || 0,
    flipX: item.flipX || 1,
    flipY: item.flipY || 1,
    fillColor: item.fillColor,
    strokeColor: item.strokeColor,
    opacity: item.opacity,
    fillOpacity: item.fillOpacity,
    strokeOpacity: item.strokeOpacity,
    strokeWidth: item.strokeWidth,
    feather: item.feather,
    sourceBoardRect: rectCopy(item.sourceBoardRect),
    sourceShape: item.sourceShape,
    sourceFeather: item.sourceFeather,
    sourceCleared: Boolean(item.sourceCleared),
    rect: rectCopy(item.rect),
    point: rectCopy(item.point),
    el,
    imageEl: el.querySelector("img"),
  };
  object.el.dataset.objectId = object.id;
  if (object.type === "text" && object.fontFamily) {
    object.el.style.fontFamily = `"${object.fontFamily}", ${DEFAULT_FONT_STACK}`;
  }
  if (object.type === "text") {
    textContentElement(object);
    applyTextAlignment(object, object.textAlign || "center");
  }
  objects.push(object);
  objectLayer.appendChild(object.el);
  ensureObjectBox(object);
  applyObjectColors(object);
  updateObjectTransform(object);
  attachObjectEvents(object);
  return object;
}

function restoreHistoryState(snapshot) {
  if (!snapshot) return;
  isRestoringHistory = true;
  filterBaselineCanvas = null;
  objectDrag = null;
  gesture = null;
  baseCanvas.width = Math.max(1, snapshot.baseWidth || 1);
  baseCanvas.height = Math.max(1, snapshot.baseHeight || 1);
  basePaint?.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  if (basePaint && snapshot.baseImageData) basePaint.putImageData(snapshot.baseImageData, 0, 0);
  if (imageCanvas) {
    imageCanvas.width = Math.max(1, snapshot.paintWidth || imageCanvas.width || 1);
    imageCanvas.height = Math.max(1, snapshot.paintHeight || imageCanvas.height || 1);
  }
  if (paintCanvas && paint) {
    paintCanvas.width = Math.max(1, snapshot.paintWidth || paintCanvas.width || 1);
    paintCanvas.height = Math.max(1, snapshot.paintHeight || paintCanvas.height || 1);
    paint.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    if (snapshot.paintImageData) paint.putImageData(snapshot.paintImageData, 0, 0);
  }
  objects.splice(0).forEach((object) => object.el.remove());
  objectCounter = snapshot.objectCounter || 0;
  snapshot.objects.forEach(restoreObjectSnapshot);
  selectedObjectId = snapshot.selectedObjectId || "";
  viewState = { ...snapshot.view };
  editor.selectionShape = snapshot.selectionShape || "rect";
  editor.selectionRect = rectCopy(snapshot.selectionRect);
  editor.selectionInverted = Boolean(snapshot.selectionInverted);
  editor.selectionFeather = Number(snapshot.selectionFeather || 0);
  syncSelectionOptionState();
  syncShapeOptionState();
  syncFilterOptionState();
  layoutCanvasBoard();
  applyView({ status: false });
  drawVisibleImage();
  if (editor.selectionRect) showSelectionOverlay(editor.selectionRect);
  else hideSelectionOverlay();
  setActiveObject(selectedObjectId);
  isRestoringHistory = false;
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  pushHistory({ force: true });
  if (undoStack[0] && (!initialHistoryState || initialHistoryState.baseWidth !== undoStack[0].baseWidth || initialHistoryState.baseHeight !== undoStack[0].baseHeight)) {
    initialHistoryState = undoStack[0];
  }
}

function pushHistory(options = {}) {
  if (isRestoringHistory || !baseCanvas.width || !baseCanvas.height) return;
  const snapshot = captureHistoryState();
  const last = undoStack[undoStack.length - 1];
  if (!options.force && last?.signature === snapshot.signature) return;
  undoStack.push(snapshot);
  if (undoStack.length > HISTORY_LIMIT) undoStack.splice(1, undoStack.length - HISTORY_LIMIT);
  redoStack = [];
}

function applyView(options = {}) {
  if (!board) return;
  board.style.setProperty("--zoom", String(viewState.zoom));
  board.style.setProperty("--pan-x", `${viewState.panX}px`);
  board.style.setProperty("--pan-y", `${viewState.panY}px`);
  board.style.setProperty("--rotate", `${viewState.rotate}deg`);
  board.style.setProperty("--flip-x", String(viewState.flipX));
  board.style.setProperty("--flip-y", String(viewState.flipY));
  if (options.record) pushHistory();
  if (options.status !== false) setStatus(`${Math.round(viewState.zoom * 100)}%`);
  window.requestAnimationFrame(syncMiniToolbar);
}

function setView(next, options = {}) {
  const nextZoom = Number(next.zoom);
  viewState = {
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(nextZoom) ? nextZoom : 1)),
    panX: Number(next.panX) || 0,
    panY: Number(next.panY) || 0,
    rotate: Number(next.rotate) || 0,
    flipX: Number(next.flipX) || 1,
    flipY: Number(next.flipY) || 1,
  };
  applyView(options);
}

function zoomBy(delta) {
  setView({ ...viewState, zoom: viewState.zoom + delta }, { record: true });
}

function zoomIn() {
  zoomBy(0.25);
}

function zoomOut() {
  zoomBy(-0.25);
}

function toggleHand() {
  setHandMode(!handMode);
}

function setHandMode(enabled) {
  handMode = Boolean(enabled);
  workspace?.classList.toggle("hand-mode", handMode);
  document.querySelectorAll(".right-tools [data-action]").forEach((button) => {
    if (button.dataset.action === "hand") button.classList.toggle("active", handMode);
    else if (handMode) button.classList.remove("active");
  });
  setStatus(handMode ? "Hand mode" : `${Math.round(viewState.zoom * 100)}%`);
}

function setRightButtonActive(action) {
  document.querySelectorAll(".right-tools [data-action]").forEach((button) => {
    button.classList.toggle("active", button.dataset.action === action);
  });
  if (handMode) handButton?.classList.add("active");
}

function isPanActive() {
  return handMode || spacePanMode;
}

function beginWorkspacePan(event) {
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY, panX: viewState.panX, panY: viewState.panY };
  workspace?.classList.add("dragging");
  workspace?.setPointerCapture?.(event.pointerId);
}

function clearActiveTool() {
  currentTool = "";
  document.querySelectorAll(".tool-rail [data-tool]").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".option-group[data-panel]").forEach((panel) => panel.classList.remove("active"));
  workspace?.classList.remove("draw-cursor");
  hideCropOverlay();
  hideSelectionOverlay();
  setActiveObject("");
  setStatus("");
}

function clearInitialSelectionShapeChoice() {
  optionPanel?.querySelectorAll("[data-panel='selection'] [data-selection-shape]").forEach((button) => {
    button.classList.remove("active");
  });
}

function initializeEditorTool() {
  setActiveTool("crop");
  clearInitialSelectionShapeChoice();
  optionPanel?.querySelectorAll("[data-panel='crop'] .crop-choice").forEach((button) => button.classList.remove("active"));
  editor.cropRatio = "";
  hideCropOverlay();
  clearSelection();
  setRangeValue("selectionFeather", editor.selectionFeather);
  syncSelectionOptionState();
  syncShapeOptionState();
  syncFilterOptionState();
  ensureColorDotPickers();
  updateColorDots();
}

function setActiveTool(tool) {
  if (currentTool === "transform" && tool !== "transform") cancelDeferredTransformSelection();
  if (currentTool === "crop" && tool !== "crop") cancelCropSelection();
  if (currentTool === "shape" && tool !== "shape") cancelPendingObject("shape");
  if (currentTool === "text" && tool !== "text") cancelPendingObject("text");
  if (currentTool === "icon" && tool !== "icon") cancelPendingObject("icon");
  if (currentTool === "filter" && tool !== "filter") filterBaselineCanvas = null;
  if (handMode && tool) setHandMode(false);
  closeColorPopup();
  currentTool = tool || "";
  document.querySelectorAll(".tool-rail [data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === currentTool);
  });
  document.querySelectorAll(".option-group[data-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === currentTool);
  });
  workspace?.classList.toggle("draw-cursor", ["selection", "crop", "draw", "eraser", "shape", "icon", "text"].includes(currentTool));
  hideCropOverlay();
  if (["draw", "eraser", "shape", "icon", "text", "crop"].includes(currentTool)) hideSelectionOverlay();
  if ((currentTool === "filter" || currentTool === "transform") && editor.selectionRect) showSelectionOverlay(editor.selectionRect);
  else syncMiniToolbar();
  if (currentTool === "crop" && editor.cropRatio) showCropOverlay(cropRectForRatio());
  syncSelectionOptionState();
  syncShapeOptionState();
  syncFilterOptionState();
  setStatus("");
}

function cssFilterString() {
  const list = [];
  const brightness = Math.max(0, Number(filters.brightness) || 50);
  if (filters.grayscale) list.push("grayscale(1)");
  if (filters.invert) list.push("invert(1)");
  if (filters.sepia) list.push("sepia(1)");
  if (filters.sepia2) list.push("sepia(.72) saturate(1.35) hue-rotate(-12deg)");
  if (filters.blur) list.push(`blur(${Math.max(1, Number(filters.distance) || 2)}px)`);
  if (brightness !== 50) list.push(`brightness(${Math.max(0.1, brightness / 50)})`);
  if (filters["color-filter"]) list.push("saturate(1.25)");
  return list.join(" ");
}

function applyFilterPreview() {
  applyFilterToImage();
}

function applyPixelFilters(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const brightness = Math.max(0, Number(filters.brightness) || 50) / 50;
  const threshold = Number(filters.threshold) || 45;
  const tint = hexToRgb(filters.tintColor, "#18c4b0");
  const multiply = hexToRgb(filters.multiplyColor, "#565de6");
  const blend = hexToRgb(filters.blendColor, DEFAULT_ACCENT);
  const colorAmount = Math.min(1, Math.max(0, Number(filters.tintOpacity ?? 100) / 100));
  for (let index = 0; index < data.length; index += 4) {
    let r = data[index];
    let g = data[index + 1];
    let b = data[index + 2];
    if (filters.grayscale) {
      const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      r = gray; g = gray; b = gray;
    }
    if (filters.invert) {
      r = 255 - r; g = 255 - g; b = 255 - b;
    }
    if (filters.sepia || filters.sepia2) {
      const nr = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
      const ng = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
      const nb = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
      r = nr; g = ng; b = filters.sepia2 ? Math.min(255, nb + 24) : nb;
    }
    if (brightness !== 1) {
      r = Math.min(255, r * brightness);
      g = Math.min(255, g * brightness);
      b = Math.min(255, b * brightness);
    }
    if (filters.noiseEnabled && filters.noise > 0) {
      const amount = filters.noise * 1.25;
      const noise = (Math.random() - 0.5) * amount;
      r = Math.min(255, Math.max(0, r + noise));
      g = Math.min(255, Math.max(0, g + noise));
      b = Math.min(255, Math.max(0, b + noise));
    }
    if (filters["color-filter"]) {
      const avg = (r + g + b) / 3;
      const mix = Math.min(1, Math.max(0, (threshold || 50) / 100));
      if (filters.blend === "multiply") {
        const mr = r * multiply.r / 255;
        const mg = g * multiply.g / 255;
        const mb = b * multiply.b / 255;
        r = r * (1 - colorAmount) + mr * colorAmount;
        g = g * (1 - colorAmount) + mg * colorAmount;
        b = b * (1 - colorAmount) + mb * colorAmount;
      } else if (filters.blend === "blend") {
        const amount = mix * colorAmount;
        r = r * (1 - amount) + blend.r * amount;
        g = g * (1 - amount) + blend.g * amount;
        b = b * (1 - amount) + blend.b * amount;
      } else if (avg < threshold * 2.55) {
        r = r * (1 - colorAmount) + tint.r * colorAmount;
        g = g * (1 - colorAmount) + tint.g * colorAmount;
        b = b * (1 - colorAmount) + tint.b * colorAmount;
      }
    }
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyConvolution(canvas, kernel, divisor = 1, offset = 0) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = ctx.createImageData(src.width, src.height);
  const side = Math.round(Math.sqrt(kernel.length));
  const half = Math.floor(side / 2);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      let r = 0; let g = 0; let b = 0;
      for (let ky = 0; ky < side; ky += 1) {
        for (let kx = 0; kx < side; kx += 1) {
          const px = Math.min(src.width - 1, Math.max(0, x + kx - half));
          const py = Math.min(src.height - 1, Math.max(0, y + ky - half));
          const srcIndex = (py * src.width + px) * 4;
          const weight = kernel[ky * side + kx];
          r += src.data[srcIndex] * weight;
          g += src.data[srcIndex + 1] * weight;
          b += src.data[srcIndex + 2] * weight;
        }
      }
      const outIndex = (y * src.width + x) * 4;
      out.data[outIndex] = Math.min(255, Math.max(0, r / divisor + offset));
      out.data[outIndex + 1] = Math.min(255, Math.max(0, g / divisor + offset));
      out.data[outIndex + 2] = Math.min(255, Math.max(0, b / divisor + offset));
      out.data[outIndex + 3] = src.data[outIndex + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

function applyFilterToImage() {
  if (!baseCanvas.width || !basePaint) return;
  if (!filterBaselineCanvas) {
    filterBaselineCanvas = document.createElement("canvas");
    filterBaselineCanvas.width = baseCanvas.width;
    filterBaselineCanvas.height = baseCanvas.height;
    filterBaselineCanvas.getContext("2d")?.drawImage(baseCanvas, 0, 0);
  }
  const filtered = document.createElement("canvas");
  filtered.width = baseCanvas.width;
  filtered.height = baseCanvas.height;
  const ctx = filtered.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.filter = filters.blur ? `blur(${Math.max(1, Number(filters.distance) || 2)}px)` : "none";
  ctx.drawImage(filterBaselineCanvas, 0, 0);
  ctx.restore();
  applyPixelFilters(filtered);
  if (filters.sharpen) applyConvolution(filtered, [-1, -1, -1, -1, 9, -1, -1, -1, -1]);
  if (filters.emboss) applyConvolution(filtered, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 128);
  if (filters.pixelate && filters.pixelateValue > 1) {
    const scale = Math.max(2, Math.round(filters.pixelateValue / 4));
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(filtered.width / scale));
    tiny.height = Math.max(1, Math.round(filtered.height / scale));
    const tinyCtx = tiny.getContext("2d");
    tinyCtx?.drawImage(filtered, 0, 0, tiny.width, tiny.height);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, filtered.width, filtered.height);
    ctx.drawImage(tiny, 0, 0, filtered.width, filtered.height);
    ctx.imageSmoothingEnabled = true;
  }
  basePaint.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  basePaint.drawImage(filterBaselineCanvas, 0, 0);
  const overlayRect = currentTool === "filter" ? selectionOverlayBoardRect() : null;
  if (overlayRect) editor.selectionRect = rectCopy(overlayRect);
  drawMaskedCanvas(filtered, overlayRect ? { rect: overlayRect } : {});
}

function syncRangeFill(range) {
  if (!range) return;
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const value = Number(range.value) || 0;
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  range.style.setProperty("--range-fill", `${Math.min(100, Math.max(0, percent))}%`);
}

function setFilterCheckbox(name, checked) {
  optionPanel?.querySelectorAll(`input[type="checkbox"][data-filter="${name}"]`).forEach((input) => {
    input.checked = Boolean(checked);
  });
  if (name === "color-filter") syncFilterOptionState();
}

function setRangeValue(name, value) {
  optionPanel?.querySelectorAll(`input[data-control="${name}"], input[data-filter-range="${name}"]`).forEach((range) => {
    const control = range.closest(".range-inputs");
    const text = control?.querySelector('input[type="text"]');
    range.value = String(value);
    if (text) text.value = String(value);
    syncRangeFill(range);
  });
  if (name === "selectionFeather") syncSelectionOptionState();
  if (name === "shapeFeather") syncShapeOptionState();
  if (name === "threshold" || name === "tintOpacity") syncFilterOptionState();
}

function filterColorControlsEnabled() {
  return Boolean(filters["color-filter"]);
}

function syncFilterOptionState() {
  const disabled = !filterColorControlsEnabled();
  optionPanel?.querySelectorAll('input[data-filter-range="threshold"], input[data-filter-range="tintOpacity"]').forEach((range) => {
    const control = range.closest(".range-control");
    const text = range.closest(".range-inputs")?.querySelector('input[type="text"]');
    range.disabled = disabled;
    if (text) text.disabled = disabled;
    control?.classList.toggle("disabled", disabled);
  });
}

function activeToolbarObject() {
  if (currentTool !== "transform") return null;
  return objects.find((candidate) => candidate.id === selectedObjectId && candidate.type === "raster") || null;
}

function selectionToolbarOwner() {
  return null;
}

function selectionToolbarState() {
  const object = activeToolbarObject();
  if (object && !editor.selectionRect) {
    return {
      shape: object.sourceShape || "rect",
      feather: Number(object.sourceFeather || 0),
      inverted: false,
      object,
    };
  }
  return {
    shape: editor.selectionShape,
    feather: Number(editor.selectionFeather || 0),
    inverted: editor.selectionInverted,
    object: null,
  };
}

function applyMiniSelectionShape(shape) {
  const object = activeToolbarObject();
  if (object && !editor.selectionRect) {
    object.sourceShape = shape === "ellipse" ? "ellipse" : "rect";
    if (object.sourceShape === "ellipse") object.sourceFeather = 0;
    applyTransformFeatherToObject(object, object.sourceFeather || 0);
    syncMiniToolbar();
    pushHistory();
    return;
  }
  setSelectionShape(shape);
}

function applyMiniFeatherValue(value) {
  const object = activeToolbarObject();
  if (object && !editor.selectionRect) {
    if (object.sourceShape === "ellipse") return;
    const next = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    object.sourceFeather = next;
    applyTransformFeatherToObject(object, next);
    syncMiniToolbar();
    pushHistory();
    return;
  }
  setSelectionFeatherValue(value);
}

function setSelectionShape(shape) {
  editor.selectionShape = shape === "ellipse" ? "ellipse" : "rect";
  editor.selectionInverted = false;
  optionPanel?.querySelectorAll("[data-selection-shape]").forEach((button) => {
    button.classList.toggle("active", button.dataset.selectionShape === editor.selectionShape);
  });
  optionPanel?.querySelectorAll("[data-selection-action='inverse']").forEach((item) => item.classList.remove("active"));
  if (editor.selectionShape === "ellipse") {
    editor.selectionFeather = 0;
    setRangeValue("selectionFeather", 0);
  }
  syncSelectionOptionState();
  showSelectionOverlay(editor.selectionRect);
}

function setSelectionFeatherValue(value) {
  if (editor.selectionShape === "ellipse") return;
  const next = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  editor.selectionFeather = next;
  setRangeValue("selectionFeather", next);
  showSelectionOverlay(editor.selectionRect);
  updateActiveTransformFeather();
}

function syncSelectionOptionState() {
  const disabled = editor.selectionShape === "ellipse";
  optionPanel?.querySelectorAll('input[data-control="selectionFeather"]').forEach((range) => {
    const control = range.closest(".range-control");
    const text = range.closest(".range-inputs")?.querySelector('input[type="text"]');
    range.disabled = disabled;
    if (text) text.disabled = disabled;
    control?.classList.toggle("disabled", disabled);
  });
}

function syncShapeOptionState() {
  const disabled = editor.shapeType === "circle";
  optionPanel?.querySelectorAll('input[data-control="shapeFeather"]').forEach((range) => {
    const control = range.closest(".range-control");
    const text = range.closest(".range-inputs")?.querySelector('input[type="text"]');
    range.disabled = disabled;
    if (text) text.disabled = disabled;
    control?.classList.toggle("disabled", disabled);
  });
}

function ensureSelectionMiniToolbar() {
  if (selectionMiniToolbar || !selectionOverlay) return selectionMiniToolbar;
  const host = selectionFrameElement();
  if (!host) return null;
  const toolbar = document.createElement("div");
  toolbar.className = "selection-mini-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="mini-shape" data-mini-shape="rect" aria-label="Rectangle selection"></button>
    <button type="button" class="mini-shape" data-mini-shape="ellipse" aria-label="Ellipse selection"></button>
    <button type="button" class="mini-inverse" data-mini-inverse>Inverse</button>
    <label class="mini-feather">Feather <input type="text" inputmode="numeric" value="0" data-mini-feather /></label>
  `;
  toolbar.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  toolbar.addEventListener("click", (event) => {
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : null;
    const shapeButton = target?.closest("[data-mini-shape]");
    if (shapeButton) {
      applyMiniSelectionShape(shapeButton.dataset.miniShape);
      return;
    }
    const inverseButton = target?.closest("[data-mini-inverse]");
    if (inverseButton) {
      editor.selectionInverted = !editor.selectionInverted;
      optionPanel?.querySelectorAll("[data-selection-action='inverse']").forEach((button) => button.classList.toggle("active", editor.selectionInverted));
      showSelectionOverlay(editor.selectionRect);
    }
  });
  toolbar.addEventListener("input", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.miniFeather !== undefined) applyMiniFeatherValue(input.value);
  });
  toolbar.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.miniFeather !== undefined) applyMiniFeatherValue(input.value);
  });
  toolbar.addEventListener("wheel", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-mini-feather]") : null;
    if (!(input instanceof HTMLInputElement) || input.disabled) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    applyMiniFeatherValue((Number(input.value) || 0) + direction);
  }, { passive: false });
  host.appendChild(toolbar);
  selectionMiniToolbar = toolbar;
  return toolbar;
}

function syncMiniToolbar() {
  const owner = selectionToolbarOwner();
  if (!owner) {
    document.querySelectorAll(".has-mini-toolbar").forEach((item) => item.classList.remove("has-mini-toolbar"));
    selectionMiniToolbar?.remove();
    selectionMiniToolbar = null;
    return;
  }
  const toolbar = ensureSelectionMiniToolbar();
  if (!toolbar) return;
  document.querySelectorAll(".has-mini-toolbar").forEach((item) => {
    if (item !== owner) item.classList.remove("has-mini-toolbar");
  });
  const visible = Boolean(owner);
  if (owner && toolbar.parentElement !== owner) owner.appendChild(toolbar);
  owner?.classList.toggle("has-mini-toolbar", visible);
  const state = selectionToolbarState();
  toolbar.classList.toggle("floating", Boolean(state.object));
  if (state.object && floatingToolbarLayer) {
    const boardRect = board?.getBoundingClientRect();
    const objectRect = state.object.el.getBoundingClientRect();
    toolbar.style.left = `${objectRect.left - (boardRect?.left || 0) + objectRect.width / 2}px`;
    toolbar.style.top = `${objectRect.bottom - (boardRect?.top || 0) + 2}px`;
    toolbar.style.transform = "translateX(-50%)";
  } else {
    toolbar.style.left = "50%";
    toolbar.style.top = "calc(100% + 2px)";
    toolbar.style.transform = "translateX(-50%)";
  }
  toolbar.querySelectorAll("[data-mini-shape]").forEach((button) => {
    button.classList.toggle("active", button.dataset.miniShape === state.shape);
  });
  toolbar.querySelector("[data-mini-inverse]")?.classList.toggle("active", state.inverted);
  const featherLabel = toolbar.querySelector(".mini-feather");
  const featherInput = toolbar.querySelector("[data-mini-feather]");
  const featherDisabled = state.shape === "ellipse";
  featherLabel?.classList.toggle("disabled", featherDisabled);
  if (featherInput instanceof HTMLInputElement) {
    featherInput.disabled = featherDisabled;
    featherInput.value = String(featherDisabled ? 0 : Math.round(state.feather || 0));
  }
}

function fallbackFontFamilies() {
  return [
    "Arial",
    "Avenir Next",
    "Courier New",
    "Georgia",
    "Helvetica",
    "Menlo",
    "Monaco",
    "Palatino",
    "Times New Roman",
    "Verdana",
  ];
}

function updateFontLabel() {
  if (!fontLabel) return;
  if (fontsLoading) {
    fontLabel.textContent = "Loading system fonts";
    return;
  }
  const count = systemFonts.length || fallbackFontFamilies().length;
  fontLabel.textContent = `${count} system fonts`;
}

function renderFontMenu() {
  if (!fontMenu) return;
  const fonts = systemFonts.length ? systemFonts : fallbackFontFamilies();
  fontMenu.innerHTML = "";
  fonts.forEach((family) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "font-option";
    button.dataset.fontFamily = family;
    button.textContent = family;
    button.style.fontFamily = `"${family}", ${DEFAULT_FONT_STACK}`;
    button.classList.toggle("active", editor.textFont === family);
    fontMenu.appendChild(button);
  });
  updateFontLabel();
}

async function loadSystemFonts() {
  if (fontsLoaded || fontsLoading) return;
  fontsLoading = true;
  updateFontLabel();
  try {
    const data = await api("/api/system-fonts");
    const fonts = Array.isArray(data.fonts) ? data.fonts : [];
    systemFonts = [...new Set(fonts.map((font) => String(font).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch {
    systemFonts = fallbackFontFamilies();
  } finally {
    fontsLoaded = true;
    fontsLoading = false;
    renderFontMenu();
  }
}

function setTextFont(family) {
  editor.textFont = family || "";
  updateActiveObjectStyle();
  renderFontMenu();
  pushHistory();
}

function syncLinkedRangeControls(name, value, sourceInput) {
  optionPanel?.querySelectorAll(`input[data-control="${name}"], input[data-filter-range="${name}"]`).forEach((range) => {
    if (range === sourceInput) return;
    const control = range.closest(".range-inputs");
    const text = control?.querySelector('input[type="text"]');
    range.value = String(value);
    if (text) text.value = String(value);
    syncRangeFill(range);
  });
}

function syncRangeControl(input) {
  if (input.disabled) return;
  const control = input.closest(".range-inputs");
  if (!control) return;
  const range = control.querySelector('input[type="range"]');
  const value = control.querySelector('input[type="text"]');
  const source = input.type === "range" ? range : value;
  const target = input.type === "range" ? value : range;
  if (!source || !target) return;
  const min = Number(range?.min) || 0;
  const max = Number(range?.max) || 100;
  const next = Math.min(max, Math.max(min, Math.round(Number(source.value) || 0)));
  source.value = String(next);
  target.value = String(next);
  syncRangeFill(range);
  const name = range?.dataset.control || range?.dataset.filterRange || "";
  syncLinkedRangeControls(name, next, range);
  applyControlValue(name, next);
}

function applyOpacityControl(type, value) {
  const info = colorTargetOpacityInfo(activeColorTarget);
  if (info?.type === type) editor[info.key] = value;
  else editor[`${type}Opacity`] = value;
  updateActiveObjectStyle();
}

function applyControlValue(name, value) {
  const assignments = {
    drawSize: () => { editor.drawSize = value; },
    drawOpacity: () => { editor.drawOpacity = value; },
    selectionFeather: () => { setSelectionFeatherValue(value); },
    eraserSize: () => { editor.eraserSize = value; },
    eraserOpacity: () => { editor.eraserOpacity = value; },
    shapeStroke: () => { editor.shapeStroke = value; updateActiveObjectStyle(); },
    shapeFeather: () => {
      if (editor.shapeType === "circle") {
        editor.shapeFeather = 0;
        setRangeValue("shapeFeather", 0);
        return;
      }
      editor.shapeFeather = value;
      updateActiveObjectStyle();
    },
    shapeOpacity: () => { applyOpacityControl("shape", value); },
    iconOpacity: () => { applyOpacityControl("icon", value); },
    textSize: () => { editor.textSize = value; updateActiveObjectStyle(); },
    textOpacity: () => { applyOpacityControl("text", value); },
    distance: () => {
      filters.distance = value;
      if (value > 0) {
        filters.blur = true;
        setFilterCheckbox("blur", true);
      }
      applyFilterPreview();
    },
    brightness: () => { filters.brightness = value; applyFilterPreview(); },
    noise: () => {
      filters.noise = value;
      filters.noiseEnabled = value > 0;
      setFilterCheckbox("noiseEnabled", filters.noiseEnabled);
      applyFilterPreview();
    },
    pixelate: () => {
      filters.pixelateValue = value;
      filters.pixelate = value > 0;
      setFilterCheckbox("pixelate", filters.pixelate);
      applyFilterPreview();
    },
    threshold: () => {
      if (!filterColorControlsEnabled()) return;
      filters.threshold = value;
      applyFilterPreview();
    },
    tintOpacity: () => {
      if (!filterColorControlsEnabled()) return;
      filters.tintOpacity = value;
      applyFilterPreview();
    },
  };
  assignments[name]?.();
}

function setScopedActive(button) {
  const multi = button.dataset.textStyle;
  if (button.dataset.transform) {
    optionPanel?.querySelectorAll("[data-transform]").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
    });
    return;
  }
  const scope = button.closest(".crop-grid, .shape-grid, .icon-grid, .icon-pair, .selection-shapes, .filter-color-row");
  if (!scope) return;
  if (multi) button.classList.toggle("active");
  else scope.querySelectorAll("button").forEach((candidate) => {
    candidate.classList.toggle("active", candidate === button);
  });
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function screenPointToBoardPoint(clientX, clientY, options = {}) {
  const rect = board.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  let x = clientX - rect.left - centerX;
  let y = clientY - rect.top - centerY;
  x -= viewState.panX;
  y -= viewState.panY;
  const zoom = Math.max(MIN_ZOOM, Number(viewState.zoom) || 1);
  x /= zoom;
  y /= zoom;
  const angle = -(Number(viewState.rotate) || 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  x = rx / (viewState.flipX || 1);
  y = ry / (viewState.flipY || 1);
  const point = {
    x: centerX + x,
    y: centerY + y,
  };
  if (options.clamp === false) return point;
  return {
    x: clampValue(point.x, 0, rect.width),
    y: clampValue(point.y, 0, rect.height),
  };
}

function boardPoint(event, options = {}) {
  return screenPointToBoardPoint(event.clientX, event.clientY, options);
}

function boardSize() {
  const rect = board?.getBoundingClientRect();
  return {
    width: Math.max(1, rect?.width || paintCanvas?.width || 1),
    height: Math.max(1, rect?.height || paintCanvas?.height || 1),
  };
}

function boardToBase(point) {
  return {
    x: point.x / (paintCanvas?.width || 1) * (baseCanvas.width || 1),
    y: point.y / (paintCanvas?.height || 1) * (baseCanvas.height || 1),
  };
}

function baseToBoard(point) {
  return {
    x: point.x / (baseCanvas.width || 1) * (paintCanvas?.width || 1),
    y: point.y / (baseCanvas.height || 1) * (paintCanvas?.height || 1),
  };
}

function rectBoardToBase(rect) {
  const p1 = boardToBase({ x: rect.x, y: rect.y });
  const p2 = boardToBase({ x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: Math.max(0, Math.min(p1.x, p2.x)),
    y: Math.max(0, Math.min(p1.y, p2.y)),
    width: Math.min(baseCanvas.width, Math.max(p1.x, p2.x)) - Math.max(0, Math.min(p1.x, p2.x)),
    height: Math.min(baseCanvas.height, Math.max(p1.y, p2.y)) - Math.max(0, Math.min(p1.y, p2.y)),
  };
}

function normalizedRect(a, b, shape = "rect", forceSquare = false) {
  let x1 = a.x;
  let y1 = a.y;
  let x2 = b.x;
  let y2 = b.y;
  if (forceSquare) {
    const side = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
    x2 = x1 + Math.sign(x2 - x1 || 1) * side;
    y2 = y1 + Math.sign(y2 - y1 || 1) * side;
  }
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function objectCreationRectReady(rect) {
  return rect.width >= OBJECT_CREATE_MIN_SIZE && rect.height >= OBJECT_CREATE_MIN_SIZE;
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function roundedPolygonPath(points, radius) {
  const amount = Math.max(0, Number(radius) || 0);
  if (!amount) return `M${points.map((point) => `${point.x},${point.y}`).join(" L")} Z`;
  const parts = [];
  points.forEach((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const prevDistance = Math.hypot(previous.x - point.x, previous.y - point.y);
    const nextDistance = Math.hypot(next.x - point.x, next.y - point.y);
    const offset = Math.min(amount, prevDistance / 2 - 1, nextDistance / 2 - 1);
    const start = {
      x: point.x + (previous.x - point.x) / prevDistance * offset,
      y: point.y + (previous.y - point.y) / prevDistance * offset,
    };
    const end = {
      x: point.x + (next.x - point.x) / nextDistance * offset,
      y: point.y + (next.y - point.y) / nextDistance * offset,
    };
    if (index === 0) parts.push(`M${start.x.toFixed(2)},${start.y.toFixed(2)}`);
    else parts.push(`L${start.x.toFixed(2)},${start.y.toFixed(2)}`);
    parts.push(`Q${point.x.toFixed(2)},${point.y.toFixed(2)} ${end.x.toFixed(2)},${end.y.toFixed(2)}`);
  });
  parts.push("Z");
  return parts.join(" ");
}

function roundedPolygonCanvasPath(ctx, points, radius) {
  const amount = Math.max(0, Number(radius) || 0);
  if (!amount) {
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    return;
  }
  points.forEach((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const prevDistance = Math.max(1, Math.hypot(previous.x - point.x, previous.y - point.y));
    const nextDistance = Math.max(1, Math.hypot(next.x - point.x, next.y - point.y));
    const offset = Math.min(amount, prevDistance / 2 - 1, nextDistance / 2 - 1);
    const start = {
      x: point.x + (previous.x - point.x) / prevDistance * offset,
      y: point.y + (previous.y - point.y) / prevDistance * offset,
    };
    const end = {
      x: point.x + (next.x - point.x) / nextDistance * offset,
      y: point.y + (next.y - point.y) / nextDistance * offset,
    };
    if (index === 0) ctx.moveTo(start.x, start.y);
    else ctx.lineTo(start.x, start.y);
    ctx.quadraticCurveTo(point.x, point.y, end.x, end.y);
  });
  ctx.closePath();
}

function trianglePath(feather = editor.shapeFeather) {
  const radius = Math.min(22, Math.max(0, Number(feather) || 0) * 0.22);
  return roundedPolygonPath([
    { x: 50, y: 7 },
    { x: 94, y: 92 },
    { x: 6, y: 92 },
  ], radius);
}

function shapeControlOffset(object) {
  if (object?.type !== "shape") return 0;
  const strokeWidth = Number(object.strokeWidth ?? editor.shapeStroke) || 0;
  return Math.max(2, Math.ceil(strokeWidth / 2) + 2);
}

function updateShapeControlOffset(object) {
  if (object?.type !== "shape") return;
  object.el.style.setProperty("--object-control-offset", `${shapeControlOffset(object)}px`);
}

function selectionFrameElement() {
  if (!selectionOverlay) return null;
  if (!selectionFrame || !selectionOverlay.contains(selectionFrame)) {
    selectionFrame = document.createElement("div");
    selectionFrame.className = "selection-frame";
    selectionOverlay.appendChild(selectionFrame);
  }
  return selectionFrame;
}

function overlayRectTarget(overlay) {
  return overlay === selectionOverlay ? selectionFrameElement() : overlay;
}

function setOverlayRect(overlay, rect, shape = "rect") {
  if (!overlay) return;
  overlay.style.display = "block";
  const target = overlayRectTarget(overlay);
  if (!target) return;
  if (overlay === selectionOverlay) {
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
  }
  target.style.left = `${rect.x}px`;
  target.style.top = `${rect.y}px`;
  target.style.width = `${rect.width}px`;
  target.style.height = `${rect.height}px`;
  const radius = shape === "ellipse" ? "50%" : `${Math.min(editor.selectionFeather, rect.width / 2, rect.height / 2)}px`;
  target.style.borderRadius = radius;
  target.style.setProperty("--selection-radius", radius);
}

function hideSelectionOverlay() {
  if (selectionOverlay) selectionOverlay.style.display = "none";
  syncMiniToolbar();
}

function ensureSelectionHandles() {
  const host = selectionFrameElement();
  if (selectionHandles || !host) return selectionHandles;
  const controls = document.createElement("div");
  controls.className = "selection-object-controls";
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((handle) => {
    const control = document.createElement("span");
    control.className = `object-transform-handle handle-${handle}`;
    controls.appendChild(control);
  });
  ["nw", "ne", "se", "sw"].forEach((handle) => {
    const rotate = document.createElement("span");
    rotate.className = `object-rotate-handle rotate-${handle}`;
    controls.appendChild(rotate);
  });
  host.appendChild(controls);
  selectionHandles = controls;
  return controls;
}

function clearSelection() {
  editor.selectionRect = null;
  editor.selectionInverted = false;
  hideSelectionOverlay();
  optionPanel?.querySelectorAll("[data-selection-action='inverse']").forEach((item) => item.classList.remove("active"));
}

function showSelectionOverlay(rect = null) {
  const bounds = rect || editor.selectionRect;
  if (!bounds) {
    hideSelectionOverlay();
    return;
  }
  editor.selectionRect = bounds;
  ensureSelectionHandles();
  setOverlayRect(selectionOverlay, bounds, editor.selectionShape === "ellipse" ? "ellipse" : "rect");
  selectionOverlay?.classList.toggle("inverted", editor.selectionInverted);
  selectionOverlay?.classList.toggle("filter-object-handles", currentTool === "filter");
  selectionOverlay?.style.setProperty("--selection-feather", `${editor.selectionFeather}px`);
  syncMiniToolbar();
}

function selectionOverlayBoardRect() {
  if (!selectionOverlay || selectionOverlay.style.display === "none") return null;
  const target = selectionFrameElement();
  if (!target) return null;
  const rect = {
    x: parseFloat(target.style.left || ""),
    y: parseFloat(target.style.top || ""),
    width: parseFloat(target.style.width || ""),
    height: parseFloat(target.style.height || ""),
  };
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

function createSelectionMask(allowFull = true, options = {}) {
  if (!baseCanvas.width || !baseCanvas.height) return null;
  const mask = document.createElement("canvas");
  mask.width = baseCanvas.width;
  mask.height = baseCanvas.height;
  const ctx = mask.getContext("2d");
  if (!ctx) return null;
  const sourceRect = options.rect || editor.selectionRect;
  const sourceShape = options.shape || editor.selectionShape;
  const sourceFeather = options.feather ?? editor.selectionFeather;
  const sourceInverted = options.inverted ?? editor.selectionInverted;
  if (!sourceRect && !allowFull) return null;
  const rect = sourceRect
    ? rectBoardToBase(sourceRect)
    : { x: 0, y: 0, width: baseCanvas.width, height: baseCanvas.height };
  const shapeCanvas = document.createElement("canvas");
  shapeCanvas.width = baseCanvas.width;
  shapeCanvas.height = baseCanvas.height;
  const shapeCtx = shapeCanvas.getContext("2d");
  if (!shapeCtx) return null;
  const feather = Math.max(0, sourceFeather || 0) / (paintCanvas?.width || 1) * baseCanvas.width;
  const shouldBlur = options.blur !== false;
  const radius = options.radius === false ? 0 : feather;
  shapeCtx.save();
  if (shouldBlur && feather > 0) shapeCtx.filter = `blur(${feather}px)`;
  shapeCtx.fillStyle = "#ffffff";
  shapeCtx.beginPath();
  if (sourceShape === "ellipse") {
    shapeCtx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
  } else {
    roundedRectPath(shapeCtx, rect.x, rect.y, rect.width, rect.height, radius);
  }
  shapeCtx.fill();
  shapeCtx.restore();

  if (sourceInverted) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(shapeCanvas, 0, 0);
  } else {
    ctx.drawImage(shapeCanvas, 0, 0);
  }
  return mask;
}

function drawMaskedCanvas(source, options = {}) {
  const mask = createSelectionMask(true, options);
  if (!mask || !basePaint) return;
  const masked = document.createElement("canvas");
  masked.width = baseCanvas.width;
  masked.height = baseCanvas.height;
  const maskedCtx = masked.getContext("2d");
  maskedCtx?.drawImage(source, 0, 0);
  if (maskedCtx) {
    maskedCtx.globalCompositeOperation = "destination-in";
    maskedCtx.drawImage(mask, 0, 0);
  }
  basePaint.drawImage(masked, 0, 0);
  drawVisibleImage();
}

function cropAspectRatio() {
  const { width, height } = boardSize();
  if (!editor.cropRatio) return null;
  if (editor.cropRatio === "custom") return null;
  if (editor.cropRatio === "original") return width / height;
  const ratio = Number(editor.cropRatio);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : width / height;
}

function cropObject() {
  return objects.find((object) => object.type === "crop") || null;
}

function removeCropObject() {
  const index = objects.findIndex((object) => object.type === "crop");
  if (index < 0) return false;
  const [object] = objects.splice(index, 1);
  object.el.remove();
  if (selectedObjectId === object.id) setActiveObject("");
  return true;
}

function cropDragRect(start, point) {
  const aspect = cropAspectRatio();
  if (!aspect) return normalizedRect(start, point, "rect", false);
  const { width: boardWidth, height: boardHeight } = boardSize();
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  let width = Math.max(1, Math.abs(dx));
  let height = Math.max(1, Math.abs(dy));
  if (width / aspect > height) height = width / aspect;
  else width = height * aspect;
  width = Math.min(width, dx < 0 ? start.x : boardWidth - start.x);
  height = Math.min(height, dy < 0 ? start.y : boardHeight - start.y);
  if (width / aspect > height) width = height * aspect;
  else height = width / aspect;
  return {
    x: dx < 0 ? start.x - width : start.x,
    y: dy < 0 ? start.y - height : start.y,
    width,
    height,
  };
}

function hideCropOverlay() {
  if (cropOverlay) cropOverlay.style.display = "none";
  removeCropObject();
}

function cancelCropSelection() {
  const hadCrop = Boolean(cropObject() || editor.cropRatio);
  if (cropOverlay) cropOverlay.style.display = "none";
  removeCropObject();
  editor.cropRatio = "";
  optionPanel?.querySelectorAll("[data-panel='crop'] .crop-choice").forEach((button) => button.classList.remove("active"));
  setActiveObject("");
  return hadCrop;
}

function cropRectForRatio() {
  const { width, height } = boardSize();
  const ratio = editor.cropRatio;
  if (ratio === "original" || ratio === "custom") {
    return { x: 0, y: 0, width, height };
  }
  const aspect = Number(ratio) || width / height;
  let cropWidth = width;
  let cropHeight = cropWidth / aspect;
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = cropHeight * aspect;
  }
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

function showCropOverlay(rect = null) {
  if (currentTool !== "crop") return;
  if (!rect) {
    hideCropOverlay();
    return;
  }
  if (cropOverlay) cropOverlay.style.display = "none";
  const aspect = cropAspectRatio();
  let object = cropObject();
  if (!object) {
    const el = document.createElement("div");
    el.className = "object-item crop-object";
    object = { type: "crop", transient: true, rect: { ...rect }, el };
    addObject(object, { record: false });
  }
  object.fixedAspect = aspect;
  object.cropRatio = editor.cropRatio;
  object.el.style.left = `${rect.x}px`;
  object.el.style.top = `${rect.y}px`;
  object.el.style.width = `${rect.width}px`;
  object.el.style.height = `${rect.height}px`;
  syncObjectRecord(object);
  setActiveObject(object.id);
}

function cropCanvasFromObject(object, boardWidth, boardHeight) {
  const metrics = objectMetrics(object);
  const scaleX = baseCanvas.width / Math.max(1, boardWidth);
  const scaleY = baseCanvas.height / Math.max(1, boardHeight);
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(metrics.width * scaleX));
  output.height = Math.max(1, Math.round(metrics.height * scaleY));
  const ctx = output.getContext("2d");
  if (!ctx) return output;
  const centerX = (metrics.left + metrics.width / 2) * scaleX;
  const centerY = (metrics.top + metrics.height / 2) * scaleY;
  ctx.save();
  ctx.translate(output.width / 2, output.height / 2);
  ctx.rotate((-Number(object.rotation || 0) * Math.PI) / 180);
  ctx.drawImage(baseCanvas, -centerX, -centerY);
  ctx.restore();
  return output;
}

function applyCrop() {
  if (!baseCanvas.width || !baseCanvas.height) return;
  filterBaselineCanvas = null;
  const { width: boardWidth, height: boardHeight } = boardSize();
  const activeCrop = cropObject();
  if (!activeCrop && (!cropOverlay || cropOverlay.style.display === "none")) return;
  let output;
  if (activeCrop) {
    output = cropCanvasFromObject(activeCrop, boardWidth, boardHeight);
  } else {
    const rect = {
      x: parseFloat(cropOverlay.style.left) || 0,
      y: parseFloat(cropOverlay.style.top) || 0,
      width: parseFloat(cropOverlay.style.width) || boardWidth,
      height: parseFloat(cropOverlay.style.height) || boardHeight,
    };
    const sx = rect.x / boardWidth * baseCanvas.width;
    const sy = rect.y / boardHeight * baseCanvas.height;
    const sw = rect.width / boardWidth * baseCanvas.width;
    const sh = rect.height / boardHeight * baseCanvas.height;
    output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(sw));
    output.height = Math.max(1, Math.round(sh));
    output.getContext("2d")?.drawImage(baseCanvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
  }
  baseCanvas.width = output.width;
  baseCanvas.height = output.height;
  basePaint?.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  basePaint?.drawImage(output, 0, 0);
  paint?.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  objects.splice(0).forEach((object) => object.el.remove());
  clearSelection();
  hideCropOverlay();
  layoutCanvasBoard();
  resetView({ record: false });
  pushHistory({ force: true });
}

function drawLine(from, to, mode = "draw") {
  if (mode === "erase") {
    if (!basePaint || !paintCanvas?.width) return;
    filterBaselineCanvas = null;
    const start = boardToBase(from);
    const end = boardToBase(to);
    basePaint.save();
    basePaint.lineCap = "round";
    basePaint.lineJoin = "round";
    basePaint.lineWidth = editor.eraserSize / paintCanvas.width * baseCanvas.width;
    basePaint.globalAlpha = opacityControlToAlpha(editor.eraserOpacity);
    basePaint.globalCompositeOperation = "destination-out";
    if (editor.eraserSoft) {
      basePaint.shadowColor = "rgba(0,0,0,1)";
      basePaint.shadowBlur = basePaint.lineWidth * 0.55;
    }
    basePaint.strokeStyle = "#000";
    basePaint.beginPath();
    basePaint.moveTo(start.x, start.y);
    basePaint.lineTo(end.x, end.y);
    basePaint.stroke();
    basePaint.restore();
    drawVisibleImage();
    return;
  }
  if (!paint) return;
  paint.save();
  paint.lineCap = "round";
  paint.lineJoin = "round";
  paint.lineWidth = editor.drawSize;
  paint.globalAlpha = opacityControlToAlpha(editor.drawOpacity);
  paint.globalCompositeOperation = "source-over";
  paint.strokeStyle = editor.drawColor;
  paint.beginPath();
  paint.moveTo(from.x, from.y);
  paint.lineTo(to.x, to.y);
  paint.stroke();
  paint.restore();
}

function constrainLinePoint(start, point, constrain = false) {
  if (!constrain) return point;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (!dx && !dy) return point;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  return {
    x: start.x + Math.cos(snapped) * distance,
    y: start.y + Math.sin(snapped) * distance,
  };
}

function restorePaintPreview(gestureState) {
  if (!paint || !paintCanvas || !gestureState?.paintSnapshot) return;
  paint.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  paint.putImageData(gestureState.paintSnapshot, 0, 0);
}

function objectMetricValue(el, property, fallback = 0) {
  const value = parseFloat(el.style[property] || "");
  if (Number.isFinite(value)) return value;
  return fallback;
}

function objectMetrics(object) {
  const rect = object.el.getBoundingClientRect();
  const width = objectMetricValue(object.el, "width", rect.width || 48);
  const height = objectMetricValue(object.el, "height", rect.height || 48);
  return {
    left: objectMetricValue(object.el, "left", 0),
    top: objectMetricValue(object.el, "top", 0),
    width: Math.max(12, width),
    height: Math.max(12, height),
    rotation: Number(object.rotation || 0),
  };
}

function transformFeatherRadius(object, feather = editor.selectionFeather) {
  const metrics = objectMetrics(object);
  if (object.sourceShape === "ellipse") return "50%";
  const radius = Math.min(Math.max(0, Number(feather) || 0), metrics.width / 2, metrics.height / 2);
  return `${radius}px`;
}

function applyTransformFeatherToObject(object, feather = editor.selectionFeather) {
  if (!object || object.type !== "raster") return;
  object.sourceFeather = Number(feather) || 0;
  object.el.style.borderRadius = transformFeatherRadius(object, object.sourceFeather);
  if (object.imageEl) object.imageEl.style.borderRadius = "inherit";
}

function updateActiveTransformFeather() {
  const object = objects.find((candidate) => candidate.id === selectedObjectId);
  if (object?.type === "raster") applyTransformFeatherToObject(object);
}

function ensureObjectBox(object) {
  const metrics = objectMetrics(object);
  object.el.style.width = `${metrics.width}px`;
  object.el.style.height = `${metrics.height}px`;
  syncObjectRecord(object);
}

function updateObjectTransform(object) {
  const rotation = Number(object.rotation || 0);
  const flipX = object.flipX || 1;
  const flipY = object.flipY || 1;
  object.el.style.transform = `rotate(${rotation}deg) scale(${flipX}, ${flipY})`;
  syncMiniToolbar();
}

function applyObjectColors(object) {
  const fill = object.fillColor || DEFAULT_ACCENT;
  const stroke = object.strokeColor || fill;
  const fillCss = colorWithOpacity(fill, object.fillOpacity ?? DEFAULT_OPACITY_VALUE);
  const strokeCss = colorWithOpacity(stroke, object.strokeOpacity ?? DEFAULT_OPACITY_VALUE);
  object.el.style.setProperty("--object-fill", fillCss);
  object.el.style.setProperty("--object-stroke", strokeCss);
  object.el.style.color = fillCss;
  if (object.type === "text") {
    const content = textContentElement(object);
    if (content) content.style.color = fillCss;
    object.el.style.webkitTextStroke = object.strokeColor ? `1px ${strokeCss}` : "0 transparent";
    if (content) content.style.webkitTextStroke = object.strokeColor ? `1px ${strokeCss}` : "0 transparent";
  }
  if (object.type === "shape") {
    if (object.shape === "triangle") {
      const path = object.el.querySelector("path");
      if (path) {
        path.setAttribute("d", trianglePath(object.feather ?? 0));
        path.setAttribute("fill", fill === "transparent" ? "none" : fillCss);
        path.setAttribute("stroke", strokeCss);
        path.setAttribute("stroke-width", String(object.strokeWidth ?? editor.shapeStroke));
      }
    } else {
      object.el.style.background = fill === "transparent" ? "transparent" : fillCss;
      object.el.style.borderColor = strokeCss;
    }
    updateShapeControlOffset(object);
  }
}

function syncObjectRecord(object) {
  const metrics = objectMetrics(object);
  if (object.rect) {
    object.rect.x = metrics.left;
    object.rect.y = metrics.top;
    object.rect.width = metrics.width;
    object.rect.height = metrics.height;
  }
  if (object.point) {
    object.point.x = metrics.left;
    object.point.y = metrics.top;
  }
  if (object.type === "text") {
    object.text = textObjectContent(object, object.text || "");
    object.textAlign = object.textAlign || editor.textAlign || "center";
  }
}

function textObjectContent(object, fallback = "Text") {
  const content = textContentElement(object);
  const raw = content?.innerText ?? content?.textContent ?? object?.text ?? "";
  const text = String(raw).replace(/\u200B/g, "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
  return text || fallback;
}

function textContentElement(object) {
  if (!object?.el || object.type !== "text") return null;
  let content = object.el.querySelector(":scope > .text-content");
  if (content) return content;
  content = document.createElement("div");
  content.className = "text-content";
  const controls = object.el.querySelector(":scope > .object-controls");
  const textParts = [];
  Array.from(object.el.childNodes).forEach((node) => {
    if (node === controls) return;
    textParts.push(node.textContent || "");
    node.remove();
  });
  content.textContent = textParts.join("").trim() || object.text || "Double Click";
  if (controls) object.el.insertBefore(content, controls);
  else object.el.appendChild(content);
  return content;
}

function setTextObjectDisplay(object, value) {
  const content = textContentElement(object);
  if (content) content.textContent = value;
}

function applyTextAlignment(object, align = object?.textAlign || editor.textAlign || "center") {
  if (!object?.el) return;
  const normalized = ["left", "center", "right"].includes(align) ? align : "center";
  const content = textContentElement(object);
  object.textAlign = normalized;
  object.el.style.textAlign = normalized;
  object.el.style.justifyContent = normalized === "left" ? "flex-start" : normalized === "right" ? "flex-end" : "center";
  if (content) content.style.textAlign = normalized;
}

function objectContentHTML(object) {
  const clone = object.el.cloneNode(true);
  clone.querySelector(".object-controls")?.remove();
  return clone.innerHTML;
}

function ensureObjectControls(object) {
  if (object.type === "text") textContentElement(object);
  if (object.el.querySelector(".object-controls")) return;
  const controls = document.createElement("div");
  controls.className = "object-controls";
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((handle) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `object-transform-handle handle-${handle}`;
    control.dataset.objectControl = handle;
    control.setAttribute("aria-label", `Resize ${handle}`);
    controls.appendChild(control);
  });
  ["nw", "ne", "se", "sw"].forEach((handle) => {
    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.className = `object-rotate-handle rotate-${handle}`;
    rotate.dataset.objectControl = "rotate";
    rotate.dataset.rotateHandle = handle;
    rotate.setAttribute("aria-label", `Rotate ${handle}`);
    controls.appendChild(rotate);
  });
  object.el.appendChild(controls);
  if (object.type === "text") textContentElement(object);
}

function attachTextEditEvent(object) {
  if (object.type !== "text" || object.textEditAttached) return;
  object.textEditAttached = true;
  object.el.addEventListener("dblclick", (event) => {
    window.clearTimeout(object.pendingTextCancelTimer);
    event.preventDefault();
    event.stopPropagation();
    if (object.pendingCommit && !object.textEditing) {
      beginTextInlineEdit(object);
      return;
    }
    if (object.textEditing) {
      finishTextInlineEdit(object, { keepActive: true, record: !object.pendingCommit });
      if (object.pendingCommit) commitPendingObject(object, { keepActive: true });
    } else {
      beginTextInlineEdit(object);
    }
  });
  object.el.addEventListener("keydown", (event) => {
    if (object.textEditing && event.key === "Escape") {
      event.preventDefault();
      setTextObjectDisplay(object, object.textBeforeEdit || object.text || "Text");
      finishTextInlineEdit(object, { keepActive: true });
      return;
    }
    if (object.textEditing) return;
    if (!object.pendingCommit) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitPendingObject(object, { keepActive: true });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelPendingObject("text");
    }
  });
}

function placeCaretAtTextEnd(object) {
  const content = textContentElement(object);
  if (!content) return;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(content);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function beginTextInlineEdit(object) {
  if (!object || object.type !== "text") return;
  const content = textContentElement(object);
  setActiveObject(object.id);
  object.textEditing = true;
  object.textBeforeEdit = textObjectContent(object, object.text || "");
  content.contentEditable = "true";
  content.spellcheck = false;
  object.el.classList.add("text-editing");
  applyTextAlignment(object);
  if ((content.textContent || "").trim() === "Double Click") {
    content.textContent = TEXT_CARET_SEED;
  }
  window.requestAnimationFrame(() => {
    content.focus();
    placeCaretAtTextEnd(object);
  });
}

function finishTextInlineEdit(object, options = {}) {
  if (!object || object.type !== "text") return false;
  const keepActive = options.keepActive !== false;
  const shouldRecord = options.record !== false;
  const content = textContentElement(object);
  object.textEditing = false;
  content.contentEditable = "false";
  object.el.classList.remove("text-editing");
  object.text = textObjectContent(object);
  content.textContent = object.text;
  applyTextAlignment(object);
  ensureObjectControls(object);
  syncObjectRecord(object);
  ensureObjectBox(object);
  setActiveObject(keepActive ? object.id : "");
  if (shouldRecord) pushHistory({ force: true });
  setStatus("Applied.");
  return true;
}

function attachObjectEvents(object) {
  if (object.eventsAttached) return;
  object.eventsAttached = true;
  ensureObjectControls(object);
  attachTextEditEvent(object);
  object.el.addEventListener("dblclick", (event) => {
    if (isDeferredTransformObject(object)) {
      event.preventDefault();
      event.stopPropagation();
      commitDeferredTransformObject(object);
      return;
    }
    if (!object.pendingCommit || (object.type !== "shape" && object.type !== "icon")) return;
    event.preventDefault();
    event.stopPropagation();
    commitPendingObject(object);
  });
  if (object.type === "text") {
    object.el.addEventListener("click", (event) => {
      if (event.target.closest("[data-object-control]") || object.pendingCommit || object.textEditing) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveObject(object.id);
    });
  }
  if (object.type === "crop") {
    object.el.addEventListener("click", (event) => {
      if (event.target.closest("[data-object-control]")) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(object.cropClickTimer);
      object.cropClickTimer = window.setTimeout(() => cancelCropSelection(), 220);
    });
    object.el.addEventListener("dblclick", (event) => {
      if (event.target.closest("[data-object-control]")) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(object.cropClickTimer);
      applyCrop();
    });
  }
  object.el.addEventListener("pointerdown", (event) => {
    const control = event.target.closest("[data-object-control]");
    if (control) return;
    event.stopPropagation();
    if (object.type === "text" && object.textEditing) {
      setActiveObject(object.id);
      return;
    }
    event.preventDefault();
    if (object.type === "text" && object.pendingCommit) {
      setActiveObject(object.id);
      window.clearTimeout(object.pendingTextCancelTimer);
      object.pendingTextCancelTimer = window.setTimeout(() => {
        if (object.pendingCommit) cancelPendingObject("text");
      }, 450);
      return;
    }
    if (object.type === "crop") {
      setActiveObject(object.id);
      return;
    }
    setActiveObject(object.id);
    const metrics = objectMetrics(object);
    const startPoint = boardPoint(event, { clamp: false });
    objectDrag = {
      id: object.id,
      mode: "move",
      startX: event.clientX,
      startY: event.clientY,
      startPoint,
      metrics,
      moved: false,
    };
    object.el.setPointerCapture?.(event.pointerId);
  });
  object.el.querySelectorAll("[data-object-control]").forEach((control) => {
    control.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      setActiveObject(object.id);
      const metrics = objectMetrics(object);
      const startPoint = boardPoint(event, { clamp: false });
      const center = {
        x: metrics.left + metrics.width / 2,
        y: metrics.top + metrics.height / 2,
      };
      objectDrag = {
        id: object.id,
        mode: control.dataset.objectControl,
        startX: event.clientX,
        startY: event.clientY,
        startPoint,
        metrics,
        fontSize: parseFloat(object.el.style.fontSize || `${editor.textSize}`) || editor.textSize,
        startPointerAngle: Math.atan2(startPoint.y - center.y, startPoint.x - center.x) * 180 / Math.PI,
        center,
        moved: false,
      };
      control.setPointerCapture?.(event.pointerId);
    });
  });
}

function addObject(object, options = {}) {
  const shouldSelect = options.select !== false;
  const shouldRecord = options.record !== false;
  object.id = `object-${++objectCounter}`;
  object.el.dataset.objectId = object.id;
  object.rotation = Number(object.rotation || 0);
  object.flipX = object.flipX || 1;
  object.flipY = object.flipY || 1;
  objects.push(object);
  objectLayer?.appendChild(object.el);
  ensureObjectBox(object);
  applyObjectColors(object);
  updateObjectTransform(object);
  attachObjectEvents(object);
  if (shouldSelect) setActiveObject(object.id);
  if (shouldRecord) pushHistory({ force: true });
}

function setActiveObject(id) {
  selectedObjectId = id || "";
  document.querySelectorAll(".object-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.objectId === selectedObjectId);
  });
  syncMiniToolbar();
}

function resizeObject(object, event) {
  const drag = objectDrag;
  const handle = drag.mode || "";
  const start = drag.metrics;
  let left = start.left;
  let top = start.top;
  let width = start.width;
  let height = start.height;
  const point = boardPoint(event, { clamp: false });
  const startPoint = drag.startPoint || point;
  const dx = point.x - startPoint.x;
  const dy = point.y - startPoint.y;

  if (handle.includes("e")) width = start.width + dx;
  if (handle.includes("s")) height = start.height + dy;
  if (handle.includes("w")) {
    width = start.width - dx;
    left = start.left + dx;
  }
  if (handle.includes("n")) {
    height = start.height - dy;
    top = start.top + dy;
  }

  if (object.fixedAspect) {
    const aspect = Number(object.fixedAspect) || 1;
    if (handle === "n" || handle === "s") {
      width = Math.max(1, height * aspect);
      left = start.left + (start.width - width) / 2;
      if (handle === "n") top = start.top + start.height - height;
    } else if (handle === "e" || handle === "w") {
      height = Math.max(1, width / aspect);
      top = start.top + (start.height - height) / 2;
      if (handle === "w") left = start.left + start.width - width;
    } else if (handle.length === 2) {
      const widthDrivenHeight = width / aspect;
      const heightDrivenWidth = height * aspect;
      if (Math.abs(width - start.width) >= Math.abs(height - start.height) * aspect) {
        height = widthDrivenHeight;
      } else {
        width = heightDrivenWidth;
      }
      if (handle.includes("w")) left = start.left + start.width - width;
      if (handle.includes("n")) top = start.top + start.height - height;
    }
  }

  const keepRatio = event.shiftKey || object.shape === "circle";
  if (!object.fixedAspect && keepRatio && handle.length === 2) {
    const ratio = start.width / Math.max(1, start.height);
    if (Math.abs(dx) > Math.abs(dy)) height = width / ratio;
    else width = height * ratio;
    if (handle.includes("w")) left = start.left + start.width - width;
    if (handle.includes("n")) top = start.top + start.height - height;
  }

  const minSize = 12;
  if (width < minSize) {
    if (handle.includes("w")) left = start.left + start.width - minSize;
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes("n")) top = start.top + start.height - minSize;
    height = minSize;
  }
  if (object.fixedAspect) {
    const aspect = Number(object.fixedAspect) || 1;
    const ratioWidth = Math.max(width, height * aspect);
    const ratioHeight = ratioWidth / aspect;
    if (ratioWidth !== width) {
      if (handle.includes("w")) left = start.left + start.width - ratioWidth;
      else if (!handle.includes("e")) left = start.left + (start.width - ratioWidth) / 2;
    }
    if (ratioHeight !== height) {
      if (handle.includes("n")) top = start.top + start.height - ratioHeight;
      else if (!handle.includes("s")) top = start.top + (start.height - ratioHeight) / 2;
    }
    width = ratioWidth;
    height = ratioHeight;
  }

  object.el.style.left = `${left}px`;
  object.el.style.top = `${top}px`;
  object.el.style.width = `${width}px`;
  object.el.style.height = `${height}px`;
  if (object.type === "text" && handle.length === 2) {
    const scale = Math.max(width / Math.max(1, start.width), height / Math.max(1, start.height));
    object.el.style.fontSize = `${Math.max(8, drag.fontSize * scale)}px`;
  }
  syncObjectRecord(object);
  syncMiniToolbar();
}

function isDeferredTransformObject(object) {
  return Boolean(object?.type === "raster" && !object.transformDraft && object.sourceBoardRect && object.el?.classList.contains("deferred-transform-object"));
}

function clearDeferredTransformSource(object) {
  if (!object.sourceBoardRect || object.sourceCleared) return;
  const previous = {
    rect: rectCopy(editor.selectionRect),
    shape: editor.selectionShape,
    feather: editor.selectionFeather,
    inverted: editor.selectionInverted,
  };
  editor.selectionRect = rectCopy(object.sourceBoardRect);
  editor.selectionShape = object.sourceShape || "rect";
  editor.selectionFeather = Number(object.sourceFeather || 0);
  editor.selectionInverted = false;
  deleteSelectionPixels({ blur: false });
  editor.selectionRect = previous.rect;
  editor.selectionShape = previous.shape;
  editor.selectionFeather = previous.feather;
  editor.selectionInverted = previous.inverted;
  if (editor.selectionRect) showSelectionOverlay(editor.selectionRect);
  else hideSelectionOverlay();
  object.sourceCleared = true;
  object.el.classList.remove("deferred-transform-object");
}

function deferredTransformObject() {
  return objects.find((candidate) => candidate.type === "raster" && !candidate.transformDraft && candidate.sourceBoardRect && candidate.el.classList.contains("deferred-transform-object")) || null;
}

function cancelDeferredTransformSelection(options = {}) {
  const object = deferredTransformObject();
  if (!object) {
    clearSelection();
    setActiveObject("");
    pixelClipboard = null;
    return false;
  }
  removeObject(object);
  pixelClipboard = null;
  clearSelection();
  setActiveObject("");
  if (options.record) pushHistory({ force: true });
  return true;
}

function commitDeferredTransformObject(object = deferredTransformObject()) {
  if (!isDeferredTransformObject(object)) return false;
  filterBaselineCanvas = null;
  pixelClipboard = null;
  clearSelection();
  object.el.classList.remove("deferred-transform-object");
  object.transformDraft = false;
  object.transient = false;
  syncObjectRecord(object);
  setActiveObject(object.id);
  pushHistory({ force: true });
  setStatus("Applied.");
  return true;
}

function rotateObject(object, event) {
  const point = boardPoint(event, { clamp: false });
  const angle = Math.atan2(point.y - objectDrag.center.y, point.x - objectDrag.center.x) * 180 / Math.PI;
  object.rotation = objectDrag.metrics.rotation + angle - objectDrag.startPointerAngle;
  updateObjectTransform(object);
  syncObjectRecord(object);
  syncMiniToolbar();
}

function moveObject(object, event) {
  const point = boardPoint(event, { clamp: false });
  const startPoint = objectDrag.startPoint || point;
  const left = objectDrag.metrics.left + point.x - startPoint.x;
  const top = objectDrag.metrics.top + point.y - startPoint.y;
  object.el.style.left = `${left}px`;
  object.el.style.top = `${top}px`;
  syncObjectRecord(object);
  syncMiniToolbar();
}

function transformActiveObject(action) {
  const object = objects.find((candidate) => candidate.id === selectedObjectId);
  if (!object) return false;
  const metrics = objectMetrics(object);
  if (action === "flipX") object.flipX = (object.flipX || 1) * -1;
  else if (action === "flipY") object.flipY = (object.flipY || 1) * -1;
  else if (action === "rotateLeft") object.rotation = Number(object.rotation || 0) - 90;
  else if (action === "rotateRight") object.rotation = Number(object.rotation || 0) + 90;
  else return false;
  object.el.style.left = `${metrics.left}px`;
  object.el.style.top = `${metrics.top}px`;
  object.el.style.width = `${metrics.width}px`;
  object.el.style.height = `${metrics.height}px`;
  updateObjectTransform(object);
  syncObjectRecord(object);
  syncMiniToolbar();
  pushHistory({ force: true });
  return true;
}

function applyTransformControl(action, viewFallback) {
  if (transformActiveObject(action)) return true;
  if (currentTool === "transform" && editor.selectionRect && makeTransformObjectFromSelection()) {
    return transformActiveObject(action);
  }
  if (viewFallback) setView(viewFallback(), { record: true });
  return false;
}

function updateActiveObjectStyle() {
  const object = objects.find((candidate) => candidate.id === selectedObjectId);
  if (!object) return;
  if (object.type === "text") {
    object.fillColor = editor.textFill;
    object.strokeColor = editor.textStrokeColor;
    object.opacity = editor.textOpacity;
    object.fillOpacity = editor.textFillOpacity;
    object.strokeOpacity = editor.textStrokeOpacity;
    object.fontFamily = editor.textFont || "";
    object.el.style.fontFamily = object.fontFamily ? `"${object.fontFamily}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK;
    object.el.style.fontSize = `${editor.textSize}px`;
    object.el.style.opacity = String(opacityControlToAlpha(object.opacity ?? DEFAULT_OPACITY_VALUE));
    object.el.style.fontWeight = editor.textBold ? "900" : "700";
    object.el.style.fontStyle = editor.textItalic ? "italic" : "normal";
    object.el.style.textDecoration = editor.textUnderline ? "underline" : "none";
    object.textAlign = editor.textAlign;
    applyTextAlignment(object);
  }
  if (object.type === "icon") {
    object.fillColor = editor.iconFill;
    object.strokeColor = editor.iconStrokeColor;
    object.opacity = editor.iconOpacity;
    object.fillOpacity = editor.iconFillOpacity;
    object.strokeOpacity = editor.iconStrokeOpacity;
    object.el.style.opacity = String(opacityControlToAlpha(object.opacity ?? DEFAULT_OPACITY_VALUE));
  }
  if (object.type === "shape") {
    object.fillColor = editor.shapeFill;
    object.strokeColor = editor.shapeStrokeColor;
    object.opacity = editor.shapeOpacity;
    object.fillOpacity = editor.shapeFillOpacity;
    object.strokeOpacity = editor.shapeStrokeOpacity;
    object.el.style.borderWidth = `${editor.shapeStroke}px`;
    object.el.style.opacity = String(opacityControlToAlpha(object.opacity ?? DEFAULT_OPACITY_VALUE));
    object.strokeWidth = editor.shapeStroke;
    object.feather = object.shape === "circle" ? 0 : editor.shapeFeather;
    if (object.shape === "rect") object.el.style.borderRadius = `${editor.shapeFeather}px`;
    if (object.shape === "circle") object.el.style.borderRadius = "50%";
  }
  applyObjectColors(object);
  pushHistory();
}

function textPreviewFontSize(rect, text = "Double Click") {
  const contentLength = Math.max(1, String(text || "Text").trim().length);
  const availableWidth = Math.max(1, Number(rect.width || 1) - 16);
  const heightSize = Number(rect.height || 1) * 0.55;
  const widthSize = availableWidth / (contentLength * TEXT_PREVIEW_WIDTH_FACTOR);
  return Math.max(8, Math.min(160, heightSize, widthSize));
}

function updateObjectFrame(object, rect) {
  const frame = {
    x: rect.x,
    y: rect.y,
    width: Math.max(4, rect.width),
    height: Math.max(4, rect.height),
  };
  object.el.style.left = `${frame.x}px`;
  object.el.style.top = `${frame.y}px`;
  object.el.style.width = `${frame.width}px`;
  object.el.style.height = `${frame.height}px`;
  if (object.rect) object.rect = { ...frame };
  if (object.point) object.point = { x: frame.x, y: frame.y };
  if (object.type === "raster") applyTransformFeatherToObject(object, object.sourceFeather ?? editor.selectionFeather);
  if (object.type === "text" && object.previewSizing) {
    object.el.style.fontSize = `${textPreviewFontSize(frame, textObjectContent(object, "Double Click"))}px`;
  }
  syncObjectRecord(object);
  syncMiniToolbar();
  return frame;
}

function addShapeObject(rect, options = {}) {
  if (!objectLayer || rect.width < 4 || rect.height < 4) return null;
  const frame = { ...rect };
  const el = document.createElement("div");
  el.className = "object-item shape-object";
  el.dataset.objectId = "";
  el.style.left = `${frame.x}px`;
  el.style.top = `${frame.y}px`;
  el.style.width = `${frame.width}px`;
  el.style.height = `${frame.height}px`;
  el.style.opacity = String(opacityControlToAlpha(editor.shapeOpacity));
  const fillCss = colorWithOpacity(editor.shapeFill, editor.shapeFillOpacity);
  const strokeCss = colorWithOpacity(editor.shapeStrokeColor, editor.shapeStrokeOpacity);
  el.style.border = `${editor.shapeStroke}px solid ${strokeCss}`;
  el.style.background = editor.shapeFill === "transparent" ? "transparent" : fillCss;
  if (editor.shapeType === "rect") el.style.borderRadius = `${editor.shapeFeather}px`;
  if (editor.shapeType === "circle") el.style.borderRadius = "50%";
  if (editor.shapeType === "triangle") {
    el.style.border = "0";
    el.style.background = "transparent";
    const fill = editor.shapeFill === "transparent" ? "none" : fillCss;
    el.innerHTML = `<svg viewBox="0 0 100 100"><path d="${trianglePath(editor.shapeFeather)}" fill="${fill}" stroke="${strokeCss}" stroke-width="${editor.shapeStroke}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const object = {
    type: "shape",
    shape: editor.shapeType,
    rect: frame,
    el,
    fillColor: editor.shapeFill,
    strokeColor: editor.shapeStrokeColor,
    opacity: editor.shapeOpacity,
    fillOpacity: editor.shapeFillOpacity,
    strokeOpacity: editor.shapeStrokeOpacity,
    strokeWidth: editor.shapeStroke,
    feather: editor.shapeType === "circle" ? 0 : editor.shapeFeather,
    transient: Boolean(options.transient),
  };
  addObject(object, options);
  el.dataset.objectId = object.id;
  return object;
}

function addTextObject(point = null, options = {}) {
  if (!objectLayer) return null;
  const rect = options.rect ? { ...options.rect } : null;
  const el = document.createElement("div");
  const content = document.createElement("div");
  el.className = "object-item text-object";
  content.className = "text-content";
  content.textContent = "Double Click";
  el.appendChild(content);
  el.dataset.objectId = "";
  el.style.left = `${rect ? rect.x : point.x}px`;
  el.style.top = `${rect ? rect.y : point.y}px`;
  if (rect) {
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }
  el.style.fontSize = `${rect ? textPreviewFontSize(rect, content.textContent) : editor.textSize}px`;
  el.style.fontFamily = editor.textFont ? `"${editor.textFont}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK;
  el.style.opacity = String(opacityControlToAlpha(editor.textOpacity));
  el.style.fontWeight = editor.textBold ? "900" : "700";
  el.style.fontStyle = editor.textItalic ? "italic" : "normal";
  el.style.textDecoration = editor.textUnderline ? "underline" : "none";
  const object = {
    type: "text",
    text: content.textContent,
    point: rect ? { x: rect.x, y: rect.y } : point,
    el,
    fillColor: editor.textFill,
    strokeColor: editor.textStrokeColor,
    opacity: editor.textOpacity,
    fillOpacity: editor.textFillOpacity,
    strokeOpacity: editor.textStrokeOpacity,
    fontFamily: editor.textFont || "",
    textAlign: editor.textAlign || "center",
    previewSizing: Boolean(rect),
    transient: Boolean(options.transient),
  };
  applyTextAlignment(object);
  addObject(object, options);
  el.dataset.objectId = object.id;
  return object;
}

function addIconObject(point = null, options = {}) {
  if (!objectLayer) return null;
  const rect = options.rect
    ? { ...options.rect }
    : {
      x: point?.x ?? (paintCanvas?.width || 1) / 2 - 24,
      y: point?.y ?? (paintCanvas?.height || 1) / 2 - 24,
      width: 48,
      height: 48,
    };
  if (rect.width < 4 || rect.height < 4) return null;
  const el = document.createElement("div");
  const name = editor.iconName;
  el.className = "object-item icon-object";
  el.dataset.objectId = "";
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.opacity = String(opacityControlToAlpha(editor.iconOpacity));
  el.innerHTML = iconMarkup(name);
  const object = {
    type: "icon",
    name,
    point: { x: rect.x, y: rect.y },
    el,
    fillColor: editor.iconFill,
    strokeColor: editor.iconStrokeColor,
    opacity: editor.iconOpacity,
    fillOpacity: editor.iconFillOpacity,
    strokeOpacity: editor.iconStrokeOpacity,
    transient: Boolean(options.transient),
  };
  addObject(object, options);
  el.dataset.objectId = object.id;
  return object;
}

function iconMarkup(name) {
  if (spriteOnlyIconNames.has(name)) {
    const spriteId = iconSpriteIds[name] || iconSpriteIds.arrow;
    return `<svg viewBox="0 0 32 32" fill="none" stroke="var(--object-stroke, currentColor)"><use href="#${spriteId}" fill="none" stroke="var(--object-stroke, currentColor)"></use></svg>`;
  }
  if (iconPaths[name]) {
    return `<svg viewBox="0 0 24 24"><path d="${iconPaths[name]}" fill="var(--object-fill, currentColor)" stroke="var(--object-stroke, currentColor)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (fillableIconPaths[name]) {
    const icon = fillableIconPaths[name];
    return `<svg viewBox="${icon.viewBox}"><path d="${icon.path}" fill="var(--object-fill, currentColor)" stroke="var(--object-stroke, currentColor)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  const spriteId = iconSpriteIds[name] || iconSpriteIds.arrow;
  return `<svg viewBox="0 0 32 32" fill="none" stroke="var(--object-stroke, currentColor)"><use href="#${spriteId}" fill="none" stroke="var(--object-stroke, currentColor)"></use></svg>`;
}

function parseIconViewBox(value, fallback = 24) {
  const parts = String(value || "").trim().split(/\s+/).map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }
  return { x: 0, y: 0, width: fallback, height: fallback };
}

function canvasIconDefinition(name) {
  if (iconPaths[name]) {
    return {
      viewBox: "0 0 24 24",
      paths: [{ d: iconPaths[name], fill: true, stroke: true, strokeWidth: 1.7, lineCap: "round", lineJoin: "round" }],
    };
  }
  if (fillableIconPaths[name]) {
    const icon = fillableIconPaths[name];
    return {
      viewBox: icon.viewBox,
      paths: [{ d: icon.path, fill: true, stroke: true, strokeWidth: 4, lineCap: "round", lineJoin: "round" }],
    };
  }
  return spriteIconCanvasPaths[name] || spriteIconCanvasPaths.arrow;
}

function drawIconShapeToCanvas(ctx, shape) {
  if (shape.d) {
    const path = new Path2D(shape.d);
    if (shape.fill) ctx.fill(path);
    if (shape.stroke) ctx.stroke(path);
    return;
  }
  if (shape.r) {
    ctx.beginPath();
    ctx.ellipse(shape.cx, shape.cy, shape.r, shape.r, 0, 0, Math.PI * 2);
    if (shape.fill) ctx.fill();
    if (shape.stroke) ctx.stroke();
  }
}

function drawIconToCanvas(ctx, object, width, height, fillStyle, strokeStyle) {
  if (typeof Path2D === "undefined") return false;
  const definition = canvasIconDefinition(object.name);
  if (!definition) return false;
  const viewBox = parseIconViewBox(definition.viewBox, 32);
  const scale = Math.min(width / viewBox.width, height / viewBox.height);
  const drawWidth = viewBox.width * scale;
  const drawHeight = viewBox.height * scale;
  const fillColor = object.fillColor || DEFAULT_ACCENT;
  const strokeColor = object.strokeColor || fillColor;
  ctx.save();
  ctx.translate(-width / 2 + (width - drawWidth) / 2, -height / 2 + (height - drawHeight) / 2);
  ctx.scale(scale, scale);
  ctx.translate(-viewBox.x, -viewBox.y);
  ctx.fillStyle = fillColor === "transparent" ? "rgba(0,0,0,0)" : fillStyle;
  ctx.strokeStyle = strokeColor === "transparent" ? "rgba(0,0,0,0)" : strokeStyle;
  [...(definition.paths || []), ...(definition.circles || [])].forEach((shape) => {
    ctx.lineWidth = Number(shape.strokeWidth || 1);
    ctx.lineCap = shape.lineCap || "butt";
    ctx.lineJoin = shape.lineJoin || "miter";
    drawIconShapeToCanvas(ctx, shape);
  });
  ctx.restore();
  return true;
}

function removeActiveObject() {
  const index = objects.findIndex((candidate) => candidate.id === selectedObjectId);
  if (index < 0) return false;
  objects[index].el.remove();
  objects.splice(index, 1);
  selectedObjectId = "";
  return true;
}

function removeObject(object) {
  if (!object) return false;
  const index = objects.findIndex((candidate) => candidate.id === object.id);
  if (index < 0) return false;
  objects[index].el.remove();
  objects.splice(index, 1);
  if (selectedObjectId === object.id) setActiveObject("");
  syncMiniToolbar();
  return true;
}

function pendingObject(type = "") {
  return objects.find((object) => object.pendingCommit && (!type || object.type === type)) || null;
}

function cancelPendingObject(type = "") {
  return removeObject(pendingObject(type));
}

function preparePendingObject(object) {
  if (!object || (object.type !== "shape" && object.type !== "text" && object.type !== "icon")) return;
  object.pendingCommit = true;
  object.transient = true;
  object.el.classList.add("pending-object");
  if (object.type === "text") {
    const content = textContentElement(object);
    content.contentEditable = "false";
    object.el.spellcheck = false;
    if (!content.textContent.trim()) content.textContent = "Text";
  }
}

function commitPendingObject(object, options = {}) {
  if (!object || !object.pendingCommit || (object.type !== "shape" && object.type !== "text" && object.type !== "icon")) return false;
  if (object.type === "text") {
    const content = textContentElement(object);
    content.contentEditable = "false";
    object.text = textObjectContent(object);
    content.textContent = object.text;
    applyTextAlignment(object);
    ensureObjectControls(object);
  }
  filterBaselineCanvas = null;
  object.pendingCommit = false;
  object.transient = false;
  object.previewSizing = false;
  object.el.classList.remove("pending-object");
  syncObjectRecord(object);
  applyObjectColors(object);
  setActiveObject(options.keepActive ? object.id : "");
  pushHistory({ force: true });
  setStatus("Applied.");
  return true;
}

function copyActiveObject(cut = false) {
  const object = objects.find((candidate) => candidate.id === selectedObjectId);
  if (!object || object.transient) return;
  clipboardObject = {
    type: object.type,
    shape: object.shape,
    name: object.name,
    text: object.text,
    textAlign: object.textAlign,
    fontFamily: object.fontFamily,
    rotation: object.rotation || 0,
    flipX: object.flipX || 1,
    flipY: object.flipY || 1,
    fillColor: object.fillColor,
    strokeColor: object.strokeColor,
    opacity: object.opacity,
    fillOpacity: object.fillOpacity,
    strokeOpacity: object.strokeOpacity,
    strokeWidth: object.strokeWidth,
    feather: object.feather,
    rect: object.rect ? { ...object.rect } : null,
    point: object.point ? { ...object.point } : null,
    html: objectContentHTML(object),
    className: object.el.className,
    style: object.el.getAttribute("style") || "",
  };
  if (cut && removeActiveObject()) pushHistory({ force: true });
}

function pasteObject() {
  if (!clipboardObject) return;
  const el = document.createElement("div");
  el.className = clipboardObject.className;
  el.innerHTML = clipboardObject.html;
  el.setAttribute("style", clipboardObject.style);
  el.dataset.objectId = "";
  const left = parseFloat(el.style.left || "0") + 12;
  const top = parseFloat(el.style.top || "0") + 12;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const object = {
    ...clipboardObject,
    id: "",
    el,
    rect: clipboardObject.rect ? { ...clipboardObject.rect, x: left, y: top } : null,
    point: clipboardObject.point ? { x: left, y: top } : null,
    rotation: clipboardObject.rotation || 0,
    flipX: clipboardObject.flipX || 1,
    flipY: clipboardObject.flipY || 1,
    fillColor: clipboardObject.fillColor,
    strokeColor: clipboardObject.strokeColor,
    opacity: clipboardObject.opacity,
    fillOpacity: clipboardObject.fillOpacity,
    strokeOpacity: clipboardObject.strokeOpacity,
  };
  addObject(object);
  el.dataset.objectId = object.id;
}

function copySelectionPixels(cut = false, options = {}) {
  const rect = selectedBaseRect();
  if (!rect) return false;
  const sx = Math.round(rect.x);
  const sy = Math.round(rect.y);
  const sw = Math.max(1, Math.round(rect.width));
  const sh = Math.max(1, Math.round(rect.height));
  const clip = document.createElement("canvas");
  clip.width = sw;
  clip.height = sh;
  const ctx = clip.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(baseCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  if (editor.selectionShape === "ellipse") {
    const mask = document.createElement("canvas");
    mask.width = sw;
    mask.height = sh;
    const maskCtx = mask.getContext("2d");
    if (maskCtx) {
      maskCtx.fillStyle = "#fff";
      maskCtx.beginPath();
      maskCtx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
      maskCtx.fill();
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(mask, 0, 0);
    }
  } else if (editor.selectionFeather > 0 && options.feather !== false) {
    const mask = document.createElement("canvas");
    mask.width = sw;
    mask.height = sh;
    const maskCtx = mask.getContext("2d");
    if (maskCtx) {
      const radius = Math.min(sw / 2, sh / 2, editor.selectionFeather / (paintCanvas?.width || 1) * (baseCanvas.width || 1));
      maskCtx.fillStyle = "#fff";
      maskCtx.beginPath();
      roundedRectPath(maskCtx, 0, 0, sw, sh, radius);
      maskCtx.fill();
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(mask, 0, 0);
    }
  }
  pixelClipboard = { dataUrl: clip.toDataURL("image/png"), width: sw, height: sh };
  if (cut) deleteSelectionPixels(options.deleteOptions || {});
  return true;
}

function deleteSelectionPixels(options = {}) {
  const mask = createSelectionMask(false, options);
  if (!mask || !basePaint) return false;
  filterBaselineCanvas = null;
  basePaint.save();
  basePaint.globalCompositeOperation = "destination-out";
  basePaint.drawImage(mask, 0, 0);
  basePaint.restore();
  drawVisibleImage();
  return true;
}

function pasteSelectionPixels(offset = 12, options = {}) {
  if (!pixelClipboard || !objectLayer) return false;
  const point = editor.selectionRect
    ? { x: editor.selectionRect.x, y: editor.selectionRect.y }
    : { x: (paintCanvas?.width || 1) / 2 - 40, y: (paintCanvas?.height || 1) / 2 - 40 };
  const displayRect = options.displayRect || null;
  const el = document.createElement("div");
  const img = document.createElement("img");
  el.className = "object-item raster-object";
  img.src = pixelClipboard.dataUrl;
  el.style.left = `${displayRect ? displayRect.x : point.x + offset}px`;
  el.style.top = `${displayRect ? displayRect.y : point.y + offset}px`;
  el.style.width = `${displayRect ? displayRect.width : pixelClipboard.width / (baseCanvas.width || 1) * (paintCanvas?.width || 1)}px`;
  el.style.height = `${displayRect ? displayRect.height : pixelClipboard.height / (baseCanvas.height || 1) * (paintCanvas?.height || 1)}px`;
  el.appendChild(img);
  const object = {
    type: "raster",
    el,
    imageEl: img,
    point: {
      x: displayRect ? displayRect.x : point.x + offset,
      y: displayRect ? displayRect.y : point.y + offset,
    },
  };
  addObject(object, options);
  el.dataset.objectId = object.id;
  return object;
}

function addTransformFrameObject(rect, options = {}) {
  if (!objectLayer || rect.width < 3 || rect.height < 3) return null;
  const frame = { ...rect };
  const el = document.createElement("div");
  const img = document.createElement("img");
  el.className = "object-item raster-object deferred-transform-object transform-draft-object";
  img.src = TRANSPARENT_PIXEL_DATA_URL;
  el.style.left = `${frame.x}px`;
  el.style.top = `${frame.y}px`;
  el.style.width = `${frame.width}px`;
  el.style.height = `${frame.height}px`;
  el.appendChild(img);
  const object = {
    type: "raster",
    el,
    imageEl: img,
    point: { x: frame.x, y: frame.y },
    sourceBoardRect: rectCopy(frame),
    sourceShape: editor.selectionShape,
    sourceFeather: editor.selectionFeather,
    sourceCleared: false,
    transformDraft: true,
    transient: Boolean(options.transient),
  };
  addObject(object, options);
  el.dataset.objectId = object.id;
  applyTransformFeatherToObject(object, object.sourceFeather);
  return object;
}

function copySelectionPixelsFromBoardRect(rect, shape = editor.selectionShape, feather = editor.selectionFeather) {
  const previous = {
    rect: rectCopy(editor.selectionRect),
    shape: editor.selectionShape,
    feather: editor.selectionFeather,
    inverted: editor.selectionInverted,
  };
  editor.selectionRect = rectCopy(rect);
  editor.selectionShape = shape;
  editor.selectionFeather = Number(feather || 0);
  editor.selectionInverted = false;
  const copied = copySelectionPixels(false, { feather: true });
  editor.selectionRect = previous.rect;
  editor.selectionShape = previous.shape;
  editor.selectionFeather = previous.feather;
  editor.selectionInverted = previous.inverted;
  return copied;
}

function finalizeTransformFrameObject(object, rect) {
  if (!object || object.type !== "raster") return false;
  const sourceBoardRect = rectCopy(rect);
  const sourceShape = editor.selectionShape;
  const sourceFeather = editor.selectionFeather;
  if (!copySelectionPixelsFromBoardRect(sourceBoardRect, sourceShape, sourceFeather)) {
    removeObject(object);
    pixelClipboard = null;
    return false;
  }
  object.transformDraft = false;
  object.transient = false;
  object.sourceBoardRect = sourceBoardRect;
  object.sourceShape = sourceShape;
  object.sourceFeather = sourceFeather;
  object.sourceCleared = false;
  object.imageEl.src = pixelClipboard.dataUrl;
  object.el.classList.remove("transform-draft-object");
  object.el.classList.add("deferred-transform-object");
  updateObjectFrame(object, sourceBoardRect);
  applyTransformFeatherToObject(object, sourceFeather);
  clearSelection();
  setActiveObject(object.id);
  setStatus("Free Transform ready.");
  return true;
}

function makeTransformObjectFromSelection() {
  const sourceBoardRect = rectCopy(editor.selectionRect);
  const sourceShape = editor.selectionShape;
  const sourceFeather = editor.selectionFeather;
  if (!copySelectionPixels(false, { feather: true })) return false;
  const created = pasteSelectionPixels(0, { record: false, displayRect: sourceBoardRect });
  if (created) {
    created.sourceBoardRect = sourceBoardRect;
    created.sourceShape = sourceShape;
    created.sourceFeather = sourceFeather;
    created.sourceCleared = false;
    applyTransformFeatherToObject(created, sourceFeather);
    created.el.classList.add("deferred-transform-object");
    clearSelection();
    setStatus("Free Transform ready.");
  }
  return created;
}

function undoView() {
  if (undoStack.length <= 1) {
    setStatus("Nothing to undo.");
    return;
  }
  const current = undoStack.pop();
  if (current) redoStack.push(current);
  restoreHistoryState(undoStack[undoStack.length - 1]);
  setStatus("Undo");
}

function redoView() {
  const next = redoStack.pop();
  if (!next) {
    setStatus("Nothing to redo.");
    return;
  }
  undoStack.push(next);
  restoreHistoryState(next);
  setStatus("Redo");
}

function selectedBaseRect() {
  if (!editor.selectionRect) return null;
  const rect = rectBoardToBase(editor.selectionRect);
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

function replaceSelectedRegion(sourceCanvas, options = {}) {
  const mask = createSelectionMask(true, options);
  if (!mask || !basePaint) return;
  basePaint.save();
  basePaint.globalCompositeOperation = "destination-out";
  basePaint.drawImage(mask, 0, 0);
  basePaint.restore();
  drawMaskedCanvas(sourceCanvas, options);
}

function transformSelectedRegion(type) {
  const rect = selectedBaseRect();
  if (!rect || !basePaint) return false;
  filterBaselineCanvas = null;
  const sx = Math.round(rect.x);
  const sy = Math.round(rect.y);
  const sw = Math.max(1, Math.round(rect.width));
  const sh = Math.max(1, Math.round(rect.height));
  const region = document.createElement("canvas");
  region.width = sw;
  region.height = sh;
  const rctx = region.getContext("2d");
  rctx?.drawImage(baseCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const transformed = document.createElement("canvas");
  transformed.width = sw;
  transformed.height = sh;
  const tctx = transformed.getContext("2d");
  if (!tctx) return false;
  tctx.translate(sw / 2, sh / 2);
  if (type === "flipX") tctx.scale(-1, 1);
  if (type === "flipY") tctx.scale(1, -1);
  if (type === "rotateLeft") tctx.rotate(-Math.PI / 2);
  if (type === "rotateRight") tctx.rotate(Math.PI / 2);
  tctx.drawImage(region, -sw / 2, -sh / 2, sw, sh);
  const full = document.createElement("canvas");
  full.width = baseCanvas.width;
  full.height = baseCanvas.height;
  full.getContext("2d")?.drawImage(transformed, sx, sy);
  const previousRect = rectCopy(editor.selectionRect);
  if (paintCanvas?.width && paintCanvas?.height) {
    editor.selectionRect = {
      x: sx / (baseCanvas.width || 1) * paintCanvas.width,
      y: sy / (baseCanvas.height || 1) * paintCanvas.height,
      width: sw / (baseCanvas.width || 1) * paintCanvas.width,
      height: sh / (baseCanvas.height || 1) * paintCanvas.height,
    };
  }
  replaceSelectedRegion(full, { blur: false });
  editor.selectionRect = previousRect;
  if (editor.selectionRect) showSelectionOverlay(editor.selectionRect);
  pushHistory({ force: true });
  return true;
}

function resetView(options = {}) {
  setView({ zoom: 1, panX: 0, panY: 0, rotate: 0, flipX: 1, flipY: 1 }, { record: options.record !== false });
}

function showHistory() {
  setStatus(`History ${Math.max(0, undoStack.length - 1)} undo${redoStack.length ? ` / ${redoStack.length} redo` : ""}`);
}

function deleteCurrentEdit() {
  const activeObject = objects.find((candidate) => candidate.id === selectedObjectId);
  if (activeObject?.transient) {
    removeActiveObject();
    setStatus("Crop selection canceled.");
    return true;
  }
  if (deleteSelectionPixels()) {
    clearSelection();
    pushHistory({ force: true });
    setStatus("Deleted selection.");
    return true;
  }
  if (removeActiveObject()) {
    pushHistory({ force: true });
    setStatus("Deleted object.");
    return true;
  }
  setStatus("Nothing selected.");
  return false;
}

function clearAllEdits() {
  const initial = initialHistoryState || undoStack[0];
  if (!initial) {
    setStatus("Nothing to clear.");
    return;
  }
  const previousTool = currentTool;
  restoreHistoryState(initial);
  resetView({ record: false });
  if (previousTool) setActiveTool(previousTool);
  else initializeEditorTool();
  pushHistory({ force: true });
  setStatus("All edits cleared.");
}

function drawEditorImage(ctx, width, height) {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((viewState.rotate * Math.PI) / 180);
  ctx.scale(viewState.flipX, viewState.flipY);
  ctx.drawImage(baseCanvas, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawObjectToCanvas(ctx, object, scaleX, scaleY) {
  const left = parseFloat(object.el.style.left || "0") * scaleX;
  const top = parseFloat(object.el.style.top || "0") * scaleY;
  const width = parseFloat(object.el.style.width || "48") * scaleX;
  const height = parseFloat(object.el.style.height || "48") * scaleY;
  const fillColor = object.fillColor || DEFAULT_ACCENT;
  const strokeColor = object.strokeColor || fillColor;
  const fillStyle = colorWithOpacity(fillColor, object.fillOpacity ?? DEFAULT_OPACITY_VALUE);
  const strokeStyle = colorWithOpacity(strokeColor, object.strokeOpacity ?? DEFAULT_OPACITY_VALUE);
  ctx.save();
  ctx.globalAlpha = opacityControlToAlpha(object.opacity ?? DEFAULT_OPACITY_VALUE);
  ctx.fillStyle = fillStyle === "transparent" ? "rgba(0,0,0,0)" : fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.translate(left + width / 2, top + height / 2);
  ctx.rotate((Number(object.rotation || 0) * Math.PI) / 180);
  ctx.scale(object.flipX || 1, object.flipY || 1);
  if (object.type === "text") {
    const size = parseFloat(object.el.style.fontSize || editor.textSize) * scaleY;
    const fontFamily = object.fontFamily || object.el.style.fontFamily || DEFAULT_FONT_STACK;
    const lines = textObjectContent(object).split("\n");
    const textAlign = ["left", "center", "right"].includes(object.textAlign) ? object.textAlign : "center";
    const padding = 8 * scaleX;
    const textX = textAlign === "left" ? -width / 2 + padding : textAlign === "right" ? width / 2 - padding : 0;
    const lineHeight = size * 1.12;
    const startY = -((lines.length - 1) * lineHeight) / 2;
    ctx.font = `${object.el.style.fontStyle || "normal"} ${object.el.style.fontWeight || "800"} ${size}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = "middle";
    lines.forEach((line, index) => {
      const y = startY + index * lineHeight;
      if (object.strokeColor) {
        ctx.lineWidth = Math.max(1, scaleX);
        ctx.strokeText(line, textX, y);
      }
      ctx.fillText(line, textX, y);
    });
  } else if (object.type === "shape") {
    const parsedStrokeWidth = parseFloat(object.el.style.borderWidth || `${object.strokeWidth ?? editor.shapeStroke}`);
    const strokeWidth = Number.isFinite(parsedStrokeWidth) ? parsedStrokeWidth : Number(object.strokeWidth ?? editor.shapeStroke) || 0;
    ctx.lineWidth = Math.max(0, strokeWidth * Math.max(scaleX, scaleY));
    const inset = ctx.lineWidth / 2;
    const innerWidth = Math.max(1, width - ctx.lineWidth);
    const innerHeight = Math.max(1, height - ctx.lineWidth);
    const shouldFill = fillColor !== "transparent";
    const shouldStroke = strokeColor !== "transparent" && ctx.lineWidth > 0;
    if (object.shape === "circle") {
      if (shouldFill) {
        ctx.beginPath();
        ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (shouldStroke) {
        ctx.beginPath();
        ctx.ellipse(0, 0, innerWidth / 2, innerHeight / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (object.shape === "triangle") {
      const outerFeather = Math.min(width, height) * Math.min(0.22, Math.max(0, Number(object.feather || 0)) / 100);
      if (shouldFill) {
        ctx.beginPath();
        roundedPolygonCanvasPath(ctx, [
          { x: 0, y: -height / 2 },
          { x: width / 2, y: height / 2 },
          { x: -width / 2, y: height / 2 },
        ], outerFeather);
        ctx.fill();
      }
      if (shouldStroke) {
        const innerFeather = Math.min(innerWidth, innerHeight) * Math.min(0.22, Math.max(0, Number(object.feather || 0)) / 100);
        ctx.beginPath();
        roundedPolygonCanvasPath(ctx, [
          { x: 0, y: -height / 2 + inset },
          { x: width / 2 - inset, y: height / 2 - inset },
          { x: -width / 2 + inset, y: height / 2 - inset },
        ], innerFeather);
        ctx.stroke();
      }
    } else {
      const feather = Math.min(width / 2, height / 2, Math.max(0, Number(object.feather || 0)) * Math.max(scaleX, scaleY));
      if (shouldFill) {
        ctx.beginPath();
        roundedRectPath(ctx, -width / 2, -height / 2, width, height, feather);
        ctx.fill();
      }
      if (shouldStroke) {
        ctx.beginPath();
        roundedRectPath(ctx, -width / 2 + inset, -height / 2 + inset, innerWidth, innerHeight, Math.max(0, feather - inset));
        ctx.stroke();
      }
    }
  } else if (object.type === "icon") {
    drawIconToCanvas(ctx, object, width, height, fillStyle, strokeStyle);
  } else if (object.type === "raster") {
    const source = object.imageEl || object.el.querySelector?.("img") || object.el;
    if (source?.complete) ctx.drawImage(source, -width / 2, -height / 2, width, height);
  }
  ctx.restore();
}

function drawObjectsToCanvas(ctx, scaleX, scaleY) {
  objects.forEach((object) => {
    if (!object.transient) drawObjectToCanvas(ctx, object, scaleX, scaleY);
  });
}

function canvasImageDataURL() {
  if (!baseCanvas.width || !baseCanvas.height) {
    throw new Error("Image is not ready.");
  }
  const output = document.createElement("canvas");
  output.width = baseCanvas.width;
  output.height = baseCanvas.height;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  drawEditorImage(ctx, output.width, output.height);
  if (paintCanvas) ctx.drawImage(paintCanvas, 0, 0, output.width, output.height);
  drawObjectsToCanvas(ctx, output.width / (paintCanvas?.width || output.width), output.height / (paintCanvas?.height || output.height));
  const isJpeg = /\.(jpe?g)(?:$|\?)/i.test(sourceUrl);
  return output.toDataURL(isJpeg ? "image/jpeg" : "image/png", 0.96);
}

function returnToMainApp(savedItemId = "", options = {}) {
  const saveTarget = String(options.saveTarget || "");
  if (savedItemId) {
    sessionStorage.setItem(IMAGE_EDITOR_SAVED_KEY, savedItemId);
    if (saveTarget) sessionStorage.setItem(IMAGE_EDITOR_SAVE_TARGET_KEY, saveTarget);
    else sessionStorage.removeItem(IMAGE_EDITOR_SAVE_TARGET_KEY);
  } else {
    sessionStorage.removeItem(IMAGE_EDITOR_SAVED_KEY);
    sessionStorage.removeItem(IMAGE_EDITOR_SAVE_TARGET_KEY);
  }
  if (window.opener && !window.opener.closed) {
    if (savedItemId) {
      window.opener.postMessage(
        { type: "grok-studio-image-edit-saved", itemId: savedItemId, saveTarget },
        window.location.origin,
      );
    }
    window.close();
    return;
  }
  if (returnPath) {
    window.location.replace(returnPath);
    return;
  }
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = "/";
}

async function saveEdit() {
  if (!itemId || !sourceUrl) {
    setStatus("Cannot save: missing image source.");
    return;
  }
  if (saveButton) saveButton.disabled = true;
  setStatus("Saving...");
  try {
    const data = await api("/api/image-editor/save", {
      method: "POST",
      body: JSON.stringify({
        item_id: itemId,
        source_url: sourceUrl,
        name: imageName,
        image: canvasImageDataURL(),
        provider: editorProvider,
        save_target: editorSaveTarget,
      }),
    });
    const saveTarget = String(data.item?.metadata?.editor_save_target || "");
    setStatus(`Saved ${data.item?.title || ""}`);
    window.setTimeout(() => returnToMainApp(data.item?.id || itemId, { saveTarget }), 450);
  } catch (error) {
    setStatus(error.message || "Save failed.");
    if (saveButton) saveButton.disabled = false;
  }
}

rightTools?.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

rightTools?.addEventListener("wheel", (event) => {
  event.preventDefault();
  event.stopPropagation();
}, { passive: false });

rightTools?.addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "hand") {
    toggleHand();
    return;
  }
  setRightButtonActive(action);
  if (action === "zoom-in") zoomIn();
  if (action === "zoom-out") zoomOut();
  if (action === "history") showHistory();
  if (action === "undo") undoView();
  if (action === "redo") redoView();
  if (action === "reset") resetView();
  if (action === "delete") deleteCurrentEdit();
  if (action === "delete-all") clearAllEdits();
});

toolRail?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (!button) return;
  if (button.dataset.tool === "hand") {
    toggleHand();
    return;
  }
  setActiveTool(button.dataset.tool);
});

fontToggle?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  fontPicker?.classList.toggle("open");
  await loadSystemFonts();
});

fontMenu?.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-font-family]") : null;
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  setTextFont(button.dataset.fontFamily || "");
  fontPicker?.classList.remove("open");
});

document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest(".font-picker")) return;
  fontPicker?.classList.remove("open");
  if (event.target instanceof Element && event.target.closest(".color-popup, .color-dot[data-color-target]")) return;
  closeColorPopup();
});

optionPanel?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  setScopedActive(button);
  if (button.dataset.ratio) {
    editor.cropRatio = button.dataset.ratio;
    showCropOverlay(cropRectForRatio());
  }
  if (button.dataset.cropAction === "apply") applyCrop();
  if (button.dataset.cropAction === "cancel") cancelCropSelection();
  if (button.dataset.selectionShape) {
    setSelectionShape(button.dataset.selectionShape);
  }
  if (button.dataset.selectionAction === "inverse") {
    editor.selectionInverted = !editor.selectionInverted;
    button.classList.toggle("active", editor.selectionInverted);
    showSelectionOverlay(editor.selectionRect);
  }
  if (button.dataset.transform === "flipX") applyTransformControl("flipX", () => ({ ...viewState, flipX: viewState.flipX * -1 }));
  if (button.dataset.transform === "flipY") applyTransformControl("flipY", () => ({ ...viewState, flipY: viewState.flipY * -1 }));
  if (button.dataset.transform === "rotateLeft") applyTransformControl("rotateLeft", () => ({ ...viewState, rotate: viewState.rotate - 90 }));
  if (button.dataset.transform === "rotateRight") applyTransformControl("rotateRight", () => ({ ...viewState, rotate: viewState.rotate + 90 }));
  if (button.dataset.drawMode) editor.drawMode = button.dataset.drawMode;
  if (button.dataset.eraser) editor.eraserSoft = button.dataset.eraser === "soft";
  if (button.dataset.shape) {
    editor.shapeType = button.dataset.shape;
    if (editor.shapeType === "circle") {
      editor.shapeFeather = 0;
      setRangeValue("shapeFeather", 0);
    }
    syncShapeOptionState();
    setActiveTool("shape");
  }
  if (button.dataset.icon) {
    editor.iconName = button.dataset.icon;
    setActiveTool("icon");
    updateColorDots();
  }
  if (button.dataset.textStyle) {
    const key = `text${button.dataset.textStyle[0].toUpperCase()}${button.dataset.textStyle.slice(1)}`;
    editor[key] = button.classList.contains("active");
    updateActiveObjectStyle();
  }
  if (button.dataset.textAlign) {
    editor.textAlign = button.dataset.textAlign;
    updateActiveObjectStyle();
  }
  if (button.closest(".filter-color-row")) {
    filters.blend = button.dataset.filterBlend || button.textContent.trim().toLowerCase();
    filters["color-filter"] = true;
    setFilterCheckbox("color-filter", true);
    syncFilterOptionState();
    applyFilterPreview();
    pushHistory({ force: true });
  }
});

optionPanel?.addEventListener("pointerdown", (event) => {
  const dot = event.target instanceof Element ? event.target.closest(".color-dot[data-color-target]") : null;
  if (!dot || dot.closest(".color-choice.disabled")) return;
  event.preventDefault();
  event.stopPropagation();
  const target = dot.dataset.colorTarget || "";
  const canToggle = Boolean(colorTargetOpacityInfo(target));
  setActiveColorDot(canToggle && activeColorTarget === target ? "" : target);
  closeColorPopup();
});

optionPanel?.addEventListener("dblclick", (event) => {
  const dot = event.target instanceof Element ? event.target.closest(".color-dot[data-color-target]") : null;
  if (!dot || dot.closest(".color-choice.disabled")) return;
  event.preventDefault();
  event.stopPropagation();
  openColorPopup(dot, dot.dataset.colorTarget || "");
});

optionPanel?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type === "checkbox" && target.dataset.filter) {
    filters[target.dataset.filter] = target.checked;
    if (target.checked && target.dataset.filter === "blur" && filters.distance <= 0) {
      filters.distance = 12;
      setRangeValue("distance", 12);
    }
    if (target.checked && target.dataset.filter === "noiseEnabled" && filters.noise <= 0) {
      filters.noise = 20;
      setRangeValue("noise", 20);
    }
    if (target.checked && target.dataset.filter === "pixelate" && filters.pixelateValue <= 1) {
      filters.pixelateValue = 20;
      setRangeValue("pixelate", 20);
    }
    if (target.dataset.filter === "color-filter" && !target.checked) filters.blend = "";
    syncFilterOptionState();
    applyFilterPreview();
    return;
  }
  if (target.closest(".range-inputs")) syncRangeControl(target);
});

optionPanel?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.filter || target.dataset.filterRange) pushHistory({ force: true });
});

optionPanel?.addEventListener("wheel", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest(".range-control");
  const range = control?.querySelector('input[type="range"]');
  if (!range) return;
  event.preventDefault();
  const step = Number(range.step) || 1;
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const direction = event.deltaY < 0 ? 1 : -1;
  range.value = String(Math.min(max, Math.max(min, (Number(range.value) || 0) + direction * step)));
  syncRangeControl(range);
}, { passive: false });

ensureColorDotPickers();
updateColorDots();
renderFontMenu();
loadSystemFonts();
syncFilterOptionState();
optionPanel?.querySelectorAll('input[type="range"]').forEach(syncRangeFill);

document.addEventListener("pointermove", (event) => {
  if (!eyedropperMode) return;
  const color = sampleCanvasColor(event);
  if (color) setPopupColorPreview(color);
  updateEyedropperPreview(event, color);
});

document.addEventListener("pointerdown", (event) => {
  if (!eyedropperMode) return;
  if (event.target instanceof Element && event.target.closest(".color-popup")) return;
  const color = sampleCanvasColor(event);
  event.preventDefault();
  event.stopPropagation();
  if (color) {
    applyPopupColor(color);
    activeColorPopupTool = "current";
    syncColorPopupToolState();
  }
  setEyedropperMode(false);
}, true);

board?.addEventListener("pointerdown", (event) => {
  if (isPanActive()) return;
  const point = boardPoint(event);
  const hadSelection = Boolean(editor.selectionRect);
  const hadActiveObject = Boolean(selectedObjectId);
  if (currentTool === "crop" && cropObject()) {
    cancelCropSelection();
    return;
  }
  if (currentTool === "shape" && pendingObject("shape")) {
    cancelPendingObject("shape");
    return;
  }
  if (currentTool === "text" && pendingObject("text")) {
    cancelPendingObject("text");
    return;
  }
  if (currentTool === "icon" && pendingObject("icon")) {
    cancelPendingObject("icon");
    return;
  }
  if (currentTool === "transform" && deferredTransformObject()) {
    cancelDeferredTransformSelection();
    return;
  }
  setActiveObject("");
  if (currentTool === "draw" || currentTool === "eraser") {
    const paintSnapshot = currentTool === "draw" && editor.drawMode === "line" && paint && paintCanvas
      ? paint.getImageData(0, 0, paintCanvas.width, paintCanvas.height)
      : null;
    gesture = { type: currentTool, start: point, last: point, paintSnapshot };
    board.setPointerCapture?.(event.pointerId);
    return;
  }
  if (currentTool === "selection" || currentTool === "filter" || currentTool === "transform" || currentTool === "crop" || currentTool === "shape" || currentTool === "icon" || currentTool === "text") {
    gesture = { type: currentTool, start: point, last: point, shift: event.shiftKey, hadSelection, hadActiveObject };
    board.setPointerCapture?.(event.pointerId);
  }
});

board?.addEventListener("pointermove", (event) => {
  if (!gesture) return;
  const point = boardPoint(event);
  if (gesture.type === "draw" && editor.drawMode === "free") {
    drawLine(gesture.last, point, "draw");
    gesture.last = point;
    return;
  }
  if (gesture.type === "draw" && editor.drawMode === "line") {
    restorePaintPreview(gesture);
    drawLine(gesture.start, constrainLinePoint(gesture.start, point, event.shiftKey), "draw");
    return;
  }
  if (gesture.type === "eraser") {
    drawLine(gesture.last, point, "erase");
    gesture.last = point;
    return;
  }
  if (gesture.type === "shape" || gesture.type === "icon" || gesture.type === "text") {
    const rect = normalizedRect(gesture.start, point, "rect", event.shiftKey);
    if (objectCreationRectReady(rect)) {
      if (!gesture.previewObject) {
        if (gesture.type === "shape") gesture.previewObject = addShapeObject(rect, { record: false, transient: true });
        else if (gesture.type === "icon") gesture.previewObject = addIconObject(null, { rect, record: false, transient: true });
        else gesture.previewObject = addTextObject(null, { rect, record: false, transient: true });
      } else {
        updateObjectFrame(gesture.previewObject, rect);
      }
    }
    return;
  }
  if (gesture.type === "transform") {
    const rect = normalizedRect(gesture.start, point, editor.selectionShape, event.shiftKey);
    if (rect.width >= 3 && rect.height >= 3) {
      if (!gesture.previewObject) gesture.previewObject = addTransformFrameObject(rect, { record: false, transient: true });
      else updateObjectFrame(gesture.previewObject, rect);
    }
    return;
  }
  const shape = gesture.type === "crop" ? "rect" : editor.selectionShape;
  const rect = gesture.type === "crop"
    ? cropDragRect(gesture.start, point)
    : normalizedRect(gesture.start, point, shape, event.shiftKey);
  if (gesture.type === "crop") showCropOverlay(rect);
  else if (gesture.type === "selection" || gesture.type === "filter") {
    ensureSelectionHandles();
    setOverlayRect(selectionOverlay, rect, shape);
    selectionOverlay?.classList.toggle("filter-object-handles", gesture.type === "filter");
  }
});

board?.addEventListener("pointerup", (event) => {
  if (!gesture) return;
  const point = boardPoint(event);
  let shouldRecord = false;
  if (gesture.type === "draw" && editor.drawMode === "line") {
    restorePaintPreview(gesture);
    drawLine(gesture.start, constrainLinePoint(gesture.start, point, event.shiftKey), "draw");
    shouldRecord = true;
  } else if (gesture.type === "draw" || gesture.type === "eraser") {
    shouldRecord = true;
  }
  if (gesture.type === "shape" || gesture.type === "icon" || gesture.type === "text") {
    const rect = normalizedRect(gesture.start, point, "rect", event.shiftKey);
    if (objectCreationRectReady(rect)) {
      if (gesture.previewObject) updateObjectFrame(gesture.previewObject, rect);
      else if (gesture.type === "shape") gesture.previewObject = addShapeObject(rect, { record: false, transient: true });
      else if (gesture.type === "icon") gesture.previewObject = addIconObject(null, { rect, record: false, transient: true });
      else gesture.previewObject = addTextObject(null, { rect, record: false, transient: true });
      if (gesture.previewObject) gesture.previewObject.previewSizing = false;
      if (gesture.type === "shape" || gesture.type === "text" || gesture.type === "icon") {
        preparePendingObject(gesture.previewObject);
        shouldRecord = false;
      }
    } else if (gesture.previewObject) {
      removeObject(gesture.previewObject);
    }
  }
  if (gesture.type === "crop") {
    const rect = cropDragRect(gesture.start, point);
    if (rect.width >= 3 && rect.height >= 3) showCropOverlay(rect);
  }
  if (gesture.type === "transform") {
    const rect = normalizedRect(gesture.start, point, editor.selectionShape, event.shiftKey);
    if (rect.width >= 3 && rect.height >= 3) {
      if (!gesture.previewObject) gesture.previewObject = addTransformFrameObject(rect, { record: false, transient: true });
      if (gesture.previewObject) finalizeTransformFrameObject(gesture.previewObject, rect);
    } else if (gesture.previewObject) {
      removeObject(gesture.previewObject);
    } else if (gesture.hadActiveObject) {
      setActiveObject("");
      clearSelection();
    }
  }
  if (gesture.type === "selection" || gesture.type === "filter") {
    const rect = normalizedRect(gesture.start, point, editor.selectionShape, event.shiftKey);
    if (rect.width >= 3 && rect.height >= 3) {
      editor.selectionInverted = false;
      showSelectionOverlay(rect);
      if (gesture.type === "filter") applyFilterPreview();
      shouldRecord = true;
    } else if ((gesture.type === "selection" || gesture.type === "filter") && gesture.hadSelection) {
      clearSelection();
      shouldRecord = true;
    }
  }
  gesture = null;
  board.releasePointerCapture?.(event.pointerId);
  if (shouldRecord) pushHistory({ force: true });
});

board?.addEventListener("dblclick", (event) => {
  if (currentTool === "transform" && deferredTransformObject()) {
    event.preventDefault();
    commitDeferredTransformObject();
    return;
  }
  if (currentTool !== "crop" || !cropObject()) return;
  event.preventDefault();
  applyCrop();
});

window.addEventListener("resize", () => {
  window.requestAnimationFrame(layoutCanvasBoard);
});

workspace?.addEventListener("wheel", (event) => {
  if (event.target instanceof Element && event.target.closest(".option-panel, .right-tools, .color-popup")) return;
  if (!event.altKey) return;
  event.preventDefault();
  if (event.deltaY < 0) zoomIn();
  else zoomOut();
}, { passive: false });

workspace?.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Element && event.target.closest(".right-tools, .color-popup")) return;
  if (!isPanActive()) return;
  event.preventDefault();
  beginWorkspacePan(event);
});

workspace?.addEventListener("pointermove", (event) => {
  if (!isDragging || !dragStart) return;
  setView({
    ...viewState,
    panX: dragStart.panX + event.clientX - dragStart.x,
    panY: dragStart.panY + event.clientY - dragStart.y,
  }, { record: false, status: false });
});

workspace?.addEventListener("pointerup", (event) => {
  if (!isDragging) return;
  isDragging = false;
  dragStart = null;
  workspace.classList.remove("dragging");
  workspace.releasePointerCapture?.(event.pointerId);
  pushHistory();
});

workspace?.addEventListener("pointercancel", () => {
  isDragging = false;
  dragStart = null;
  workspace.classList.remove("dragging");
});

document.addEventListener("pointermove", (event) => {
  if (!objectDrag) return;
  const object = objects.find((candidate) => candidate.id === objectDrag.id);
  if (!object) return;
  event.preventDefault();
  if (!objectDrag.moved && Math.hypot(event.clientX - objectDrag.startX, event.clientY - objectDrag.startY) < 3) return;
  objectDrag.moved = true;
  if (objectDrag.mode === "move") moveObject(object, event);
  else if (objectDrag.mode === "rotate") rotateObject(object, event);
  else resizeObject(object, event);
});

document.addEventListener("pointerup", () => {
  if (objectDrag) {
    if (objectDrag.moved) pushHistory();
  }
  objectDrag = null;
});

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  const target = event.target instanceof Element ? event.target : null;
  const isTyping = Boolean(target?.closest("input, textarea, [contenteditable='true']"));
  if (!isTyping && event.code === "Space") {
    event.preventDefault();
    spacePanMode = true;
    workspace?.classList.add("hand-mode");
    return;
  }
  if (mod && (event.key === "+" || event.key === "=")) {
    event.preventDefault();
    zoomIn();
    return;
  }
  if (mod && event.key === "-") {
    event.preventDefault();
    zoomOut();
    return;
  }
  if (mod && event.key === "0") {
    event.preventDefault();
    resetView();
    return;
  }
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey && !event.altKey) redoView();
    else undoView();
  }
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redoView();
  }
  if (mod && event.key.toLowerCase() === "a") {
    event.preventDefault();
    showSelectionOverlay({ x: 0, y: 0, width: paintCanvas?.width || 1, height: paintCanvas?.height || 1 });
  }
  if (mod && event.shiftKey && event.key.toLowerCase() === "i") {
    event.preventDefault();
    if (editor.selectionRect) {
      editor.selectionInverted = !editor.selectionInverted;
      showSelectionOverlay(editor.selectionRect);
    }
  }
  if (mod && event.key.toLowerCase() === "d") {
    event.preventDefault();
    clearSelection();
  }
  if (mod && event.key.toLowerCase() === "t") {
    event.preventDefault();
    setActiveTool("transform");
    if (editor.selectionRect) makeTransformObjectFromSelection();
  }
  if (mod && event.key.toLowerCase() === "c") {
    event.preventDefault();
    if (!copySelectionPixels(false)) copyActiveObject(false);
  }
  if (mod && event.key.toLowerCase() === "x") {
    event.preventDefault();
    if (copySelectionPixels(true)) pushHistory({ force: true });
    else copyActiveObject(true);
  }
  if (mod && event.key.toLowerCase() === "v") {
    event.preventDefault();
    if (!pasteSelectionPixels()) pasteObject();
  }
  if (event.key === "Escape") {
    cancelDeferredTransformSelection();
    cancelCropSelection();
    cancelPendingObject("shape");
    cancelPendingObject("text");
    cancelPendingObject("icon");
    clearSelection();
    setActiveObject("");
  }
  if (event.key === "Enter") {
    if (!isTyping && commitDeferredTransformObject()) {
      event.preventDefault();
      return;
    }
    const object = pendingObject("shape") || pendingObject("icon") || (!isTyping ? pendingObject("text") : null);
    if (object && commitPendingObject(object, { keepActive: object.type === "text" })) {
      event.preventDefault();
      return;
    }
  }
  if (event.key === "Enter" && currentTool === "crop") applyCrop();
  if (!isTyping && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    deleteCurrentEdit();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  spacePanMode = false;
  if (!handMode) workspace?.classList.remove("hand-mode");
});

window.addEventListener("blur", () => {
  spacePanMode = false;
  isDragging = false;
  dragStart = null;
  workspace?.classList.remove("dragging");
  if (!handMode) workspace?.classList.remove("hand-mode");
});

initializeEditorTool();
