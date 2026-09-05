// Composer submit dispatcher
async function submitComposer() {
  if (composerState.provider === "build") {
    await submitBuildComposer();
    return;
  }
  if (composerState.provider === "imagine") {
    await submitImagineComposer();
    return;
  }
  showErrorPanel("Submit unavailable", "Select Build or Imagine first.");
}
