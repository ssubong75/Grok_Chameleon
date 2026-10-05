// Prompt card rendering and prompt search helpers

  function promptMatchesSearchQuery(prompt, query) {
    if (!query) return true;
    const haystack = [
      prompt.title,
      prompt.text,
      prompt.file_name,
      prompt.path,
      prompt.updated_at,
    ].filter(Boolean).join("\n").toLowerCase();
    return haystack.includes(query);
  }


  function filterPromptsBySearch(prompts) {
    const query = String(library_state.searchQuery || "").trim().toLowerCase();
    return query ? prompts.filter((prompt) => promptMatchesSearchQuery(prompt, query)) : prompts;
  }

  function promptCardNode(prompt) {
    const article = document.createElement("article");
    article.className = "card prompt_card";
    article.tabIndex = 0;

    const head = document.createElement("div");
    head.className = "prompt_card_head";
    const title = document.createElement("strong");
    title.className = "card_title";
    title.textContent = prompt.title;
    title.title = prompt.title || "Prompt";
    head.append(title);

    const open = document.createElement("button");
    open.className = "prompt_card_open";
    open.type = "button";
    const body = document.createElement("span");
    body.textContent = prompt.text || "Please enter the prompt";
    open.append(body);
    const openEditor = () => openPromptSave(prompt);
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      openEditor();
    });
    article.addEventListener("click", (event) => {
      if (event.target.closest(".prompt_card_actions")) return;
      openEditor();
    });
    article.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("button")) return;
      event.preventDefault();
      openEditor();
    });

    const actions = document.createElement("div");
    actions.className = "prompt_card_actions";
    const copy = document.createElement("button");
    copy.className = "prompt_copy_btn";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(prompt.text || "");
    });
    const remove = document.createElement("button");
    remove.className = "prompt_delete_btn";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      deletePrompt(prompt.file_name);
    });
    actions.append(copy, remove);

    article.append(head, open, actions);
    return article;
  }


  function renderPromptCards() {
    const list = document.querySelector(".prompt_card_list");
    const count = document.querySelector(".prompt_count");
    const prompts = filterPromptsBySearch(library_state.prompts);
    if (count) count.textContent = `${prompts.length} items`;
    if (!list) return;
    if (!prompts.length) {
      const emptyText = library_state.searchQuery ? "No matching prompt." : "No prompt yet.";
      list.replaceChildren(emptyLibraryNode(emptyText));
      return;
    }
    list.replaceChildren(...prompts.map(promptCardNode));
  }
