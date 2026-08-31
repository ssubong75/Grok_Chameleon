// Prompt main and prompt save dialog events
document.querySelector(".prompt_write_btn")?.addEventListener("click", () => {
  openPromptSave();
});

document.querySelector(".prompt_card_open")?.addEventListener("click", () => {
  openScreen("prompt_main", "prompt_main_btn");
  document.getElementById("composer_input")?.focus();
});

document.getElementById("prompt_save_cancel")?.addEventListener("click", () => {
  closePromptSave();
});

document.getElementById("prompt_save_confirm")?.addEventListener("click", () => {
  savePromptFromDialog();
});

for (const toggle of promptSave?.querySelectorAll(".prompt_language_toggle") || []) {
  toggle.addEventListener("click", () => {
    togglePromptTranslationLanguageMenu(toggle.dataset.promptLanguageSide || "");
  });
}

promptSave?.querySelector(".prompt_language_detect")?.addEventListener("click", () => {
  detectPromptTranslationLanguage();
});

promptSave?.querySelector(".prompt_language_swap")?.addEventListener("click", () => {
  swapPromptTranslationLanguages();
});

promptSave?.querySelector(".prompt_language_search")?.addEventListener("input", () => {
  renderPromptTranslationLanguages();
});

promptSave?.querySelector(".prompt_language_options")?.addEventListener("click", (event) => {
  const option = event.target instanceof Element
    ? event.target.closest(".prompt_language_option")
    : null;
  if (!option) return;
  selectPromptTranslationLanguage(option.dataset.languageCode || "");
});

const promptOriginalInput = promptSave?.querySelector(".prompt_save_original");

// Chromium and WebKit disagree on whether compositionend precedes the final input
// event, so both paths schedule. The debounce timer is reset on every schedule, and
// the language-pair key suppresses the duplicate, so ordering does not matter here.
promptOriginalInput?.addEventListener("compositionstart", () => {
  promptTranslationState.composing = true;
  cancelPromptTranslationWork();
});

promptOriginalInput?.addEventListener("compositionend", () => {
  promptTranslationState.composing = false;
  schedulePromptTranslation({ immediate: false, clear: false });
});

promptOriginalInput?.addEventListener("input", (event) => {
  if (event.isComposing || promptTranslationState.composing) return;
  // The previous translation stays put until the new one lands. Blanking it on every
  // keystroke made the box flicker and lost a good answer the moment typing resumed.
  schedulePromptTranslation({ immediate: false, clear: false });
});

window.addEventListener("resize", () => {
  if (promptTranslationState.openSide) positionPromptTranslationLanguageMenu();
});

document.addEventListener("pointerdown", (event) => {
  if (!promptTranslationState.openSide) return;
  if (event.target instanceof Element && event.target.closest(".prompt_translate_controls")) return;
  closePromptTranslationLanguageMenu();
});

let promptBackdropPointer = null;

promptSave?.addEventListener("pointerdown", (event) => {
  promptBackdropPointer = event.target === promptSave
    ? { id: event.pointerId, x: event.clientX, y: event.clientY }
    : null;
});

promptSave?.addEventListener("pointerup", (event) => {
  const pointer = promptBackdropPointer;
  promptBackdropPointer = null;
  if (!pointer || pointer.id !== event.pointerId || event.target !== promptSave) return;
  if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) return;
  closePromptSave();
});

promptSave?.addEventListener("pointercancel", () => {
  promptBackdropPointer = null;
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !promptSave || promptSave.hidden) return;
  if (closePromptTranslationLanguageMenu()) {
    event.preventDefault();
    return;
  }
  closePromptSave();
});
