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

promptSave?.querySelector(".prompt_save_translate")?.addEventListener("click", () => {
  translatePromptSave();
});

promptSave?.querySelector(".prompt_save_original")?.addEventListener("input", (event) => {
  const translationInput = promptSave.querySelector(".prompt_save_translation");
  const translateButton = promptSave.querySelector(".prompt_save_translate");
  if (translationInput) translationInput.value = "";
  setPromptTranslationDirection(translateButton, promptTranslationDirection(event.target.value), "original");
});

promptSave?.addEventListener("click", (event) => {
  if (event.target === promptSave) closePromptSave();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && promptSave && !promptSave.hidden) closePromptSave();
});
