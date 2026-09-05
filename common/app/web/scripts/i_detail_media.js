// Imagine detail media keeps official media URLs as data, rendering through the local proxy.
function iDetailItemMetadata(item) {
  return item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
}

function iDetailImagineMetadata(item) {
  const metadata = iDetailItemMetadata(item);
  return metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
}

function iDetailUnwrappedRemoteUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, window.location.origin);
    if (url.pathname === "/api/imagine/remote/media") {
      return url.searchParams.get("url") || text;
    }
  } catch {
    return text;
  }
  return text;
}

function iDetailRawMediaUrl(item) {
  const metadata = iDetailItemMetadata(item);
  const imagine = iDetailImagineMetadata(item);
  const type = detailItemType(item);
  const candidates = [
    type === "video" ? metadata.hd1080_media_url : "",
    type === "video" ? metadata.hdMediaUrl : "",
    type === "video" ? metadata.hd_media_url : "",
    type === "video" ? imagine.hd1080_media_url : "",
    type === "video" ? imagine.hdMediaUrl : "",
    type === "video" ? imagine.hd_media_url : "",
    item?.object_url,
    item?.url,
    item?.media_url,
    item?.mediaUrl,
    item?.remote_url,
    item?.source_url,
    metadata.remote_url,
    metadata.media_url,
    metadata.imagine_asset_url,
    metadata.imagine_video_asset_url,
    type === "video" ? metadata.imagine_video_media_url : metadata.imagine_media_url,
    imagine.media_url,
    imagine.asset_url,
  ];
  for (const candidate of candidates) {
    const text = iDetailUnwrappedRemoteUrl(candidate);
    if (text) return text;
  }
  return "";
}

function iDetailAccountId(item, post) {
  const metadata = iDetailItemMetadata(item);
  const imagine = iDetailImagineMetadata(item);
  return String(
    item?.account_id
    || metadata.account_id
    || imagine.account_id
    || post?.account_id
    || ""
  ).trim();
}

function iDetailProxyUrl(rawUrl, kind = "", accountId = "") {
  const value = String(rawUrl || "").trim();
  if (!value || /^(?:data|blob):/i.test(value)) return value;
  try {
    const url = new URL(value, window.location.origin);
    if (url.pathname === "/api/imagine/remote/media") {
      if (kind && !url.searchParams.get("kind")) url.searchParams.set("kind", kind);
      if (accountId && !url.searchParams.get("account_id")) url.searchParams.set("account_id", accountId);
      return `${url.pathname}${url.search}`;
    }
    if (url.origin === window.location.origin) return value;
    if (!/^https?:$/i.test(url.protocol)) return value;
    const params = new URLSearchParams({ url: url.toString() });
    if (kind) params.set("kind", kind);
    if (accountId) params.set("account_id", accountId);
    return `/api/imagine/remote/media?${params.toString()}`;
  } catch {
    return value;
  }
}

function iDetailMediaUrl(item, post = null) {
  return iDetailProxyUrl(iDetailRawMediaUrl(item), detailItemType(item), iDetailAccountId(item, post));
}

function iDetailPreviewUrl(item, post = null) {
  const metadata = iDetailItemMetadata(item);
  const type = detailItemType(item);
  const preview = String(
    item?.thumbnail_url
    || item?.poster_url
    || metadata.thumbnail_url
    || metadata.poster_url
    || metadata.primary_poster_url
    || ""
  ).trim();
  if (preview) return iDetailProxyUrl(preview, "image", iDetailAccountId(item, post));
  return type === "image" ? iDetailMediaUrl(item, post) : "";
}

function iDetailVideoPreviewUrl(item, post = null) {
  return detailItemType(item) === "video" ? iDetailMediaUrl(item, post) : "";
}
