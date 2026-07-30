// Account normalization and persistence
function normalizeAccountTier(tier) {
  const value = String(tier || "").toLowerCase();
  return accountTiers.includes(value) ? value : "free";
}

function accountId(prefix) {
  const random = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function findEmailInValue(value, depth = 0) {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") {
    const match = value.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    return match ? match[0] : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEmailInValue(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (String(key).toLowerCase().includes("email") && typeof item === "string" && item.includes("@")) return item;
    }
    for (const item of Object.values(value)) {
      const found = findEmailInValue(item, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function authCandidates(raw) {
  const candidates = [];
  if (raw && typeof raw === "object") {
    if (typeof raw.key === "string") candidates.push(raw);
    for (const value of Object.values(raw)) {
      if (value && typeof value === "object" && typeof value.key === "string") candidates.push(value);
    }
  }
  return candidates;
}

function activeStatusFromExpires(expiresAt) {
  if (!expiresAt) return "ok";
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time)) return "unknown";
  return time > Date.now() ? "ok" : "expired";
}

function normalizeAccountStatus(status, expiresAt) {
  const value = String(status || "").trim();
  if (["ok", "expired", "checking", "login_required", "oauth_error", "unknown"].includes(value)) {
    return value;
  }
  return activeStatusFromExpires(expiresAt);
}

function buildAccountFromAuth(raw, sourceName, label = "") {
  const candidates = authCandidates(raw);
  const chosen = candidates[0] || {};
  const email = chosen.email || findEmailInValue(raw) || label || "";
  return {
    id: accountId("build"),
    provider: "build",
    label: label || email || readableName(sourceName || "Build"),
    email,
    tier: "free",
    source_name: sourceName || "",
    registered_at: libraryNow(),
    expires_at: chosen.expires_at || "",
    status: activeStatusFromExpires(chosen.expires_at),
    auth: raw,
  };
}

function normalizeBuildAccount(account) {
  const auth = typeof account?.auth === "function" ? account.auth() : account?.auth;
  return {
    id: String(account?.id || accountId("build")),
    provider: "build",
    label: String(account?.label || account?.email || "Build"),
    email: String(account?.email || findEmailInValue(auth) || ""),
    tier: normalizeAccountTier(account?.tier),
    source_name: String(account?.source_name || ""),
    registered_at: String(account?.registered_at || libraryNow()),
    expires_at: String(account?.expires_at || ""),
    status: normalizeAccountStatus(account?.status, account?.expires_at),
    oauth_error: String(account?.oauth_error || ""),
    oauth_error_at: String(account?.oauth_error_at || ""),
    oauth_error_detail: String(account?.oauth_error_detail || ""),
    auth: auth && typeof auth === "object" ? auth : {},
  };
}

function isDeniedBuildAccount(account) {
  return String(account?.status || "") === "oauth_error";
}

function firstSelectableBuildAccountId(accounts) {
  return String((accounts || []).find((account) => !isDeniedBuildAccount(account))?.id || "");
}

function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== "object") return null;
  const name = String(cookie.name || "");
  const value = String(cookie.value || "");
  const domain = String(cookie.domain || "");
  if (!name || !value || !domain.includes("grok.com")) return null;
  return {
    name,
    value,
    domain,
    path: String(cookie.path || "/"),
    expires: cookie.expires ?? null,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || "",
  };
}

function cookiesFromSessionRaw(raw) {
  const candidates = [
    raw?.cookies,
    raw?.imagine?.cookies,
    raw?.session?.cookies,
    raw?.data?.cookies,
    Array.isArray(raw) ? raw : null,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    const cookies = list.map(normalizeCookie).filter(Boolean);
    if (cookies.length) return cookies;
  }
  return [];
}

function validImagineCookies(account) {
  const now = Date.now() / 1000;
  return (account?.cookies || []).filter((cookie) => {
    const expires = Number(cookie.expires);
    return cookie?.name && cookie?.value && (!Number.isFinite(expires) || expires <= 0 || expires > now);
  });
}

