// Build detail media stays on local/library URLs.
function bLocalMediaUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return "";
  if (text.startsWith("/api/imagine/remote/media")) return "";
  return text;
}

function bDetailMediaUrl(item) {
  return bLocalMediaUrl(item?.object_url)
    || bLocalMediaUrl(item?.local_url)
    || bLocalMediaUrl(item?.url)
    || bLocalMediaUrl(item?.media_url)
    || bLocalMediaUrl(item?.mediaUrl);
}

function bDetailPreviewUrl(item) {
  const type = detailItemType(item);
  return bLocalMediaUrl(item?.thumbnail_url)
    || bLocalMediaUrl(item?.poster_url)
    || (type === "image" ? bDetailMediaUrl(item) : "");
}

function bDetailVideoPreviewUrl(item) {
  return detailItemType(item) === "video" ? bDetailMediaUrl(item) : "";
}

function bLocalMediaItem(item) {
  if (!item) return item;
  const mediaUrl = bDetailMediaUrl(item);
  const previewUrl = bDetailPreviewUrl(item);
  return {
    ...item,
    object_url: mediaUrl,
    local_url: mediaUrl || bLocalMediaUrl(item.local_url),
    url: bLocalMediaUrl(item.url),
    media_url: "",
    mediaUrl: "",
    remote_url: "",
    thumbnail_url: previewUrl,
    poster_url: bLocalMediaUrl(item.poster_url),
  };
}
