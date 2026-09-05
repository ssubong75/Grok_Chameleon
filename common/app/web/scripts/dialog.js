// Shared modal dialogs
let galleryActionOverlay = null;

function closeGalleryActionDialog() {
  galleryActionOverlay?.remove();
  galleryActionOverlay = null;
}

function openGalleryActionDialog({
  title,
  message = "",
  value = null,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  accentTitle = false,
  messageBox = false,
}) {
  closeGalleryActionDialog();
  return new Promise((resolve) => {
    const confirmClass = String(confirmLabel || "save").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    const overlay = document.createElement("div");
    overlay.className = "gallery-action-overlay";
    overlay.innerHTML = `
      <section class="gallery-action-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" tabindex="-1">
        <h3${accentTitle ? ' class="gallery-action-title-accent"' : ""}>${escapeHtml(title)}</h3>
        ${message ? `<p${messageBox ? ' class="gallery-action-message-box"' : ""}>${escapeHtml(message)}</p>` : ""}
        ${value === null ? "" : `<input class="gallery-action-input" type="text" value="${escapeHtml(value)}" autocomplete="off" spellcheck="false" />`}
        <div class="gallery-action-buttons">
          <button class="gallery-action-cancel" type="button">${escapeHtml(cancelLabel)}</button>
          <button class="gallery-action-confirm gallery-action-${escapeHtml(confirmClass)}" type="button">${escapeHtml(confirmLabel)}</button>
        </div>
      </section>
    `;
    document.body.append(overlay);
    galleryActionOverlay = overlay;
    const input = overlay.querySelector(".gallery-action-input");
    const modal = overlay.querySelector(".gallery-action-modal");
    const confirmButton = overlay.querySelector(".gallery-action-confirm");
    const settle = (result) => {
      closeGalleryActionDialog();
      resolve(result);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) settle(null);
    });
    overlay.querySelector(".gallery-action-cancel")?.addEventListener("click", () => settle(null));
    confirmButton?.addEventListener("click", () => {
      settle(input ? input.value : true);
    });
    modal?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") settle(null);
      if (event.key === "Enter") {
        event.preventDefault();
        settle(input ? input.value : true);
      }
    });
    window.setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      } else {
        confirmButton?.focus({ preventScroll: true });
      }
    }, 0);
  });
}