function imagineAccountFromSession(raw, sourceUrl = "") {
  const cookies = cookiesFromSessionRaw(raw);
  const email = raw?.email || raw?.label || findEmailInValue(raw) || "";
  return {
    id: String(raw?.id || accountId("imagine")),
    provider: "imagine",
    label: String(raw?.label || email || "Imagine"),
    email: String(email || ""),
    tier: normalizeAccountTier(raw?.tier),
    captured_at: String(raw?.captured_at || libraryNow()),
    source_url: String(sourceUrl || raw?.source_url || raw?.url || ""),
    status: cookies.length ? "ok" : "unknown",
    cookies,
    identity_values: Array.isArray(raw?.identity_values) ? raw.identity_values : [],
  };
}

function normalizeImagineAccount(account) {
  const normalized = imagineAccountFromSession(account, account?.source_url || "");
  normalized.id = String(account?.id || normalized.id);
  normalized.tier = normalizeAccountTier(account?.tier);
  normalized.status = validImagineCookies(normalized).length ? "ok" : "expired";
  return normalized;
}

function defaultBuildAuthJson() {
  return {
    version: 1,
    provider: "build",
    active_id: "",
    accounts: [],
  };
}

function defaultImagineAuthJson() {
  return {
    version: 1,
    provider: "imagine",
    active_id: "",
    accounts: [],
  };
}

async function accountDirectoryHandle() {
  if (!library_state.rootHandle) return null;
  return library_state.rootHandle.getDirectoryHandle("account", { create: true });
}

async function readAccountFile(fileName, fallback) {
  const accountHandle = await accountDirectoryHandle();
  if (!accountHandle) return fallback();
  const data = mergeAccountFile(await readJsonFile(accountHandle, fileName), fallback);
  await writeJsonFile(accountHandle, fileName, data);
  return data;
}

function mergeAccountFile(data, fallback) {
  const base = fallback();
  return {
    ...base,
    ...(data && typeof data === "object" ? data : {}),
    accounts: Array.isArray(data?.accounts) ? data.accounts : [],
  };
}

async function writeAccountFile(fileName, data) {
  const accountHandle = await accountDirectoryHandle();
  if (!accountHandle) return;
  await writeJsonFile(accountHandle, fileName, data);
}

async function loadAccountFiles() {
  const build = await readAccountFile("build_auth.json", defaultBuildAuthJson);
  const imagine = await readAccountFile("imagine_auth.json", defaultImagineAuthJson);
  account_state.build = {
    ...defaultBuildAuthJson(),
    ...build,
    accounts: (build.accounts || []).map(normalizeBuildAccount),
  };
  account_state.imagine = {
    ...defaultImagineAuthJson(),
    ...imagine,
    accounts: (imagine.accounts || []).map(normalizeImagineAccount),
  };
  const activeBuild = account_state.build.accounts.find((account) => account.id === account_state.build.active_id);
  if (!activeBuild || isDeniedBuildAccount(activeBuild)) {
    account_state.build.active_id = firstSelectableBuildAccountId(account_state.build.accounts);
  }
  if (account_state.imagine.active_id && !account_state.imagine.accounts.some((account) => account.id === account_state.imagine.active_id)) {
    account_state.imagine.active_id = "";
  }
  if (typeof warmActiveImagineUsage === "function") warmActiveImagineUsage();
  await persistAccountFiles();
  renderAccounts();
}

async function persistAccountFiles() {
  const build = {
    version: 1,
    provider: "build",
    active_id: account_state.build.active_id,
    accounts: account_state.build.accounts.map(normalizeBuildAccount),
    updated_at: libraryNow(),
  };
  const imagine = {
    version: 1,
    provider: "imagine",
    active_id: account_state.imagine.active_id,
    accounts: account_state.imagine.accounts.map(normalizeImagineAccount),
    updated_at: libraryNow(),
  };
  if (library_state.apiReady) {
    const data = await qApi("/api/accounts/save", { build, imagine });
    applyAccountSnapshot(data);
    return;
  }
  await writeAccountFile("build_auth.json", build);
  await writeAccountFile("imagine_auth.json", imagine);
}
