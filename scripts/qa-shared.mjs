import process from "node:process";

export const BACKEND_URL = process.env.BACKEND_URL || process.env.API_BASE || "http://127.0.0.1";
export const REQUIRE_DB = process.env.QA_REQUIRE_DB === "1";
export const BASE_PATH_PREFIX = "/api/v1";

function normalizeBaseUrl(raw) {
  return String(raw || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

function summarizeBody(data) {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data.length > 180 ? `${data.slice(0, 177)}...` : data;
  try {
    return JSON.stringify(data);
  } catch (err) {
    return String(data);
  }
}

let actorTokenPromise;

async function getActorToken() {
  if (!actorTokenPromise) {
    actorTokenPromise = fetch(`${normalizeBaseUrl(BACKEND_URL)}/api/v1/auth/anonymous`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(async (res) => {
      if (!res.ok) return "";
      const payload = await res.json().catch(() => null);
      return typeof payload?.token === "string" ? payload.token : "";
    }).catch(() => "");
  }
  return actorTokenPromise;
}

export async function request(path, options = {}) {
  const normalized = `${normalizeBaseUrl(BACKEND_URL)}${path}`;
  const started = Date.now();
  const method = String(options.method || "GET").toUpperCase();
  const actorToken = method !== "GET" && method !== "HEAD" && method !== "OPTIONS"
    && !path.endsWith("/auth/anonymous")
    ? await getActorToken()
    : "";
  const res = await fetch(normalized, {
    ...options,
    method,
    headers: {
      ...(options.headers || {}),
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(actorToken ? { "x-actor-token": actorToken } : {}),
    },
  });
  const elapsed = Date.now() - started;
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (err) {
    json = null;
  }
  return {
    path,
    status: res.status,
    ok: res.ok,
    elapsedMs: elapsed,
    headers: Object.fromEntries(res.headers.entries()),
    json,
    text: raw.length > 2000 ? raw.slice(0, 2000) : raw,
    summary: summarizeBody(json || raw),
    isJson: json !== null,
  };
}

export function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  return value === "1" || String(value).toLowerCase() === "true";
}

export function printSummary(name, result) {
  const marker = result.passed ? "✅ PASS" : result.required ? "❌ FAIL" : "⚠️ WARN";
  const suffix = result.required ? "" : " (warn)";
  console.log(`${marker} ${name}${suffix}`);
  if (result.message) {
    console.log(`  ${result.message}`);
  }
  if (result.error) {
    console.log(`  ${result.error}`);
  }
}
