// Shared source list filtering
function postMatchesSearchQuery(post, query) {
  if (!query) return true;
  const itemText = (post.items || []).flatMap((item) => [
    item.title,
    item.prompt,
    item.file,
    item.url,
    item.model,
    item.role,
    item.created_at,
  ]);
  const haystack = [
    post.title,
    post.prompt,
    post.original_prompt,
    post.model,
    post.area,
    post.source,
    post.created_at,
    post.folder_path,
    ...itemText,
  ].filter(Boolean).join("\n").toLowerCase();
  return haystack.includes(query);
}

function filterPostsBySearch(posts) {
  const query = String(library_state.searchQuery || "").trim().toLowerCase();
  return query ? posts.filter((post) => postMatchesSearchQuery(post, query)) : posts;
}
