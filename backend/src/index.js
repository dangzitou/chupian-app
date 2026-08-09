import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import multer from "multer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import helmet from "helmet";
import { closeDb, tx, query } from "./db.js";
import {
  cacheDel,
  cacheGetJson,
  cacheIncrWithTtl,
  cacheSetIfNotExists,
  cacheSetJson,
  closeCache,
  pingCache,
} from "./cache.js";
import { makeCursor, parseCursor, safeJsonList } from "./utils.js";

dotenv.config();

const {
  PORT = "3000",
  MAX_FEED_LIMIT = "40",
  UPLOAD_DIR = "./uploads",
  CORS_ORIGIN = "*",
  ALLOWED_UPLOAD_EXT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.mp4,.mov,.m4v,.mp3",
  MAX_JSON_SIZE = "2mb",
  MAX_FILE_SIZE = "120mb",
  SPOT_CACHE_TTL = "90",
  MEDIA_PUBLIC_URL = "",
  MEDIA_STORAGE = "local",
  MEDIA_KEY_PREFIX = "media/",
  S3_BUCKET = "",
  S3_REGION = "us-east-1",
  S3_ENDPOINT = "",
  S3_ACCESS_KEY_ID = "",
  S3_SECRET_ACCESS_KEY = "",
  S3_FORCE_PATH_STYLE = "false",
} = process.env;

const SPOT_CACHE_TTL_SECONDS = Number.parseInt(SPOT_CACHE_TTL, 10) || 90;
const LOCATION_CACHE_TTL_SECONDS = Number.parseInt(process.env.LOCATION_CACHE_TTL || String(60 * 60 * 24), 10) || 60 * 60 * 24;
const LOCATION_LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.LOCATION_LOOKUP_TIMEOUT_MS || "2500", 10) || 2500;
const WEATHER_CACHE_TTL_SECONDS = Number.parseInt(process.env.WEATHER_CACHE_TTL || "300", 10) || 300;
const WEATHER_LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.WEATHER_LOOKUP_TIMEOUT_MS || "3500", 10) || 3500;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = Number.parseInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || "65000", 10) || 65000;
const HTTP_HEADERS_TIMEOUT_MS = Number.parseInt(process.env.HTTP_HEADERS_TIMEOUT_MS || "20000", 10) || 20000;
const HTTP_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || "180000", 10) || 180000;
const POST_VIEW_TTL_SECONDS = Number.parseInt(process.env.POST_VIEW_TTL_SECONDS || "1800", 10) || 1800;
const IDEMPOTENCY_TTL_SECONDS = Number.parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || "3600", 10) || 3600;
const IDEMPOTENCY_LOCK_SECONDS = Number.parseInt(process.env.IDEMPOTENCY_LOCK_SECONDS || "60", 10) || 60;
const ACTOR_SESSION_TTL_SECONDS = Number.parseInt(process.env.ACTOR_SESSION_TTL_SECONDS || String(60 * 60 * 24 * 180), 10) || 60 * 60 * 24 * 180;
const ACTOR_SESSION_SECRET = String(process.env.ACTOR_SESSION_SECRET || "chupian-dev-session-secret");
const REQUIRE_ACTOR_SESSION = String(process.env.REQUIRE_ACTOR_SESSION || "true").toLowerCase() === "true";
const API_RATE_LIMIT_WINDOW_SECONDS = 60;
const API_RATE_LIMIT_READ_MAX = Number.parseInt(process.env.API_RATE_LIMIT_READ_MAX || "600", 10) || 600;
const API_RATE_LIMIT_WRITE_MAX = Number.parseInt(process.env.API_RATE_LIMIT_WRITE_MAX || "120", 10) || 120;
const API_RATE_LIMIT_WINDOW_MS = API_RATE_LIMIT_WINDOW_SECONDS * 1000;
const MAX_POST_MEDIA = 9;
const MAX_POST_VIDEO_SECONDS = 40;
const apiRateLimitMemory = new Map();
const SYSTEM_ROUTES = new Set([
  "/health",
  "/api/health",
  "/api/v1/health",
  "/api/v1/system/health",
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const ASSET_DIR = path.join(ROOT_DIR, UPLOAD_DIR);
const MEDIA_STORAGE_MODE = String(MEDIA_STORAGE || "local").trim().toLowerCase();
const MEDIA_BASE_URL = String(MEDIA_PUBLIC_URL || "").trim().replace(/\/+$/, "");
const MEDIA_KEY_PREFIX_VALUE = String(MEDIA_KEY_PREFIX || "")
  .trim()
  .replace(/^\/+|\/+$/g, "");
const S3_BUCKET_NAME = String(S3_BUCKET || "").trim();
const S3_REGION_NAME = String(S3_REGION || "us-east-1").trim();
const S3_ENDPOINT_URL = String(S3_ENDPOINT || "").trim().replace(/\/+$/, "");
const S3_FORCE_PATH_STYLE_VALUE = String(S3_FORCE_PATH_STYLE || "false").toLowerCase() === "true";

if (!["local", "s3"].includes(MEDIA_STORAGE_MODE)) {
  throw new Error(`Unsupported MEDIA_STORAGE: ${MEDIA_STORAGE_MODE}`);
}
if (MEDIA_STORAGE_MODE === "s3" && (!S3_BUCKET_NAME || !S3_REGION_NAME)) {
  throw new Error("S3_BUCKET and S3_REGION are required when MEDIA_STORAGE=s3");
}

const s3Client = MEDIA_STORAGE_MODE === "s3"
  ? new S3Client({
      region: S3_REGION_NAME,
      endpoint: S3_ENDPOINT_URL || undefined,
      forcePathStyle: S3_FORCE_PATH_STYLE_VALUE,
      credentials: S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
        ? { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
        : undefined,
    })
  : null;

fs.mkdirSync(ASSET_DIR, { recursive: true });

function encodeObjectKey(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getMediaObjectKey(filename) {
  return `${MEDIA_KEY_PREFIX_VALUE ? `${MEDIA_KEY_PREFIX_VALUE}/` : ""}${String(filename || "")}`;
}

function buildMediaUrl(req, filename, objectKey = filename) {
  const safeFilename = encodeURIComponent(String(filename || ""));
  const safeObjectKey = encodeObjectKey(objectKey || filename);
  if (MEDIA_BASE_URL) {
    return `${MEDIA_BASE_URL}/${MEDIA_STORAGE_MODE === "s3" ? safeObjectKey : safeFilename}`;
  }
  if (MEDIA_STORAGE_MODE === "s3") {
    if (S3_ENDPOINT_URL) {
      const endpointPath = S3_FORCE_PATH_STYLE_VALUE
        ? `${encodeURIComponent(S3_BUCKET_NAME)}/${safeObjectKey}`
        : safeObjectKey;
      return `${S3_ENDPOINT_URL}/${endpointPath}`;
    }
    return `https://${S3_BUCKET_NAME}.s3.${S3_REGION_NAME}.amazonaws.com/${safeObjectKey}`;
  }
  return `${req.protocol}://${req.get("host")}/media/${safeFilename}`;
}

async function persistMediaFile(req, file) {
  if (MEDIA_STORAGE_MODE !== "s3") return buildMediaUrl(req, file.filename);

  const objectKey = getMediaObjectKey(file.filename);
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: objectKey,
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  await fs.promises.unlink(file.path).catch(() => {});
  return buildMediaUrl(req, file.filename, objectKey);
}

const allowedExtensions = new Set(ALLOWED_UPLOAD_EXT.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
const allowedMimes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-m4v",
  "audio/mpeg",
]);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(","),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "x-actor-id",
      "x-actor-token",
      "x-forwarded-for",
      "authorization",
      "idempotency-key",
      "x-idempotency-key",
    ],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: MAX_JSON_SIZE }));
app.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload too large" });
  }
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "invalid json" });
  }
  return next(err);
});
app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || req.headers["x-correlation-id"]
    || randomUUID().replace(/-/g, "");
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

function isBypassedFromRateLimit(req) {
  return req && req.path && SYSTEM_ROUTES.has(req.path);
}

function buildApiRateLimitPayload(req, windowNow) {
  const bucketStart = Math.floor(windowNow / API_RATE_LIMIT_WINDOW_MS);
  const identity = ipToActorFingerprint(req);
  const bucketType = req.method === "GET" || req.method === "HEAD" ? "read" : "write";
  const bucketStartMs = bucketStart * API_RATE_LIMIT_WINDOW_MS;
  return {
    bucketStartMs,
    bucketResetMs: bucketStartMs + API_RATE_LIMIT_WINDOW_MS,
    key: `rate_limit:${bucketType}:${identity}:${bucketStart}`,
    limit: bucketType === "read" ? API_RATE_LIMIT_READ_MAX : API_RATE_LIMIT_WRITE_MAX,
    bucketType,
  };
}

async function checkInMemoryRateLimit(key, bucketResetMs) {
  const now = Date.now();
  for (const [existingKey, existing] of apiRateLimitMemory) {
    if (existing.resetMs <= now) {
      apiRateLimitMemory.delete(existingKey);
    }
  }

  const existing = apiRateLimitMemory.get(key);

  if (!existing || existing.resetMs <= now) {
    apiRateLimitMemory.set(key, { count: 1, resetMs: bucketResetMs });
    return 1;
  }

  existing.count += 1;
  return existing.count;
}

async function apiLimiter(req, res, next) {
  if (isBypassedFromRateLimit(req)) return next();
  const now = Date.now();
  const { bucketResetMs, key, limit, bucketType } = buildApiRateLimitPayload(req, now);
  const remainingWindowMs = Math.max(bucketResetMs - now, 0);

  let count = null;

  const redisCount = await cacheIncrWithTtl(key, API_RATE_LIMIT_WINDOW_SECONDS, 1);
  if (Number.isFinite(redisCount)) {
    count = Number(redisCount);
  }

  if (count == null) {
    count = await checkInMemoryRateLimit(key, bucketResetMs);
  }

  const remainingCount = Math.max(limit - count, 0);
  res.setHeader("X-Rate-Limit-Limit", String(limit));
  res.setHeader("X-Rate-Limit-Remaining", String(remainingCount));
  res.setHeader("X-Rate-Limit-Reset", String(Math.ceil(bucketResetMs / 1000)));
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(remainingCount));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucketResetMs / 1000)));
  res.setHeader("RateLimit-Policy", `${limit};w=${API_RATE_LIMIT_WINDOW_SECONDS};type=${bucketType}`);

  if (count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucketResetMs - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      error: "too many requests",
      limit,
      type: bucketType,
      remaining: remainingCount,
      resetAt: new Date(bucketResetMs).toISOString(),
      retryAfter: retryAfterSeconds,
      mode: count === redisCount ? "redis" : "memory",
      remainingWindowMs,
    });
  }

  return next();
}
app.use("/api", apiLimiter);

app.use("/media", express.static(ASSET_DIR, {
  maxAge: "1y",
  immutable: true,
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, ASSET_DIR);
    },
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
      cb(null, `${Date.now()}-${randomUUID().slice(0, 6)}${ext}`);
    },
  }),
  limits: { fileSize: Number.parseInt(MAX_FILE_SIZE, 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    const hasValidExt = ext && allowedExtensions.has(ext);
    const hasValidMime = allowedMimes.has(mime);
    if (hasValidExt && hasValidMime) return cb(null, true);
    cb(new Error("Unsupported file type"));
  },
});

function clampString(value, maxLen) {
  return String(value || "").trim().slice(0, Math.max(0, Number(maxLen) || 0));
}

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function parseSearchText(raw) {
  const text = clampString(raw, 80);
  if (!text) return "";
  return text.replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["0", "false", "off", "no", "f"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "y"].includes(normalized)) return true;
  return fallback;
}

function extractPaginationParams(req, fallback = 20) {
  return {
    limit: pickInt(req.query.limit, fallback, { min: 1, max: Number(MAX_FEED_LIMIT) }),
    sort: req.query.sort === "hot" ? "hot" : "latest",
    cursor: parseCursor(req.query.cursor || ""),
  };
}

function ipToActorFingerprint(req) {
  const xff = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(xff) ? xff[0] : String(xff || "")).split(",")[0].trim()
    || req.socket.remoteAddress
    || req.ip
    || "127.0.0.1";
  const salt = process.env.ACTOR_HASH_SALT || "chupian-mobile-salt";
  return crypto.createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 24);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "")).split(",")[0].trim()
    || String(req.headers["cf-connecting-ip"] || "").trim()
    || String(req.ip || req.socket.remoteAddress || "").trim();
  return raw.replace(/^::ffff:/i, "").replace(/^\[|\]$/g, "");
}

function isPrivateIp(value) {
  const ip = String(value || "").toLowerCase();
  if (!ip) return true;
  if (ip === "localhost" || ip === "::1" || ip === "0.0.0.0") return true;
  if (/^(10|127)\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  const private172 = ip.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(fc|fd|fe80:)/.test(ip);
}

async function networkLocationHandler(req, res) {
  const ip = getClientIp(req);
  if (isPrivateIp(ip)) {
    return res.status(503).json({ error: "network location unavailable" });
  }

  const salt = process.env.LOCATION_HASH_SALT || ACTOR_SESSION_SECRET;
  const ipKey = crypto.createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
  const cacheKey = `location:ip:v1:${ipKey}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCATION_LOOKUP_TIMEOUT_MS);
  try {
    const upstream = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: "application/json", "User-Agent": "chupian-location/1.0" },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return res.status(503).json({ error: "network location unavailable" });
    }
    const data = await upstream.json();
    const lat = Number(data?.latitude);
    const lng = Number(data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(503).json({ error: "network location unavailable" });
    }
    const label = [data?.city, data?.region, data?.country_name]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");
    const payload = {
      location: { lat, lng, label: label || "当前位置" },
      source: "ip",
      accuracy: "coarse",
    };
    await cacheSetJson(cacheKey, payload, LOCATION_CACHE_TTL_SECONDS);
    return res.json(payload);
  } catch (_err) {
    return res.status(503).json({ error: "network location unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

function encodeSessionPart(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function decodeSessionPart(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function signActorSession(actorId, now = Math.floor(Date.now() / 1000)) {
  const payload = encodeSessionPart(JSON.stringify({
    kind: "anonymous",
    actorId: String(actorId),
    iat: now,
    exp: now + ACTOR_SESSION_TTL_SECONDS,
  }));
  const signature = crypto.createHmac("sha256", ACTOR_SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function signUserSession(userId, now = Math.floor(Date.now() / 1000)) {
  const payload = encodeSessionPart(JSON.stringify({
    kind: "user",
    userId: String(userId),
    actorId: String(userId),
    iat: now,
    exp: now + ACTOR_SESSION_TTL_SECONDS,
  }));
  const signature = crypto.createHmac("sha256", ACTOR_SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSignedSession(req) {
  const raw = String(req.headers["x-actor-token"] || "").trim();
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return "";
  const expected = crypto.createHmac("sha256", ACTOR_SESSION_SECRET).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return "";
  try {
    const decoded = JSON.parse(decodeSessionPart(payload));
    if (!decoded?.actorId || Number(decoded.exp) <= Math.floor(Date.now() / 1000)) return "";
    return decoded;
  } catch (_err) {
    return "";
  }
}

function readActorSession(req) {
  const decoded = readSignedSession(req);
  return decoded?.actorId ? String(decoded.actorId).slice(0, 64) : "";
}

function readUserSession(req) {
  const decoded = readSignedSession(req);
  if (decoded?.kind !== "user" || !decoded?.userId) return "";
  return String(decoded.userId).slice(0, 64);
}

function actorHash(candidate) {
  return crypto.createHash("md5").update(String(candidate || "")).digest("hex").slice(0, 24);
}

function readAnonymousActorId(req) {
  const decoded = readSignedSession(req);
  if (!decoded?.actorId || decoded.kind === "user") return "";
  return actorHash(decoded.actorId);
}

function readActorId(req, body = {}) {
  const sessionActorId = readActorSession(req);
  const candidate = String(
    sessionActorId ||
      (REQUIRE_ACTOR_SESSION ? ipToActorFingerprint(req) : (
        req.headers["x-actor-id"] ||
        body.actorId ||
        body.authorId ||
        ipToActorFingerprint(req) ||
        req.ip ||
        "anonymous"
      ))
  );
  return actorHash(candidate);
}

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      String(password),
      String(salt),
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey))
    );
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await derivePassword(password, salt);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [scheme, salt, digest] = String(encoded || "").split("$");
  if (scheme !== "scrypt" || !salt || !digest || !/^[a-f0-9]+$/i.test(digest)) return false;
  const derivedKey = await derivePassword(password, salt);
  const expected = Buffer.from(digest, "hex");
  return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey);
}

function resolveIdempotencyKey(req) {
  return String(
    req.headers["idempotency-key"] ||
    req.headers["x-idempotency-key"] ||
    (req.body && req.body.idempotencyKey) ||
    ""
  ).trim();
}

function buildIdempotencyKey(scope, actor, rawKey) {
  return crypto.createHash("sha256").update(`${scope}|${actor}|${rawKey}`).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithIdempotency({
  req,
  actor,
  scope,
  handler,
  ttlSeconds = IDEMPOTENCY_TTL_SECONDS,
  lockSeconds = IDEMPOTENCY_LOCK_SECONDS,
}) {
  const rawKey = resolveIdempotencyKey(req);
  if (!rawKey) {
    return {
      replay: false,
      payload: await handler(),
    };
  }

  const cacheKey = `idem:${scope}:${actor}:${buildIdempotencyKey(scope, actor, rawKey)}`;
  const lockKey = `${cacheKey}:lock`;

  const cached = await cacheGetJson(cacheKey);
  if (cached?.ok) {
    return {
      replay: true,
      payload: cached.payload,
    };
  }

  const lockAcquired = await cacheSetIfNotExists(lockKey, "1", lockSeconds);
  if (!lockAcquired) {
    for (let i = 0; i < 8; i += 1) {
      const waited = await cacheGetJson(cacheKey);
      if (waited?.ok) {
        return {
          replay: true,
          payload: waited.payload,
        };
      }
      await sleep(220 + i * 30);
    }

    const err = new Error("请求处理中，请稍后重试");
    err.status = 409;
    throw err;
  }

  try {
    const payload = await handler();
    await cacheSetJson(cacheKey, { ok: true, payload }, ttlSeconds);
    return {
      replay: false,
      payload,
    };
  } finally {
    await cacheDel(lockKey);
  }
}

function normalizeList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,，/|#]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function safeText(value, maxLen = 0) {
  return String(value || "").replace(/[\u0000]/g, "").slice(0, maxLen);
}

function pickInt(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function pickFloat(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function appendSearchConditions({ where, params }, queryText, topic) {
  if (queryText) {
    const token = `%${escapeLike(queryText)}%`;
    where.push(`(
      p.title LIKE ? ESCAPE '\\\\'
      OR p.content LIKE ? ESCAPE '\\\\'
      OR p.spot_name LIKE ? ESCAPE '\\\\'
      OR p.district LIKE ? ESCAPE '\\\\'
    )`);
    params.push(token, token, token, token);
  }

  if (topic) {
    where.push(`(
      EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ?)
      OR EXISTS (SELECT 1 FROM post_styles ps WHERE ps.post_id = p.id AND ps.style = ?)
    )`);
    params.push(topic, topic);
  }
}

function buildFeedBaseWhere({ q = "", tag = "", actorId = "", spotId = "" } = {}) {
  const where = ["p.status='published'"];
  const params = [];
  appendSearchConditions({ where, params }, parseSearchText(q), parseSearchText(tag));
  if (String(spotId || "").trim()) {
    where.push("p.spot_id = ?");
    params.push(String(spotId).trim());
  }
  if (actorId) {
    where.push("(p.author_id = ? OR NOT EXISTS (SELECT 1 FROM blocked_authors b WHERE b.blocker_id = ? AND b.blocked_id = p.author_id))");
    params.push(actorId, actorId);
  }
  return { where, params };
}

async function loadPostMeta(rows, options = {}) {
  const includeComments = options.includeComments !== false;
  const actor = String(options.actor || "").trim();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const inQuery = ids.map(() => "?").join(",");
  const authorIds = Array.from(new Set(rows.map((r) => String(r.author_id || "").trim()).filter(Boolean)));
  const authorQuery = authorIds.map(() => "?").join(",");

  const [mediaRows, tagRows, styleRows, commentAggRows, likeAggRows, favAggRows, commentRows, followerRows] = await Promise.all([
    query(
      `SELECT post_id, kind, url, width, height, duration, cover_url, sort_order
       FROM post_media
       WHERE post_id IN (${inQuery})
       ORDER BY post_id, sort_order`,
      ids
    ),
    query(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${inQuery})`, ids),
    query(`SELECT post_id, style FROM post_styles WHERE post_id IN (${inQuery})`, ids),
    query(`SELECT post_id, COUNT(*) AS c FROM post_comments WHERE post_id IN (${inQuery}) GROUP BY post_id`, ids),
    query(`SELECT post_id, COUNT(*) AS c FROM post_likes WHERE post_id IN (${inQuery}) GROUP BY post_id`, ids),
    query(`SELECT post_id, COUNT(*) AS c FROM post_favorites WHERE post_id IN (${inQuery}) GROUP BY post_id`, ids),
    includeComments
      ? query(
        `SELECT post_id, id, actor_name AS author, content, created_at
         FROM post_comments
         WHERE post_id IN (${inQuery})
         ORDER BY post_id, id DESC
         LIMIT 80`,
        ids
      )
      : Promise.resolve([]),
    authorIds.length
      ? query(
        `SELECT followed_id AS author_id, COUNT(*) AS c
         FROM author_follows
         WHERE followed_id IN (${authorQuery})
         GROUP BY followed_id`,
        authorIds
      )
      : Promise.resolve([]),
  ]);

  const mediaMap = new Map();
  const tagMap = new Map();
  const styleMap = new Map();
  const commentMap = new Map();
  const commentCountMap = new Map();
  const likeMap = new Map();
  const favMap = new Map();
  const followerMap = new Map();

  for (const r of mediaRows) {
    const key = String(r.post_id);
    if (!mediaMap.has(key)) mediaMap.set(key, []);
    mediaMap.get(key).push({
      kind: r.kind,
      url: r.url,
      width: Number(r.width || 0),
      height: Number(r.height || 0),
      duration: Number(r.duration || 0),
      cover: r.cover_url || "",
    });
  }
  for (const r of tagRows) {
    const key = String(r.post_id);
    if (!tagMap.has(key)) tagMap.set(key, []);
    tagMap.get(key).push(r.tag);
  }
  for (const r of styleRows) {
    const key = String(r.post_id);
    if (!styleMap.has(key)) styleMap.set(key, []);
    styleMap.get(key).push(r.style);
  }
  if (includeComments) {
    for (const r of commentRows) {
      const key = String(r.post_id);
      if (!commentMap.has(key)) commentMap.set(key, []);
      commentMap.get(key).push({
        id: r.id,
        author: r.author,
        text: r.content,
        createdAt: r.created_at,
      });
    }
  }
  for (const item of likeAggRows) {
    likeMap.set(String(item.post_id), Number(item.c || 0));
  }
  for (const item of commentAggRows) {
    commentCountMap.set(String(item.post_id), Number(item.c || 0));
  }
  for (const item of favAggRows) {
    favMap.set(String(item.post_id), Number(item.c || 0));
  }
  for (const item of followerRows) {
    followerMap.set(String(item.author_id), Number(item.c || 0));
  }

  return rows.map((row) => {
    const key = String(row.id);
    const commentCount = Number(commentCountMap.get(key) || (commentMap.get(key) || []).length || 0);
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      authorId: row.author_id || "",
      author: row.author_name || "匿名拍友",
      authorBio: row.author_bio || "",
      avatar: row.author_avatar || "",
      spotId: row.spot_id ? String(row.spot_id) : "",
      spotName: row.spot_name || "",
      district: row.district || "",
      latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
      longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
      cover: row.cover_url || "",
      angle: row.angle || "",
      direction: row.direction || "",
      timeWindow: row.time_window || "",
      bestTime: row.best_time || "",
      shotAt: row.shot_at || "",
      gear: {
        camera: row.camera || "",
        lens: row.lens || "",
        focal: row.focal_length || "",
        aperture: row.aperture || "",
        shutter: row.shutter || "",
        iso: row.iso || "",
        whiteBalance: row.white_balance || "",
      },
      media: mediaMap.get(key) || [],
      tags: tagMap.get(key) || [],
      styles: styleMap.get(key) || [],
      likes: Number(row.stats_likes || likeMap.get(key) || 0),
      favorites: Number(row.stats_favorites || favMap.get(key) || 0),
      views: Number(row.stats_views || 0),
    comments: includeComments ? (commentMap.get(key) || []) : [],
      commentsCount: commentCount,
      liked: Boolean(row.liked),
      favorited: Boolean(row.favorited),
      followed: actor ? Boolean(row.followed) : false,
      followers: Number(followerMap.get(String(row.author_id || "")) || 0),
      createdAt: row.created_at,
    };
  });
}

async function fetchFeedRows({ sort = "latest", cursor, limit, actorId, q = "", tag = "", spotId = "" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const clauses = ["SELECT p.*"];
  const fromClause = " FROM posts p";
  const { where, params } = buildFeedBaseWhere({ q, tag, actorId, spotId });
  const baseWhere = [...where];
  const baseParams = [...params];
  const whereClause = baseWhere.length ? ` WHERE ${baseWhere.join(" AND ")}` : "";

  const order = sort === "hot"
    ? " ORDER BY p.stats_likes DESC, p.created_at DESC, p.id DESC"
    : " ORDER BY p.created_at DESC, p.id DESC";

  clauses.push(
    ", (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes_count",
    ", (SELECT COUNT(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorites_count",
    ", (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comments_count",
    ", EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked",
    ", EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited",
    ", EXISTS (SELECT 1 FROM author_follows af WHERE af.follower_id = ? AND af.followed_id = p.author_id) AS followed"
  );

  if (cursor) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const rows = await query(
    `${clauses.join("")} ${fromClause} WHERE ${where.join(" AND ")} ${order} LIMIT ?`,
    [actorId, actorId, actorId, ...params, max + 1]
  );

  const useRows = rows.slice(0, max);
  const posts = await loadPostMeta(useRows, { includeComments: false, actor: actorId });
  const nextCursor = useRows.length === max ? makeCursor(useRows.at(-1).createdAt, useRows.at(-1).id) : null;

  const totalRows = await query(
    `SELECT COUNT(*) AS c FROM posts p${whereClause}`,
    [...baseParams]
  );
  const total = Number(totalRows[0]?.c || 0);
  const hasMore = useRows.length === max;

  const statsRows = await query(
    `SELECT
      COUNT(*) AS total_posts,
      COUNT(DISTINCT p.author_id) AS authors,
      COALESCE(SUM(p.stats_likes), 0) AS total_likes
     FROM posts p${whereClause}`,
    [...baseParams]
  );
  const statsRow = statsRows[0] || {};

  return {
    posts,
    nextCursor,
    hasMore,
    total,
    stats: {
      totalPosts: total,
      authors: Number(statsRow.authors || 0),
      totalLikes: Number(statsRow.total_likes || 0),
    },
  };
}

function buildFeedCacheKey({ actor, sort, limit, cursor, q, tag, spotId }) {
  const token = [q, tag, spotId].map((value) => clampString(String(value || ""), 48).toLowerCase()).join("|");
  return `feed:${actor}:${sort}:${limit}:${cursor?.id || "0"}:${cursor?.createdAt || "0"}:${token}`;
}

async function fetchActorFeedRows({ table, actorId, limit, cursor, sort = "latest" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const relation = table === "post_favorites" ? "post_favorites" : "post_likes";
  const fromClause = `
    FROM posts p
    INNER JOIN ${relation} t ON t.post_id = p.id
  `;
  const where = [
    "p.status='published'",
    `t.actor_id = ?`,
    "NOT EXISTS (SELECT 1 FROM blocked_authors b WHERE b.blocker_id = ? AND b.blocked_id = p.author_id)",
  ];
  const params = [actorId, actorId];
  const baseWhere = [...where];
  const baseParams = [...params];
  const whereClause = baseWhere.join(" AND ");

  if (cursor) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const order = sort === "hot"
    ? " ORDER BY p.stats_likes DESC, p.created_at DESC, p.id DESC"
    : " ORDER BY p.created_at DESC, p.id DESC";

  const rows = await query(
    `SELECT p.*,
      EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked,
      EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited,
      EXISTS (SELECT 1 FROM author_follows af WHERE af.follower_id = ? AND af.followed_id = p.author_id) AS followed
     ${fromClause}
     WHERE ${where.join(" AND ")} ${order} LIMIT ?`,
    [actorId, actorId, actorId, ...params, max + 1]
  );

  const useRows = rows.slice(0, max);
  const posts = await loadPostMeta(useRows, { includeComments: false, actor: actorId });
  const nextCursor = useRows.length === max ? makeCursor(useRows.at(-1).createdAt, useRows.at(-1).id) : null;
  const totalRows = await query(`SELECT COUNT(*) AS c ${fromClause} WHERE ${whereClause}`, baseParams);
  const total = Number(totalRows[0]?.c || 0);

  return {
    posts,
    nextCursor,
    hasMore: useRows.length === max,
    total,
    stats: { totalPosts: total },
  };
}

async function fetchAuthorFeedRows({ actorId, authorId = actorId, limit, cursor, sort = "latest" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const where = [
    "p.status='published'",
    "p.author_id = ?",
    "NOT EXISTS (SELECT 1 FROM blocked_authors b WHERE b.blocker_id = ? AND b.blocked_id = p.author_id)",
  ];
  const params = [authorId, actorId];
  const baseWhere = [...where];
  const baseParams = [...params];
  const whereClause = baseWhere.join(" AND ");

  if (cursor) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const order = sort === "hot"
    ? " ORDER BY p.stats_likes DESC, p.created_at DESC, p.id DESC"
    : " ORDER BY p.created_at DESC, p.id DESC";

  const rows = await query(
    `SELECT p.*,
      EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked,
      EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited,
      EXISTS (SELECT 1 FROM author_follows af WHERE af.follower_id = ? AND af.followed_id = p.author_id) AS followed
     FROM posts p
     WHERE ${where.join(" AND ")} ${order} LIMIT ?`,
    [actorId, actorId, actorId, ...params, max + 1]
  );

  const useRows = rows.slice(0, max);
  const posts = await loadPostMeta(useRows, { includeComments: false, actor: actorId });
  const nextCursor = useRows.length === max ? makeCursor(useRows.at(-1).createdAt, useRows.at(-1).id) : null;
  const totalRows = await query(
    `SELECT COUNT(*) AS c FROM posts p WHERE ${whereClause}`,
    baseParams
  );
  const total = Number(totalRows[0]?.c || 0);

  return {
    posts,
    nextCursor,
    hasMore: useRows.length === max,
    total,
    stats: { totalPosts: total },
  };
}

async function fetchDiscoverySignals(limit = 20) {
  const cacheKey = `discovery:signals:${limit}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return cached;

  const rows = await query(
    `SELECT name, type, cnt FROM (
      SELECT tag AS name, 'tag' AS type, COUNT(*) AS cnt
      FROM post_tags
      GROUP BY tag
      UNION ALL
      SELECT style AS name, 'style' AS type, COUNT(*) AS cnt
      FROM post_styles
      GROUP BY style
    ) AS x
    ORDER BY cnt DESC
    LIMIT ?`,
    [limit]
  );

  const payload = rows.map((r) => ({
    name: r.name,
    type: r.type,
    count: Number(r.cnt || 0),
  })).filter((r) => Boolean(r.name));
  await cacheSetJson(cacheKey, payload, 45);
  return payload;
}

async function invalidateAllPostsCaches() {
  await cacheDel("post:detail:*");
  await cacheDel("feed:*");
  await cacheDel("following:*");
  await cacheDel("map:v1:*");
  await cacheDel("map:v2:*");
  await cacheDel("discovery:signals:*");
}

async function invalidatePostCaches(postId) {
  await cacheDel(`post:detail:${postId}:*`);
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[api:error]", {
          path: req.path,
          method: req.method,
          code: err?.code,
          message: err?.message,
        });
      }
      const status = Number(err?.status) || 500;
      if (!res.headersSent) {
        res.status(status).json({ error: err.message || "internal server error" });
      }
    }
  };
}

async function ensurePostsSchemaCompatibility() {
  try {
    const ensureColumn = async (name, definition, after) => {
      const columns = await query(`SHOW COLUMNS FROM posts LIKE '${name}'`);
      if (!Array.isArray(columns) || columns.length === 0) {
        await query(`ALTER TABLE posts ADD COLUMN ${name} ${definition} AFTER ${after}`);
      }
    };
    await ensureColumn("author_id", "VARCHAR(64) DEFAULT ''", "content");
    await ensureColumn("author_avatar", "VARCHAR(500) DEFAULT ''", "author_bio");
    await ensureColumn("latitude", "DECIMAL(10,7) DEFAULT NULL", "district");
    await ensureColumn("longitude", "DECIMAL(10,7) DEFAULT NULL", "latitude");

    const indexes = [
      ["idx_posts_author_id", "INDEX idx_posts_author_id (author_id)"],
      ["idx_posts_author_status_created", "INDEX idx_posts_author_status_created (author_id, status, created_at, id)"],
      ["idx_posts_status_author", "INDEX idx_posts_status_author (status, author_id, created_at, id)"],
      ["idx_posts_spot_name", "INDEX idx_posts_spot_name (spot_name)"],
      ["idx_posts_district", "INDEX idx_posts_district (district)"],
      ["idx_posts_best_time", "INDEX idx_posts_best_time (best_time)"],
      ["idx_posts_shot_at", "INDEX idx_posts_shot_at (shot_at)"],
      ["idx_posts_status_lat_lng", "INDEX idx_posts_status_lat_lng (status, latitude, longitude, created_at, id)"],
      ["idx_posts_status_hot", "INDEX idx_posts_status_hot (status, stats_likes, created_at, id)"],
      ["idx_posts_status_favorites", "INDEX idx_posts_status_favorites (status, stats_favorites, created_at, id)"],
      ["ft_posts_search", "FULLTEXT INDEX ft_posts_search (title, content, spot_name, district)"],
    ];
    for (const [name, definition] of indexes) {
      const existing = await query("SHOW INDEX FROM posts WHERE Key_name = ?", [name]);
      if (!Array.isArray(existing) || existing.length === 0) {
        await query(`ALTER TABLE posts ADD ${definition}`);
      }
    }
  } catch (err) {
    console.warn(`[schema] ensurePostsSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureMapSchemaCompatibility() {
  try {
    const existing = await query("SHOW INDEX FROM spots WHERE Key_name = ?", ["idx_spots_lat_lng"]);
    if (!Array.isArray(existing) || existing.length === 0) {
      await query("ALTER TABLE spots ADD INDEX idx_spots_lat_lng (latitude, longitude)");
    }
  } catch (err) {
    console.warn(`[schema] ensureMapSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureFollowSchemaCompatibility() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS author_follows (
        follower_id VARCHAR(64) NOT NULL,
        followed_id VARCHAR(64) NOT NULL,
        actor_name VARCHAR(64) DEFAULT '匿名拍友',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (follower_id, followed_id),
        INDEX idx_af_follower (follower_id),
        INDEX idx_af_followed (followed_id)
      ) ENGINE=InnoDB
    `);
  } catch (_err) {
    console.warn("[schema] ensureFollowSchemaCompatibility skipped");
  }
}

async function ensureAuthSchemaCompatibility() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(32) NOT NULL UNIQUE,
        display_name VARCHAR(64) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        bio VARCHAR(160) NOT NULL DEFAULT '',
        avatar_url VARCHAR(500) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_display_name (display_name)
      ) ENGINE=InnoDB
    `);
    const avatarColumns = await query("SHOW COLUMNS FROM users LIKE 'avatar_url'");
    if (!Array.isArray(avatarColumns) || avatarColumns.length === 0) {
      await query("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NOT NULL DEFAULT '' AFTER bio");
    }
  } catch (err) {
    console.warn(`[schema] ensureAuthSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureNotificationSchemaCompatibility() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        recipient_id VARCHAR(64) NOT NULL,
        actor_id VARCHAR(64) NOT NULL,
        actor_name VARCHAR(80) NOT NULL DEFAULT '匿名拍友',
        actor_avatar VARCHAR(500) NOT NULL DEFAULT '',
        type ENUM('like', 'favorite', 'comment', 'follow') NOT NULL,
        post_id BIGINT UNSIGNED DEFAULT NULL,
        post_title VARCHAR(200) NOT NULL DEFAULT '',
        content VARCHAR(300) NOT NULL DEFAULT '',
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_notifications_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE SET NULL,
        INDEX idx_notifications_recipient_created (recipient_id, created_at, id),
        INDEX idx_notifications_recipient_read (recipient_id, is_read, created_at, id)
      ) ENGINE=InnoDB
    `);
    const [avatarColumns] = await query("SHOW COLUMNS FROM notifications LIKE 'actor_avatar'");
    if (!avatarColumns.length) {
      await query(
        "ALTER TABLE notifications ADD COLUMN actor_avatar VARCHAR(500) NOT NULL DEFAULT '' AFTER actor_name"
      );
    }
  } catch (err) {
    console.warn(`[schema] ensureNotificationSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureCommentSchemaCompatibility() {
  try {
    const [avatarColumns] = await query("SHOW COLUMNS FROM post_comments LIKE 'actor_avatar'");
    if (!avatarColumns.length) {
      await query(
        "ALTER TABLE post_comments ADD COLUMN actor_avatar VARCHAR(500) NOT NULL DEFAULT '' AFTER actor_name"
      );
    }
  } catch (err) {
    console.warn(`[schema] ensureCommentSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureReportSchemaCompatibility() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS post_reports (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        post_id BIGINT UNSIGNED NOT NULL,
        reporter_id VARCHAR(64) NOT NULL,
        reason ENUM('misleading', 'copyright', 'unsafe', 'spam', 'other') NOT NULL,
        details VARCHAR(500) NOT NULL DEFAULT '',
        status ENUM('open', 'reviewed', 'dismissed') NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_post_reports_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
        UNIQUE KEY uniq_post_reporter (post_id, reporter_id),
        INDEX idx_reports_status_created (status, created_at, id),
        INDEX idx_reports_post (post_id, created_at, id)
      ) ENGINE=InnoDB
    `);
  } catch (err) {
    console.warn(`[schema] ensureReportSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureBlockSchemaCompatibility() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS blocked_authors (
        blocker_id VARCHAR(64) NOT NULL,
        blocked_id VARCHAR(64) NOT NULL,
        blocked_name VARCHAR(80) NOT NULL DEFAULT '匿名拍友',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (blocker_id, blocked_id),
        INDEX idx_blocked_blocker_created (blocker_id, created_at),
        INDEX idx_blocked_target (blocked_id)
      ) ENGINE=InnoDB
    `);
  } catch (err) {
    console.warn(`[schema] ensureBlockSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureCreatorRewardSchemaCompatibility() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS creator_rewards (
        actor_id VARCHAR(64) PRIMARY KEY,
        points INT UNSIGNED NOT NULL DEFAULT 0,
        published_count INT UNSIGNED NOT NULL DEFAULT 0,
        guide_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_creator_rewards_points (points, updated_at)
      ) ENGINE=InnoDB
    `);
  } catch (err) {
    console.warn(`[schema] ensureCreatorRewardSchemaCompatibility skipped: ${err?.message || "unknown error"}`);
  }
}

async function ensureGuideRewardSchemaCompatibility() {
  try {
    await query("ALTER TABLE posts ADD COLUMN guide_rewarded TINYINT(1) NOT NULL DEFAULT 0");
  } catch (err) {
    if (!/duplicate column/i.test(String(err?.message || ""))) {
      console.warn(`[schema] guide_rewarded column skipped: ${err?.message || "unknown error"}`);
    }
  }

  try {
    await query(`
      UPDATE posts
      SET guide_rewarded = 1
      WHERE guide_rewarded = 0
        AND CHAR_LENGTH(COALESCE(content, '')) >= 120
        AND (
          (CASE WHEN COALESCE(angle, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(direction, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(time_window, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN shot_at IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(camera, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(lens, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(focal_length, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(aperture, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(shutter, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(iso, '') <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN COALESCE(white_balance, '') <> '' THEN 1 ELSE 0 END)
        ) >= 3
    `);
  } catch (err) {
    console.warn(`[schema] guide_rewarded backfill skipped: ${err?.message || "unknown error"}`);
  }
}

async function insertNotification(conn, {
  recipientId,
  actorId,
  actorName,
  actorAvatar = '',
  type,
  postId = null,
  postTitle = '',
  content = '',
}) {
  if (!recipientId || !actorId || String(recipientId) === String(actorId)) return;
  await conn.execute(
    `INSERT INTO notifications
      (recipient_id, actor_id, actor_name, actor_avatar, type, post_id, post_title, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(recipientId),
      String(actorId),
      safeText(actorName || '匿名拍友', 80),
      safeText(actorAvatar || '', 500),
      type,
      postId || null,
      safeText(postTitle || '', 200),
      safeText(content || '', 300),
    ]
  );
}

async function getFollowState(actor, targetAuthorId) {
  if (!actor || !targetAuthorId) {
    return { isFollowing: false, followers: 0 };
  }

  const [followRow] = await query(
    "SELECT COUNT(*) AS isFollowing FROM author_follows WHERE follower_id = ? AND followed_id = ?",
    [actor, targetAuthorId]
  );
  const [countRow] = await query(
    "SELECT COUNT(*) AS followers FROM author_follows WHERE followed_id = ?",
    [targetAuthorId]
  );

  return {
    isFollowing: Boolean(Number(followRow?.isFollowing || 0)),
    followers: Number(countRow?.followers || 0),
  };
}

async function getBlockState(actor, targetAuthorId) {
  if (!actor || !targetAuthorId) return { blocked: false };
  const rows = await query(
    "SELECT COUNT(*) AS blocked FROM blocked_authors WHERE blocker_id = ? AND blocked_id = ?",
    [actor, targetAuthorId]
  );
  return { blocked: Boolean(Number(rows?.[0]?.blocked || 0)) };
}

async function applyAuthorBlock({ actor, targetAuthorId, targetName, action = "toggle" }) {
  const normalizedAction = String(action || "toggle");
  const allowedActions = ["toggle", "block", "unblock"];
  if (!allowedActions.includes(normalizedAction)) {
    const actionErr = new Error(`invalid action: ${normalizedAction}`);
    actionErr.status = 400;
    throw actionErr;
  }

  if (!actor || !targetAuthorId) {
    const err = new Error("target author required");
    err.status = 400;
    throw err;
  }
  if (actor === targetAuthorId) {
    const err = new Error("cannot block yourself");
    err.status = 400;
    throw err;
  }

  const [authorExists] = await query("SELECT 1 FROM posts WHERE author_id = ? LIMIT 1", [targetAuthorId]);
  if (!authorExists) {
    const err = new Error("author not found");
    err.status = 404;
    throw err;
  }

  return tx(async (conn) => {
    const [stateRows] = await conn.execute(
      "SELECT COUNT(*) AS blocked FROM blocked_authors WHERE blocker_id = ? AND blocked_id = ?",
      [actor, targetAuthorId]
    );
    const isBlocked = Boolean(Number(stateRows?.[0]?.blocked || 0));
    const shouldBlock = normalizedAction === "toggle" ? !isBlocked : normalizedAction === "block";
    const name = safeText(targetName || "匿名拍友", 80) || "匿名拍友";

    if (shouldBlock && !isBlocked) {
      await conn.execute(
        "INSERT IGNORE INTO blocked_authors (blocker_id, blocked_id, blocked_name) VALUES (?, ?, ?)",
        [actor, targetAuthorId, name]
      );
    }
    if (!shouldBlock && isBlocked) {
      await conn.execute(
        "DELETE FROM blocked_authors WHERE blocker_id = ? AND blocked_id = ?",
        [actor, targetAuthorId]
      );
    }

    return { blocked: shouldBlock, authorId: targetAuthorId, authorName: name };
  });
}

async function applyAuthorFollow({ actor, actorName, actorAvatar = '', targetAuthorId, action = "toggle" }) {
  const normalizedAction = String(action || "toggle");
  const allowedActions = ["toggle", "follow", "unfollow"];
  if (!allowedActions.includes(normalizedAction)) {
    const actionErr = new Error(`invalid action: ${normalizedAction}`);
    actionErr.status = 400;
    throw actionErr;
  }

  if (!actor || !targetAuthorId) {
    const err = new Error("target author required");
    err.status = 400;
    throw err;
  }
  if (actor === targetAuthorId) {
    const err = new Error("cannot follow yourself");
    err.status = 400;
    throw err;
  }

  const [authorExists] = await query("SELECT 1 FROM posts WHERE author_id = ? LIMIT 1", [targetAuthorId]);
  if (!authorExists) {
    const err = new Error("author not found");
    err.status = 404;
    throw err;
  }

  return tx(async (conn) => {
    const [stateRows] = await conn.execute(
      "SELECT COUNT(*) AS isFollowing FROM author_follows WHERE follower_id = ? AND followed_id = ?",
      [actor, targetAuthorId]
    );
    const isFollowing = Boolean(Number(stateRows?.[0]?.isFollowing || 0));
    const shouldFollow = normalizedAction === "toggle" ? !isFollowing : normalizedAction === "follow";

    if (shouldFollow && !isFollowing) {
      const [insertResult] = await conn.execute(
        "INSERT IGNORE INTO author_follows (follower_id, followed_id, actor_name) VALUES (?, ?, ?)",
        [actor, targetAuthorId, actorName]
      );
      if (insertResult.affectedRows === 1) {
        await insertNotification(conn, {
          recipientId: targetAuthorId,
          actorId: actor,
          actorName,
          actorAvatar,
          type: "follow",
          content: "关注了你",
        });
      }
    }

    if (!shouldFollow && isFollowing) {
      await conn.execute(
        "DELETE FROM author_follows WHERE follower_id = ? AND followed_id = ?",
        [actor, targetAuthorId]
      );
    }

    const [countRows] = await conn.execute(
      "SELECT COUNT(*) AS followers FROM author_follows WHERE followed_id = ?",
      [targetAuthorId]
    );
    const [stateRowsAfter] = await conn.execute(
      "SELECT COUNT(*) AS isFollowing FROM author_follows WHERE follower_id = ? AND followed_id = ?",
      [actor, targetAuthorId]
    );

    return {
      following: Boolean(Number(stateRowsAfter?.[0]?.isFollowing || 0)),
      followers: Number(countRows?.[0]?.followers || 0),
    };
  });
}

async function fetchFollowingFeedRows({ actorId, limit, cursor, sort = "latest" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const where = [
    "p.status='published'",
    "p.author_id IN (SELECT af.followed_id FROM author_follows af WHERE af.follower_id = ?)",
    "NOT EXISTS (SELECT 1 FROM blocked_authors b WHERE b.blocker_id = ? AND b.blocked_id = p.author_id)",
  ];
  const params = [actorId, actorId];
  const baseWhere = [...where];
  const baseParams = [...params];
  const whereClause = baseWhere.join(" AND ");
  if (cursor) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const order = sort === "hot"
    ? " ORDER BY p.stats_likes DESC, p.created_at DESC, p.id DESC"
    : " ORDER BY p.created_at DESC, p.id DESC";

  const rows = await query(
    `SELECT p.*,
      EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked,
      EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited,
      EXISTS (SELECT 1 FROM author_follows af WHERE af.follower_id = ? AND af.followed_id = p.author_id) AS followed
     FROM posts p
     WHERE ${whereClause}
     ${order} LIMIT ?`,
    [actorId, actorId, actorId, ...params, max + 1]
  );

  const useRows = rows.slice(0, max);
  const posts = await loadPostMeta(useRows, { includeComments: false, actor: actorId });
  const nextCursor = useRows.length === max ? makeCursor(useRows.at(-1).createdAt, useRows.at(-1).id) : null;

  const totalRows = await query(`SELECT COUNT(*) AS c FROM posts p WHERE ${whereClause}`, baseParams);
  const total = Number(totalRows[0]?.c || 0);

  return {
    posts,
    nextCursor,
    hasMore: useRows.length === max,
    total,
    stats: { totalPosts: total },
  };
}

function buildFollowingFeedCacheKey({ actor, sort, limit, cursor }) {
  return `following:${actor}:${sort}:${limit}:${cursor?.id || "0"}:${cursor?.createdAt || "0"}`;
}

async function followingFeedHandler(req, res) {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const cacheKey = buildFollowingFeedCacheKey({ actor, sort, limit, cursor });
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);
  const payload = await fetchFollowingFeedRows({ actorId: actor, limit, cursor, sort });
  await cacheSetJson(cacheKey, payload, 15);
  return res.json(payload);
}

async function getPostHandler(req, res) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.query);
  const withComments = parseBoolean(req.query.withComments, true);
  const cacheKey = `post:detail:${postId}:${actor}:${withComments ? "with-comments" : "no-comments"}`;

  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const rows = await query(
    `SELECT p.*,
       EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked,
       EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited,
       EXISTS (SELECT 1 FROM author_follows af WHERE af.follower_id = ? AND af.followed_id = p.author_id) AS followed
     FROM posts p
     WHERE p.id = ?
       AND (p.author_id = ? OR NOT EXISTS (
         SELECT 1 FROM blocked_authors b
         WHERE b.blocker_id = ? AND b.blocked_id = p.author_id
       ))`,
    [actor, actor, actor, postId, actor, actor]
  );
  if (!rows.length) return res.status(404).json({ error: "post not found" });

  const post = (await loadPostMeta(rows, { includeComments: withComments, actor }))[0];
  const viewerKey = String(actor || req.ip || "guest").slice(0, 160);
  const counted = await cacheSetIfNotExists(
    `post:view:${postId}:${viewerKey}`,
    "1",
    POST_VIEW_TTL_SECONDS,
  );
  if (counted) {
    await query("UPDATE posts SET stats_views = stats_views + 1 WHERE id = ?", [postId]);
    post.views += 1;
  }
  await cacheSetJson(cacheKey, { post }, 120);
  return res.json({ post });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sharePostHandler(req, res) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).type("text").send("invalid post id");
  }

  const rows = await query(
    "SELECT p.* FROM posts p WHERE p.id = ? AND p.status = 'published'",
    [postId],
  );
  if (!rows.length) return res.status(404).type("text").send("post not found");

  const post = (await loadPostMeta(rows, { includeComments: false, actor: "" }))[0];
  const title = safeText(post?.title || "出片记录", 120);
  const description = safeText([
    post?.content,
    post?.spotName ? `📍 ${post.spotName}` : "",
    post?.gear?.camera ? `相机：${post.gear.camera}` : "",
    post?.gear?.focal ? `焦段：${post.gear.focal}` : "",
  ].filter(Boolean).join(" · "), 180) || "记录机位、光线和器材，发现附近值得拍的出片位置。";
  const image = String(post?.cover || post?.media?.[0]?.url || "").trim();
  const canonical = `${req.protocol}://${req.get("host")}/post/${encodeURIComponent(postId)}`;
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedCanonical = escapeHtml(canonical);
  const imageMeta = image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "";

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  return res.type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle} · 出片地图</title>
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="出片地图" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedCanonical}" />
    ${imageMeta}
    <meta http-equiv="refresh" content="0;url=${escapedCanonical}" />
  </head>
  <body>
    <p>正在打开出片：<a href="${escapedCanonical}">${escapedTitle}</a></p>
  </body>
</html>`);
}

async function getPostCommentsPayload(req) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    const err = new Error("invalid post id");
    err.status = 400;
    throw err;
  }

  const actor = readActorId(req, req.query);
  const [exists] = await query(
    `SELECT id, author_id, title
     FROM posts p
     WHERE p.id = ?
       AND (p.author_id = ? OR NOT EXISTS (
         SELECT 1 FROM blocked_authors b
         WHERE b.blocker_id = ? AND b.blocked_id = p.author_id
       ))`,
    [postId, actor, actor]
  );
  if (!exists?.id) {
    const err = new Error("post not found");
    err.status = 404;
    throw err;
  }

  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 12, { min: 1, max: Number(MAX_FEED_LIMIT) });
  const [rows, countRows] = await Promise.all([
    query(
      `SELECT id, actor_name AS author, actor_avatar AS avatar, content, created_at
       FROM post_comments
       WHERE post_id = ? ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      cursor
        ? [postId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
        : [postId, limit + 1]
    ),
    query("SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ?", [postId]),
  ]);

  const useRows = rows.slice(0, limit);
  const nextCursor = useRows.length === limit ? makeCursor(useRows.at(-1).createdAt, useRows.at(-1).id) : null;
  return {
    comments: useRows.map((row) => ({
      id: row.id,
      author: row.author,
      avatar: row.avatar || '',
      text: row.content,
      createdAt: row.created_at,
    })),
    nextCursor,
    hasMore: useRows.length === limit,
    total: Number(countRows[0]?.c || 0),
  };
}

function calculateCreatorReward(body = {}) {
  const content = safeText(body.content, 3000);
  const media = Array.isArray(body.media) ? body.media : [];
  const metadataFields = [
    body.angle,
    body.direction,
    body.timeWindow,
    body.shotAt,
    body.camera,
    body.lens,
    body.focalLength,
    body.aperture,
    body.shutter,
    body.iso,
    body.whiteBalance,
  ];
  const metadataCount = metadataFields.filter((value) => safeText(value, 120)).length;
  const hasLocation = Number.isFinite(Number(body.latitude)) && Number.isFinite(Number(body.longitude));
  const guide = content.length >= 120 && metadataCount >= 3;
  const earnedPoints = 5
    + (content.length >= 120 ? 10 : 0)
    + (metadataCount >= 3 ? 5 : 0)
    + (hasLocation ? 2 : 0)
    + (media.length > 1 ? 2 : 0);
  return { earnedPoints, guide, metadataCount };
}

async function createPostHandler(req) {
  const body = req.body || {};
  const title = safeText(body.title, 200) || "出片记录";
  const media = Array.isArray(body.media) ? body.media : [];
  if (!media.length) throw Object.assign(new Error("media required"), { status: 400 });
  if (media.length > MAX_POST_MEDIA) {
    throw Object.assign(new Error(`media cannot exceed ${MAX_POST_MEDIA} items`), { status: 400 });
  }
  for (const item of media) {
    const kind = String(item?.kind || "image").trim().toLowerCase();
    if (!["image", "video", "live"].includes(kind)) {
      throw Object.assign(new Error("unsupported media kind"), { status: 400 });
    }
    const duration = Number(item?.duration || 0);
    if ((kind === "video" || kind === "live") && Number.isFinite(duration) && duration > MAX_POST_VIDEO_SECONDS) {
      throw Object.assign(new Error(`video cannot exceed ${MAX_POST_VIDEO_SECONDS} seconds`), { status: 400 });
    }
  }

  const content = safeText(body.content, 3000);
  const spotId = pickInt(body.spotId, 0);
  const spotName = safeText(body.spotName || "", 80);
  const district = safeText(body.district || "", 64);
  const latitude = pickFloat(body.latitude, null, { min: -90, max: 90 });
  const longitude = pickFloat(body.longitude, null, { min: -180, max: 180 });
  const tags = normalizeList(body.tags || body.tag || "");
  const styles = normalizeList(body.styles || "");
  const actorId = readActorId(req, body);
  const userId = readUserSession(req);
  let authorAvatar = "";
  if (userId) {
    const userRows = await query("SELECT avatar_url FROM users WHERE id = ? LIMIT 1", [userId]);
    authorAvatar = String(userRows[0]?.avatar_url || "");
  }
  let shotAt = null;
  if (body.shotAt) {
    const parsed = new Date(body.shotAt);
    if (!Number.isNaN(parsed.getTime())) {
      shotAt = parsed.toISOString().slice(0, 19).replace("T", " ");
    }
  }
  const rewardInput = calculateCreatorReward(body);

    const result = await tx(async (conn) => {
      const postValues = [
        title,
        content,
        safeText(actorId, 64),
        safeText(body.author || "匿名拍友", 64),
        safeText(body.authorBio || "", 120),
        authorAvatar,
        spotId || null,
        spotName,
        district,
        latitude,
        longitude,
        safeText(body.direction || "", 80),
        safeText(body.angle || "", 80),
        safeText(body.timeWindow || "", 80),
        body.bestTime === "night" || body.bestTime === "golden" || body.bestTime === "day"
          ? body.bestTime
          : null,
        shotAt,
        safeText(body.camera || "", 80),
        safeText(body.lens || "", 80),
        safeText(body.focalLength || "", 40),
        safeText(body.aperture || "", 24),
        safeText(body.shutter || "", 24),
        safeText(body.iso || "", 24),
        safeText(body.whiteBalance || "", 40),
        Array.isArray(media) && media[0] ? (media[0].kind || "image").slice(0, 16) : "image",
        Array.isArray(media) && media[0] ? safeText(media[0].url || "", 500) : "",
      ];

      const [postResult] = await conn.execute(
        `INSERT INTO posts
         (title, content, author_id, author_name, author_bio, author_avatar, spot_id, spot_name, district, latitude, longitude, direction, angle,
        time_window, best_time, shot_at, camera, lens, focal_length, aperture, shutter, iso, white_balance,
        media_type, cover_url, status, guide_rewarded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
        [...postValues, rewardInput.guide ? 1 : 0]
      );

      const postId = postResult.insertId;
      let acceptedMedia = 0;
      for (let i = 0; i < media.length; i += 1) {
        const item = media[i] || {};
        const url = safeText(item.url || "", 500);
        if (!url) continue;
        const kind = String(item.kind || "image").trim().toLowerCase();
        acceptedMedia += 1;
        await conn.execute(
          `INSERT INTO post_media (post_id, kind, url, cover_url, width, height, duration, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            postId,
            kind.slice(0, 12),
            url,
            safeText(item.cover || "", 500),
            Number(item.width || 0),
            Number(item.height || 0),
            Number(item.duration || 0),
            i,
          ]
        );
      }
  if (acceptedMedia === 0) {
        throw Object.assign(new Error("media required"), { status: 400 });
      }

      for (const t of tags) {
        if (!t) continue;
        await conn.execute("INSERT IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)", [postId, t]);
      }
      for (const s of styles) {
        if (!s) continue;
        await conn.execute("INSERT IGNORE INTO post_styles (post_id, style) VALUES (?, ?)", [postId, s]);
      }

      let reward = null;
      try {
        const [rewardRows] = await conn.execute(
          `INSERT INTO creator_rewards (actor_id, points, published_count, guide_count)
           VALUES (?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE
             points = points + VALUES(points),
             published_count = published_count + 1,
             guide_count = guide_count + VALUES(guide_count)`,
          [safeText(actorId, 64), rewardInput.earnedPoints, rewardInput.guide ? 1 : 0]
        );
        const [totalRows] = await conn.execute(
          "SELECT points, published_count, guide_count FROM creator_rewards WHERE actor_id = ? LIMIT 1",
          [safeText(actorId, 64)]
        );
        const total = totalRows[0] || {};
        reward = {
          earnedPoints: rewardInput.earnedPoints,
          points: Number(total.points || 0),
          publishedCount: Number(total.published_count || 0),
          guideCount: Number(total.guide_count || 0),
          guide: rewardInput.guide,
        };
      } catch (rewardError) {
        console.warn(`[reward] record skipped: ${rewardError?.message || "unknown error"}`);
      }

      return { postId, reward };
  });

  await invalidateAllPostsCaches();
  const postId = typeof result === "object" ? result.postId : result;
  const detail = await query("SELECT p.* FROM posts p WHERE p.id = ?", [postId]);
  const normalized = (await loadPostMeta(detail))[0];
  return { ok: true, post: normalized, reward: result?.reward || null };
}

async function updatePostHandler(req) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    throw Object.assign(new Error("invalid post id"), { status: 400 });
  }

  const body = req.body || {};
  const actor = readActorId(req, body);
  const existingRows = await query("SELECT * FROM posts WHERE id = ? LIMIT 1", [postId]);
  const existing = existingRows[0];
  if (!existing) throw Object.assign(new Error("post not found"), { status: 404 });
  if (String(existing.author_id || "") !== String(actor || "")) {
    throw Object.assign(new Error("only the author can edit this post"), { status: 403 });
  }
  if (existing.status !== "published") {
    throw Object.assign(new Error("post is not publicly published"), { status: 409 });
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const title = has("title") ? (safeText(body.title, 200) || "出片记录") : (existing.title || "出片记录");
  const content = has("content") ? safeText(body.content, 3000) : (existing.content || "");
  const spotId = has("spotId") ? (pickInt(body.spotId, 0) || null) : existing.spot_id;
  const spotName = has("spotName") ? safeText(body.spotName || "", 80) : (existing.spot_name || "");
  const district = has("district") ? safeText(body.district || "", 64) : (existing.district || "");
  const latitude = has("latitude")
    ? (String(body.latitude ?? "").trim() ? pickFloat(body.latitude, null, { min: -90, max: 90 }) : null)
    : existing.latitude;
  const longitude = has("longitude")
    ? (String(body.longitude ?? "").trim() ? pickFloat(body.longitude, null, { min: -180, max: 180 }) : null)
    : existing.longitude;
  const direction = has("direction") ? safeText(body.direction || "", 80) : (existing.direction || "");
  const angle = has("angle") ? safeText(body.angle || "", 80) : (existing.angle || "");
  const timeWindow = has("timeWindow") ? safeText(body.timeWindow || "", 80) : (existing.time_window || "");
  const bestTime = has("bestTime")
    ? (["day", "golden", "night"].includes(String(body.bestTime || "")) ? body.bestTime : null)
    : (existing.best_time || null);
  let shotAt = existing.shot_at;
  if (has("shotAt")) {
    shotAt = null;
    if (body.shotAt) {
      const parsed = new Date(body.shotAt);
      if (!Number.isNaN(parsed.getTime())) shotAt = parsed.toISOString().slice(0, 19).replace("T", " ");
    }
  }
  const camera = has("camera") ? safeText(body.camera || "", 80) : (existing.camera || "");
  const lens = has("lens") ? safeText(body.lens || "", 80) : (existing.lens || "");
  const focalLength = has("focalLength") ? safeText(body.focalLength || "", 40) : (existing.focal_length || "");
  const aperture = has("aperture") ? safeText(body.aperture || "", 24) : (existing.aperture || "");
  const shutter = has("shutter") ? safeText(body.shutter || "", 24) : (existing.shutter || "");
  const iso = has("iso") ? safeText(body.iso || "", 24) : (existing.iso || "");
  const whiteBalance = has("whiteBalance")
    ? safeText(body.whiteBalance || "", 40)
    : (existing.white_balance || "");

  await query(
    `UPDATE posts SET
       title = ?, content = ?, spot_id = ?, spot_name = ?, district = ?, latitude = ?, longitude = ?,
       direction = ?, angle = ?, time_window = ?, best_time = ?, shot_at = ?, camera = ?, lens = ?,
       focal_length = ?, aperture = ?, shutter = ?, iso = ?, white_balance = ?
     WHERE id = ? AND author_id = ? AND status = 'published'`,
    [
      title,
      content,
      spotId,
      spotName,
      district,
      latitude,
      longitude,
      direction,
      angle,
      timeWindow,
      bestTime,
      shotAt,
      camera,
      lens,
      focalLength,
      aperture,
      shutter,
      iso,
      whiteBalance,
      postId,
      actor,
    ],
  );

  const mediaCountRows = await query("SELECT COUNT(*) AS c FROM post_media WHERE post_id = ?", [postId]);
  const guideInput = calculateCreatorReward({
    content,
    angle,
    direction,
    timeWindow,
    shotAt,
    camera,
    lens,
    focalLength,
    aperture,
    shutter,
    iso,
    whiteBalance,
    latitude,
    longitude,
    media: new Array(Number(mediaCountRows[0]?.c || 0)).fill({}),
  });
  let reward = null;
  if (guideInput.guide) {
    try {
      reward = await tx(async (conn) => {
        const [marked] = await conn.execute(
          `UPDATE posts
           SET guide_rewarded = 1
           WHERE id = ? AND author_id = ? AND status = 'published' AND guide_rewarded = 0`,
          [postId, actor],
        );
        if (marked.affectedRows !== 1) return null;
        await conn.execute(
          `INSERT INTO creator_rewards (actor_id, points, published_count, guide_count)
           VALUES (?, 15, 0, 1)
           ON DUPLICATE KEY UPDATE
             points = points + 15,
             guide_count = guide_count + 1`,
          [safeText(actor, 64)],
        );
        return { earnedPoints: 15, guide: true };
      });
    } catch (rewardError) {
      console.warn(`[reward] edit guide reward skipped: ${rewardError?.message || "unknown error"}`);
    }
  }

  await invalidateAllPostsCaches();
  await invalidatePostCaches(postId);
  const detail = await query("SELECT p.* FROM posts p WHERE p.id = ?", [postId]);
  const normalized = (await loadPostMeta(detail, { actor }))[0];
  return { ok: true, post: normalized, reward };
}

async function applyActionOnPost({ postId, action, actor, actorName, actorAvatar = '', kind }) {
  const isLike = kind === "like";
  const actionTable = isLike ? "post_likes" : "post_favorites";
  const countColumn = isLike ? "stats_likes" : "stats_favorites";
  const normalizedAction = String(action || "toggle");
  const allowedActions = isLike
    ? ["toggle", "like", "unlike"]
    : ["toggle", "favorite", "unfavorite"];

  if (!allowedActions.includes(normalizedAction)) {
    const actionErr = new Error(`invalid action: ${normalizedAction}`);
    actionErr.status = 400;
    throw actionErr;
  }

  return tx(async (conn) => {
    const [postRows] = await conn.execute("SELECT id, author_id, title FROM posts WHERE id = ?", [postId]);
    if (!postRows.length) throw new Error("post not found");
    const post = postRows[0];

    const [existsRows] = await conn.execute(
      `SELECT EXISTS(SELECT 1 FROM ${actionTable} WHERE post_id = ? AND actor_id = ?) AS exist`,
      [postId, actor]
    );
    const existed = Boolean(Number(existsRows?.[0]?.exist || 0));

    let targetActive;
    if (normalizedAction === "toggle") {
      targetActive = !existed;
    } else {
      targetActive = normalizedAction === "like" || normalizedAction === "favorite";
    }

    if (targetActive && !existed) {
      const [insertResult] = await conn.execute(
        `INSERT IGNORE INTO ${actionTable} (post_id, actor_id, actor_name) VALUES (?, ?, ?)`,
        [postId, actor, actorName]
      );
      if (insertResult.affectedRows === 1) {
        await conn.execute(`UPDATE posts SET ${countColumn} = ${countColumn} + 1 WHERE id = ?`, [postId]);
        await insertNotification(conn, {
          recipientId: post.author_id,
          actorId: actor,
          actorName,
          actorAvatar,
          type: isLike ? "like" : "favorite",
          postId,
          postTitle: post.title,
          content: isLike ? "赞了你的出片" : "收藏了你的出片",
        });
      }
    }

    if (!targetActive && existed) {
      const [deleteResult] = await conn.execute(
        `DELETE FROM ${actionTable} WHERE post_id = ? AND actor_id = ?`,
        [postId, actor]
      );
      if (deleteResult.affectedRows === 1) {
        await conn.execute(
          `UPDATE posts SET ${countColumn} = GREATEST(${countColumn} - 1, 0) WHERE id = ?`,
          [postId]
        );
      }
    }

    const [updated] = await conn.execute(`SELECT ${countColumn} AS c FROM posts WHERE id = ?`, [postId]);
    const [state] = await conn.execute(
      `SELECT EXISTS(SELECT 1 FROM ${actionTable} WHERE post_id = ? AND actor_id = ?) AS active`,
      [postId, actor]
    );

    return {
      count: Number(updated[0]?.c || 0),
      active: Boolean(Number(state?.[0]?.active || 0)),
    };
  });
}

async function createCommentHandler(req) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    const err = new Error("invalid post id");
    err.status = 400;
    throw err;
  }
  const text = safeText(req.body?.text || req.body?.content || "", 500);
  if (!text) {
    const err = new Error("comment required");
    err.status = 400;
    throw err;
  }

  const actor = readActorId(req, req.body || {});
  const author = safeText(req.body?.author || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const [exists] = await query("SELECT id, author_id, title FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) {
    const err = new Error("post not found");
    err.status = 404;
    throw err;
  }

  const result = await tx(async (conn) => {
    const [insertResult] = await conn.execute(
      "INSERT INTO post_comments (post_id, actor_id, actor_name, actor_avatar, content) VALUES (?, ?, ?, ?, ?)",
      [postId, actor, author, actorAvatar, text]
    );
    await insertNotification(conn, {
      recipientId: exists.author_id,
      actorId: actor,
      actorName: author,
      actorAvatar,
      type: "comment",
      postId,
      postTitle: exists.title,
      content: `评论了你的出片：${text}`,
    });
    return insertResult;
  });
  await invalidatePostCaches(postId);
  const insertedId = Number(result?.insertId || 0);
  const [insertedComment] = insertedId
    ? await query("SELECT created_at FROM post_comments WHERE id = ?", [insertedId])
    : [{ created_at: new Date().toISOString() }];
  return {
    ok: true,
    comment: {
      id: insertedId || null,
      postId,
      actorName: author,
      avatar: actorAvatar,
      text,
      createdAt: insertedComment?.created_at || new Date().toISOString(),
    },
  };
}

const REPORT_REASONS = new Set(["misleading", "copyright", "unsafe", "spam", "other"]);

async function createPostReportHandler(req) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    throw Object.assign(new Error("invalid post id"), { status: 400 });
  }
  const actor = readActorId(req, req.body || {});
  const reason = String(req.body?.reason || "").trim().toLowerCase();
  if (!REPORT_REASONS.has(reason)) {
    throw Object.assign(new Error("invalid report reason"), { status: 400 });
  }
  const details = safeText(req.body?.details || "", 500);

  return tx(async (conn) => {
    const [postRows] = await conn.execute(
      "SELECT id, author_id FROM posts WHERE id = ? AND status = 'published'",
      [postId]
    );
    if (!postRows.length) throw Object.assign(new Error("post not found"), { status: 404 });
    if (String(postRows[0].author_id || "") === String(actor)) {
      throw Object.assign(new Error("cannot report your own post"), { status: 400 });
    }
    const [result] = await conn.execute(
      `INSERT IGNORE INTO post_reports (post_id, reporter_id, reason, details)
       VALUES (?, ?, ?, ?)`,
      [postId, actor, reason, details]
    );
    return {
      reported: true,
      duplicate: result.affectedRows !== 1,
      postId,
      reason,
    };
  });
}

function createErrorHandler(err, req, res, _next) {
  const requestId = req?.requestId;
  if (Number.isInteger(err?.status)) {
    return res.status(err.status).json({
      error: err.message || "bad request",
      requestId,
    });
  }
  if (err?.message === "Unsupported file type") {
    return res.status(415).json({ error: "Unsupported file type", requestId });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload too large", requestId });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file too large", requestId });
  }
  return res.status(500).json({
    error: err?.message || "internal error",
    requestId,
  });
}

const healthHandler = async (_req, res) => {
  const startedAt = Date.now();
  const dependencyChecks = await Promise.allSettled([
    query("SELECT 1 AS ok"),
    pingCache(),
  ]);

  const dbCheck = dependencyChecks[0];
  const cacheCheck = dependencyChecks[1];

  const dependencies = {
    database: {
      ok: dbCheck.status === "fulfilled",
      latencyMs: Date.now() - startedAt,
    },
    redis: {
      ok: cacheCheck.status === "fulfilled" ? !!cacheCheck.value : false,
    },
  };

  if (dbCheck.status === "rejected") {
    dependencies.database.error = String(dbCheck.reason?.message || dbCheck.reason || "unknown");
  }
  if (cacheCheck.status === "rejected" || cacheCheck.value === false) {
    dependencies.redis.error = cacheCheck.status === "rejected"
      ? String(cacheCheck.reason?.message || cacheCheck.reason || "unknown")
      : "redis ping failed";
  }

  const allHealthy = dependencies.database.ok && dependencies.redis.ok;
  res.status(allHealthy ? 200 : 503).json({
    ok: allHealthy,
    service: "chupian-service",
    now: new Date().toISOString(),
    dependencies,
  });
};
function weatherCodeLabel(code) {
  const normalized = Number(code);
  if (normalized === 0) return "晴朗";
  if ([1, 2].includes(normalized)) return "晴间多云";
  if (normalized === 3) return "多云";
  if ([45, 48].includes(normalized)) return "有雾";
  if ([51, 53, 55, 56, 57].includes(normalized)) return "毛毛雨";
  if ([61, 63, 65, 66, 67].includes(normalized)) return "有雨";
  if ([71, 73, 75, 77].includes(normalized)) return "降雪";
  if ([80, 81, 82].includes(normalized)) return "阵雨";
  if ([85, 86].includes(normalized)) return "阵雪";
  if ([95, 96, 99].includes(normalized)) return "雷雨";
  return "天气状况未知";
}

const weatherHandler = async (req, res) => {
  const latitude = pickFloat(req.query.lat, null, { min: -90, max: 90 });
  const longitude = pickFloat(req.query.lng, null, { min: -180, max: 180 });
  if (latitude === null || longitude === null) {
    return res.status(400).json({ ok: false, error: "weather location required" });
  }

  const cacheKey = `weather:current:v1:${latitude.toFixed(2)}:${longitude.toFixed(2)}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
    timezone: "auto",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_LOOKUP_TIMEOUT_MS);
  try {
    const upstream = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "chupian-weather/1.0" },
      signal: controller.signal,
    });
    if (!upstream.ok) return res.status(503).json({ ok: false, error: "weather unavailable" });
    const data = await upstream.json();
    const current = data?.current || {};
    const temp = Number(current.temperature_2m);
    const feelsLike = Number(current.apparent_temperature);
    const humidity = Number(current.relative_humidity_2m);
    const wind = Number(current.wind_speed_10m);
    const weatherCode = Number(current.weather_code);
    if (![temp, feelsLike, humidity, wind, weatherCode].every(Number.isFinite)) {
      return res.status(503).json({ ok: false, error: "weather unavailable" });
    }
    const payload = {
      ok: true,
      temp,
      feelsLike,
      humidity,
      wind,
      weatherCode,
      label: weatherCodeLabel(weatherCode),
      location: safeText(req.query.label || "当前位置", 80),
      source: "open-meteo",
      updatedAt: new Date().toISOString(),
    };
    await cacheSetJson(cacheKey, payload, WEATHER_CACHE_TTL_SECONDS);
    return res.json(payload);
  } catch (_err) {
    return res.status(503).json({ ok: false, error: "weather unavailable" });
  } finally {
    clearTimeout(timeout);
  }
};
app.get("/health", healthHandler);
app.get("/api/v1/health", healthHandler);
app.get("/api/v1/system/health", healthHandler);
app.get("/api/weather", weatherHandler);
app.get("/api/v1/weather", weatherHandler);

function publicUser(row) {
  return {
    id: String(row?.id || ""),
    username: String(row?.username || ""),
    displayName: String(row?.display_name || row?.username || ""),
    bio: String(row?.bio || ""),
    avatar: String(row?.avatar_url || ""),
  };
}

function parseAuthCredentials(body = {}, { registration = false } = {}) {
  const username = safeText(body.username, 32).toLowerCase();
  const password = String(body.password || "");
  const displayName = safeText(body.displayName || username, 64);
  if (!/^[a-z0-9_\u4e00-\u9fff-]{3,32}$/iu.test(username)) {
    throw Object.assign(new Error("用户名需为 3-32 位中文、字母、数字、下划线或短横线"), { status: 400 });
  }
  if (password.length < 8 || password.length > 128) {
    throw Object.assign(new Error("密码需为 8-128 位"), { status: 400 });
  }
  if (registration && (displayName.length < 1 || displayName.length > 64)) {
    throw Object.assign(new Error("昵称长度不合法"), { status: 400 });
  }
  return { username, password, displayName };
}

function authResponse(row, now = Math.floor(Date.now() / 1000)) {
  return {
    user: publicUser(row),
    token: signUserSession(row.id, now),
    expiresAt: new Date((now + ACTOR_SESSION_TTL_SECONDS) * 1000).toISOString(),
  };
}

async function transferAnonymousActor(conn, fromActorId, user) {
  if (!fromActorId) return;
  const targetActorId = actorHash(user.id);
  const actorName = safeText(user.display_name || "匿名拍友", 80);
  const actorAvatar = safeText(user.avatar_url || "", 500);

  // Merge duplicate reactions before changing the actor key. This keeps account
  // creation safe when the anonymous session and the account touched the same post.
  await conn.execute(
    `DELETE source
     FROM post_likes source
     INNER JOIN post_likes target
       ON target.post_id = source.post_id AND target.actor_id = ?
     WHERE source.actor_id = ?`,
    [targetActorId, fromActorId]
  );
  await conn.execute(
    `DELETE source
     FROM post_favorites source
     INNER JOIN post_favorites target
       ON target.post_id = source.post_id AND target.actor_id = ?
     WHERE source.actor_id = ?`,
    [targetActorId, fromActorId]
  );
  await conn.execute(
    `DELETE source
     FROM author_follows source
     INNER JOIN author_follows target
       ON target.followed_id = source.followed_id AND target.follower_id = ?
     WHERE source.follower_id = ?`,
    [targetActorId, fromActorId]
  );
  await conn.execute(
    `DELETE source
     FROM author_follows source
     INNER JOIN author_follows target
       ON target.follower_id = source.follower_id AND target.followed_id = ?
     WHERE source.followed_id = ?`,
    [targetActorId, fromActorId]
  );

  await conn.execute(
    "UPDATE posts SET author_id = ?, author_name = ?, author_avatar = ? WHERE author_id = ?",
    [targetActorId, actorName, actorAvatar, fromActorId]
  );
  await conn.execute(
    "UPDATE post_likes SET actor_id = ?, actor_name = ? WHERE actor_id = ?",
    [targetActorId, actorName, fromActorId]
  );
  await conn.execute(
    "UPDATE post_favorites SET actor_id = ?, actor_name = ? WHERE actor_id = ?",
    [targetActorId, actorName, fromActorId]
  );
  await conn.execute(
    "UPDATE post_comments SET actor_id = ?, actor_name = ?, actor_avatar = ? WHERE actor_id = ?",
    [targetActorId, actorName, actorAvatar, fromActorId]
  );
  await conn.execute(
    "UPDATE author_follows SET follower_id = ?, actor_name = ? WHERE follower_id = ?",
    [targetActorId, actorName, fromActorId]
  );
  await conn.execute(
    "UPDATE author_follows SET followed_id = ? WHERE followed_id = ?",
    [targetActorId, fromActorId]
  );
  await conn.execute(
    "UPDATE notifications SET actor_id = ?, actor_name = ?, actor_avatar = ? WHERE actor_id = ?",
    [targetActorId, actorName, actorAvatar, fromActorId]
  );

  // Preserve creator progress when an anonymous contributor creates an account.
  await conn.execute(
    `INSERT INTO creator_rewards (actor_id, points, published_count, guide_count)
     SELECT ?, points, published_count, guide_count
     FROM creator_rewards
     WHERE actor_id = ?
     ON DUPLICATE KEY UPDATE
       points = points + VALUES(points),
       published_count = published_count + VALUES(published_count),
       guide_count = guide_count + VALUES(guide_count)`,
    [targetActorId, fromActorId]
  );
  await conn.execute("DELETE FROM creator_rewards WHERE actor_id = ?", [fromActorId]);
}

app.post("/api/v1/auth/anonymous", asyncHandler(async (_req, res) => {
  const actorId = `anon-${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  res.status(201).json({
    actorId,
    token: signActorSession(actorId, now),
    expiresAt: new Date((now + ACTOR_SESSION_TTL_SECONDS) * 1000).toISOString(),
  });
}));

app.post("/api/v1/auth/register", asyncHandler(async (req, res) => {
  const credentials = parseAuthCredentials(req.body, { registration: true });
  const user = {
    id: `usr-${randomUUID()}`,
    username: credentials.username,
    display_name: credentials.displayName,
    password_hash: await hashPassword(credentials.password),
    bio: "",
    avatar_url: "",
  };
  const anonymousActorId = readAnonymousActorId(req);
  try {
    await tx(async (conn) => {
      await conn.execute(
        `INSERT INTO users (id, username, display_name, password_hash, bio)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, user.username, user.display_name, user.password_hash, user.bio]
      );
      await transferAnonymousActor(conn, anonymousActorId, user);
    });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "用户名已存在" });
    }
    throw err;
  }
  await invalidateAllPostsCaches();
  return res.status(201).json(authResponse(user));
}));

app.post("/api/v1/auth/login", asyncHandler(async (req, res) => {
  const credentials = parseAuthCredentials(req.body);
  const rows = await query(
    "SELECT id, username, display_name, password_hash, bio, avatar_url FROM users WHERE username = ? LIMIT 1",
    [credentials.username]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(credentials.password, user.password_hash))) {
    return res.status(401).json({ error: "用户名或密码不正确" });
  }
  return res.json(authResponse(user));
}));

app.get("/api/v1/auth/me", asyncHandler(async (req, res) => {
  const userId = readUserSession(req);
  if (!userId) return res.status(401).json({ error: "login required" });
  const rows = await query(
    "SELECT id, username, display_name, bio, avatar_url FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) return res.status(401).json({ error: "account not found" });
  return res.json({ user: publicUser(rows[0]) });
}));

app.patch("/api/v1/auth/me", asyncHandler(async (req, res) => {
  const userId = readUserSession(req);
  if (!userId) return res.status(401).json({ error: "login required" });
  const displayName = safeText(req.body?.displayName || req.body?.name || "", 64).trim();
  const bio = safeText(req.body?.bio || "", 160).trim();
  const hasAvatar = Object.prototype.hasOwnProperty.call(req.body || {}, "avatar");
  const avatar = hasAvatar ? safeText(req.body?.avatar || "", 500).trim() : null;
  if (!displayName) throw Object.assign(new Error("昵称不能为空"), { status: 400 });

  const updated = await tx(async (conn) => {
    const [userRows] = await conn.execute(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!userRows.length) throw Object.assign(new Error("account not found"), { status: 401 });

    if (hasAvatar) {
      await conn.execute(
        "UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?",
        [displayName, bio, avatar, userId]
      );
    } else {
      await conn.execute(
        "UPDATE users SET display_name = ?, bio = ? WHERE id = ?",
        [displayName, bio, userId]
      );
    }

    const actorId = actorHash(userId);
    if (hasAvatar) {
      await conn.execute(
        "UPDATE posts SET author_name = ?, author_bio = ?, author_avatar = ? WHERE author_id = ?",
        [displayName, bio, avatar, actorId]
      );
      await conn.execute(
        "UPDATE post_comments SET actor_name = ?, actor_avatar = ? WHERE actor_id = ?",
        [displayName, avatar, actorId]
      );
      await conn.execute(
        "UPDATE notifications SET actor_name = ?, actor_avatar = ? WHERE actor_id = ?",
        [displayName, avatar, actorId]
      );
    } else {
      await conn.execute(
        "UPDATE posts SET author_name = ?, author_bio = ? WHERE author_id = ?",
        [displayName, bio, actorId]
      );
      await conn.execute(
        "UPDATE post_comments SET actor_name = ? WHERE actor_id = ?",
        [displayName, actorId]
      );
      await conn.execute(
        "UPDATE notifications SET actor_name = ? WHERE actor_id = ?",
        [displayName, actorId]
      );
    }
    await conn.execute(
      "UPDATE author_follows SET actor_name = ? WHERE follower_id = ?",
      [displayName, actorId]
    );
    const [rows] = await conn.execute(
      "SELECT id, username, display_name, bio, avatar_url FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    return rows[0];
  });

  await invalidateAllPostsCaches();
  return res.json({ user: publicUser(updated) });
}));

app.post("/api/v1/auth/logout", asyncHandler(async (_req, res) => {
  return res.json({ ok: true });
}));

async function spotsHandler(req, res) {
  const latitude = pickFloat(req.query.lat, null, { min: -90, max: 90 });
  const longitude = pickFloat(req.query.lng, null, { min: -180, max: 180 });
  const hasLocation = latitude !== null && longitude !== null;
  const radiusKm = pickFloat(req.query.radius, 50, { min: 1, max: 50 });
  const limit = pickInt(req.query.limit, 80, { min: 1, max: 80 });
  const cacheKey = hasLocation
    ? `spots:list:v3:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${radiusKm.toFixed(1)}:${limit}`
    : `spots:list:v3:all:${limit}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const candidateLimit = Math.min(Math.max(limit * 4, limit), 320);
  const spotRows = hasLocation
    ? await query(
      `SELECT * FROM spots
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND latitude BETWEEN ? AND ?
         AND longitude BETWEEN ? AND ?
       ORDER BY POW(latitude - ?, 2) + POW(longitude - ?, 2), id
       LIMIT ?`,
      [
        Math.max(-90, latitude - radiusKm / 110.574),
        Math.min(90, latitude + radiusKm / 110.574),
        Math.max(-180, longitude - radiusKm / (111.320 * Math.max(Math.abs(Math.cos((latitude * Math.PI) / 180)), 0.15))),
        Math.min(180, longitude + radiusKm / (111.320 * Math.max(Math.abs(Math.cos((latitude * Math.PI) / 180)), 0.15))),
        latitude,
        longitude,
        candidateLimit,
      ],
    )
    : await query("SELECT * FROM spots ORDER BY name LIMIT ?", [limit]);
  const normalizedSpots = spotRows.map(normalizeSpotRow);
  const spots = hasLocation
    ? normalizedSpots
      .map((spot) => ({
        ...spot,
        distanceKm: mapDistanceKm(latitude, longitude, spot.lat, spot.lng),
      }))
      .filter((spot) => Number.isFinite(spot.distanceKm) && spot.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit)
      .map((spot) => ({ ...spot, distanceKm: Number(spot.distanceKm.toFixed(1)) }))
    : normalizedSpots;
  const payload = {
    spots,
    ...(hasLocation ? { center: { lat: latitude, lng: longitude }, radiusKm } : {}),
  };
  await cacheSetJson(cacheKey, payload, SPOT_CACHE_TTL_SECONDS);
  return res.json(payload);
}

function normalizeSpotRow(row = {}) {
  return {
    ...row,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    tags: safeJsonList(row.tags),
    styles: safeJsonList(row.styles),
  };
}

async function spotHandler(req, res) {
  const spotId = pickInt(req.params.id, 0);
  if (!spotId) return res.status(400).json({ error: "valid spot id is required" });
  const cacheKey = `spot:detail:v1:${spotId}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const rows = await query("SELECT * FROM spots WHERE id = ? LIMIT 1", [spotId]);
  if (!rows.length) return res.status(404).json({ error: "spot not found" });
  const payload = { spot: normalizeSpotRow(rows[0]) };
  await cacheSetJson(cacheKey, payload, SPOT_CACHE_TTL_SECONDS);
  return res.json(payload);
}

function mapDistanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const originLat = toRadians(lat1);
  const targetLat = toRadians(lat2);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(originLat) * Math.cos(targetLat) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1 - a, 0)));
}

async function mapHandler(req, res) {
  const actor = readActorId(req, req.query);
  const latitude = pickFloat(req.query.lat, null, { min: -90, max: 90 });
  const longitude = pickFloat(req.query.lng, null, { min: -180, max: 180 });
  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: "valid lat and lng are required" });
  }

  const radiusKm = pickFloat(req.query.radius, 35, { min: 1, max: 50 });
  const limit = pickInt(req.query.limit, 60, { min: 1, max: 80 });
  const cacheKey = `map:v2:${actor || "guest"}:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${radiusKm}:${limit}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const latitudeDelta = radiusKm / 110.574;
  const longitudeDelta = radiusKm / (111.320 * Math.max(Math.abs(Math.cos((latitude * Math.PI) / 180)), 0.15));
  const minLatitude = Math.max(-90, latitude - latitudeDelta);
  const maxLatitude = Math.min(90, latitude + latitudeDelta);
  const minLongitude = Math.max(-180, longitude - longitudeDelta);
  const maxLongitude = Math.min(180, longitude + longitudeDelta);
  const candidateLimit = Math.min(limit * 3, 240);

  const [spotRows, postRows] = await Promise.all([
    query(
      `SELECT id, name, district, latitude, longitude
       FROM spots
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND latitude BETWEEN ? AND ?
         AND longitude BETWEEN ? AND ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      [minLatitude, maxLatitude, minLongitude, maxLongitude, candidateLimit]
    ),
    query(
      `SELECT id, title, spot_name, district, latitude, longitude, cover_url, created_at
       FROM posts
       WHERE status = 'published'
         AND (author_id = ? OR NOT EXISTS (
           SELECT 1 FROM blocked_authors b
           WHERE b.blocker_id = ? AND b.blocked_id = posts.author_id
         ))
         AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND latitude BETWEEN ? AND ?
         AND longitude BETWEEN ? AND ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      [actor, actor, minLatitude, maxLatitude, minLongitude, maxLongitude, candidateLimit]
    ),
  ]);

  const toMarker = (row, type) => {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    return {
      id: String(row.id),
      type,
      name: type === "spot" ? String(row.name || "出片点位") : String(row.title || "出片帖子"),
      spotName: String(row.spot_name || ""),
      district: String(row.district || ""),
      lat,
      lng,
      cover: String(row.cover_url || ""),
      distanceKm: mapDistanceKm(latitude, longitude, lat, lng),
    };
  };
  const withinRadius = (item) => Number.isFinite(item.distanceKm) && item.distanceKm <= radiusKm;
  const spots = spotRows.map((row) => toMarker(row, "spot"))
    .filter(withinRadius)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map(({ distanceKm: _distanceKm, ...marker }) => marker);
  const posts = postRows.map((row) => toMarker(row, "post"))
    .filter(withinRadius)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map(({ distanceKm: _distanceKm, ...marker }) => marker);
  const payload = {
    center: { lat: latitude, lng: longitude },
    radiusKm,
    spots,
    posts,
  };
  await cacheSetJson(cacheKey, payload, 20);
  return res.json(payload);
}

app.get("/api/v1/spots", asyncHandler(spotsHandler));
app.get("/api/spots", asyncHandler(spotsHandler));
app.get("/api/v1/spots/:id", asyncHandler(spotHandler));
app.get("/api/spots/:id", asyncHandler(spotHandler));
app.get("/api/v1/location", asyncHandler(networkLocationHandler));
app.get("/api/location", asyncHandler(networkLocationHandler));
app.get("/api/v1/map", asyncHandler(mapHandler));
app.get("/api/map", asyncHandler(mapHandler));

app.get("/api/v1/community/feed", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const q = parseSearchText(req.query.q);
  const tag = parseSearchText(req.query.tag);
  const spotId = String(req.query.spotId || "").trim();
  const cacheKey = buildFeedCacheKey({
    actor,
    sort,
    limit,
    cursor,
    q,
    tag,
    spotId,
  });
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const payload = await fetchFeedRows({
    sort,
    cursor,
    limit,
    actorId: actor,
    q,
    tag,
    spotId,
  });
  await cacheSetJson(cacheKey, payload, 20);
  return res.json(payload);
}));
app.get("/api/v1/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const q = parseSearchText(req.query.q);
  const tag = parseSearchText(req.query.tag);
  const spotId = String(req.query.spotId || "").trim();
  const cacheKey = buildFeedCacheKey({ actor, sort, limit, cursor, q, tag, spotId });
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);
  const payload = await fetchFeedRows({
    sort,
    cursor,
    limit,
    actorId: actor,
    q,
    tag,
    spotId,
  });
  await cacheSetJson(cacheKey, payload, 20);
  return res.json(payload);
}));

app.get("/api/v1/community/discovery", asyncHandler(async (req, res) => {
  const limit = pickInt(req.query.limit, 16, { min: 1, max: 80 });
  const type = String(req.query.type || "").trim().toLowerCase();
  const signals = await fetchDiscoverySignals(limit);
  const filtered = type && ["tag", "style"].includes(type)
    ? signals.filter((signal) => signal.type === type)
    : signals;
  res.json({
    signals: filtered,
    meta: {
      type: type || "all",
      count: filtered.length,
      total: signals.length,
    },
  });
}));

app.get("/api/community/discovery", asyncHandler(async (req, res) => {
  const limit = pickInt(req.query.limit, 16, { min: 1, max: 80 });
  const type = String(req.query.type || "").trim().toLowerCase();
  const signals = await fetchDiscoverySignals(limit);
  const filtered = type && ["tag", "style"].includes(type)
    ? signals.filter((signal) => signal.type === type)
    : signals;
  res.json({
    signals: filtered,
    meta: {
      type: type || "all",
      count: filtered.length,
      total: signals.length,
    },
  });
}));

app.get("/api/v1/community/me/likes", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchActorFeedRows({
    table: "post_likes",
    actorId: actor,
    limit,
    cursor,
    sort,
  });
  res.json(payload);
}));

app.get("/api/v1/community/me/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchAuthorFeedRows({
    actorId: actor,
    limit,
    cursor,
    sort,
  });
  res.json(payload);
}));

async function mySpotCountHandler(req, res) {
  const actor = readActorId(req, req.query);
  const rows = await query(
    `SELECT COUNT(DISTINCT CASE
       WHEN p.spot_id IS NOT NULL THEN CONCAT('spot:', p.spot_id)
       WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL
         THEN CONCAT('coord:', ROUND(p.latitude, 4), ':', ROUND(p.longitude, 4))
       ELSE NULL
     END) AS c
     FROM posts p
     WHERE p.author_id = ? AND p.status = 'published'`,
    [actor]
  );
  return res.json({ count: Number(rows[0]?.c || 0) });
}

app.get("/api/v1/community/me/spot-count", asyncHandler(mySpotCountHandler));
app.get("/api/community/me/spot-count", asyncHandler(mySpotCountHandler));

app.get("/api/v1/community/me/rewards", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const rows = await query(
    "SELECT points, published_count, guide_count FROM creator_rewards WHERE actor_id = ? LIMIT 1",
    [actor]
  );
  const reward = rows[0] || {};
  return res.json({
    points: Number(reward.points || 0),
    publishedCount: Number(reward.published_count || 0),
    guideCount: Number(reward.guide_count || 0),
    nextGuidePoints: 15,
  });
}));

app.get("/api/v1/authors/:authorId/posts", asyncHandler(async (req, res) => {
  const viewerActorId = readActorId(req, req.query);
  const authorId = String(req.params.authorId || "").trim();
  if (!authorId) return res.status(400).json({ error: "author id required" });
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchAuthorFeedRows({
    actorId: viewerActorId,
    authorId,
    limit,
    cursor,
    sort,
  });
  res.json({ ...payload, authorId });
}));

app.get("/api/v1/community/me/favorites", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchActorFeedRows({
    table: "post_favorites",
    actorId: actor,
    limit,
    cursor,
    sort,
  });
  res.json(payload);
}));
app.get("/api/v1/community/me/following", asyncHandler(followingFeedHandler));

app.get("/api/v1/notifications", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const where = ["n.recipient_id = ?"];
  const params = [actor];
  if (cursor) {
    where.push("(n.created_at < ? OR (n.created_at = ? AND n.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const [rows, unreadRows] = await Promise.all([
    query(
      `SELECT n.id, n.type, n.actor_id, n.actor_name, n.actor_avatar, n.post_id, n.post_title,
              n.content, n.is_read, n.created_at
       FROM notifications n
       WHERE ${where.join(" AND ")}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`,
      [...params, limit + 1]
    ),
    query("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ? AND is_read = 0", [actor]),
  ]);
  const useRows = rows.slice(0, limit);
  const last = useRows.at(-1);
  return res.json({
    notifications: useRows.map((row) => ({
      id: row.id,
      type: row.type,
      actorId: row.actor_id,
      actorName: row.actor_name,
      avatar: row.actor_avatar || '',
      postId: row.post_id,
      postTitle: row.post_title,
      content: row.content,
      read: Boolean(Number(row.is_read || 0)),
      createdAt: row.created_at,
    })),
    unread: Number(unreadRows[0]?.c || 0),
    nextCursor: rows.length > limit && last ? makeCursor(last.created_at, last.id) : null,
    hasMore: rows.length > limit,
  });
}));

app.post("/api/v1/notifications/read-all", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const result = await query(
    "UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0",
    [actor]
  );
  return res.json({ ok: true, updated: Number(result?.affectedRows || 0) });
}));

app.post("/api/v1/notifications/:id/read", asyncHandler(async (req, res) => {
  const notificationId = Number(req.params.id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ error: "invalid notification id" });
  }
  const actor = readActorId(req, req.body || {});
  const result = await query(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?",
    [notificationId, actor]
  );
  if (result?.affectedRows !== 1) return res.status(404).json({ error: "notification not found" });
  return res.json({ ok: true, notificationId });
}));

app.get("/api/v1/authors/:authorId/follow", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const targetAuthorId = String(req.params.authorId || "").trim();
  if (!targetAuthorId) {
    return res.status(400).json({ error: "author id required" });
  }
  const state = await getFollowState(actor, targetAuthorId);
  res.json({
    ok: true,
    authorId: targetAuthorId,
    followed: state.isFollowing,
    followers: state.followers,
  });
}));

app.post("/api/v1/authors/:authorId/follow", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const targetAuthorId = String(req.params.authorId || "").trim();
  const action = String(req.body?.action || "toggle");
  const actorName = safeText(req.body?.author || req.body?.authorName || req.body?.name || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const idempotent = await runWithIdempotency({
    req,
    actor,
    scope: `author:${targetAuthorId}:follow`,
    handler: () => applyAuthorFollow({
      actor,
      actorName,
      actorAvatar,
      targetAuthorId,
      action,
    }),
    });
    if (idempotent.replay) res.setHeader("X-Idempotency-Replay", "1");
    const state = idempotent.payload;
    await cacheDel(`following:${actor}:*`);
    res.json({
      ok: true,
      authorId: targetAuthorId,
    followed: state.following,
    following: state.following,
    followers: state.followers,
    action,
  });
}));

app.get("/api/v1/authors/:authorId/block", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const targetAuthorId = String(req.params.authorId || "").trim();
  if (!targetAuthorId) return res.status(400).json({ error: "author id required" });
  const state = await getBlockState(actor, targetAuthorId);
  return res.json({ ok: true, authorId: targetAuthorId, blocked: state.blocked });
}));

app.post("/api/v1/authors/:authorId/block", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const targetAuthorId = String(req.params.authorId || "").trim();
  const action = String(req.body?.action || "toggle");
  const targetName = safeText(req.body?.author || req.body?.authorName || req.body?.name || "匿名拍友", 80);
  const idempotent = await runWithIdempotency({
    req,
    actor,
    scope: `author:${targetAuthorId}:block`,
    handler: () => applyAuthorBlock({ actor, targetAuthorId, targetName, action }),
  });
  if (idempotent.replay) res.setHeader("X-Idempotency-Replay", "1");
  await invalidateAllPostsCaches();
  return res.json({ ok: true, ...idempotent.payload, action });
}));

app.get("/api/v1/community/me/blocked", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const rows = await query(
    `SELECT blocked_id AS author_id, blocked_name AS author_name, created_at
     FROM blocked_authors
     WHERE blocker_id = ?
     ORDER BY created_at DESC
     LIMIT 80`,
    [actor]
  );
  return res.json({
    ok: true,
    authors: rows.map((row) => ({
      authorId: row.author_id,
      authorName: row.author_name || "匿名拍友",
      createdAt: row.created_at,
    })),
  });
}));

app.get("/api/community/me/following", asyncHandler(followingFeedHandler));

app.get("/api/community/authors/:authorId/follow", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const targetAuthorId = String(req.params.authorId || "").trim();
  if (!targetAuthorId) {
    return res.status(400).json({ error: "author id required" });
  }
  const state = await getFollowState(actor, targetAuthorId);
  res.json({
    ok: true,
    authorId: targetAuthorId,
    followed: state.isFollowing,
    followers: state.followers,
  });
}));

app.post("/api/community/authors/:authorId/follow", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const targetAuthorId = String(req.params.authorId || "").trim();
  const action = String(req.body?.action || "toggle");
  const actorName = safeText(req.body?.author || req.body?.authorName || req.body?.name || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const state = await applyAuthorFollow({
    actor,
    actorName,
    actorAvatar,
    targetAuthorId,
    action,
  });
  await cacheDel(`following:${actor}:*`);
  res.json({
    ok: true,
    authorId: targetAuthorId,
    followed: state.following,
    following: state.following,
    followers: state.followers,
    action,
  });
}));

app.get("/api/v1/posts/:id", asyncHandler(getPostHandler));
app.get("/share/post/:id", asyncHandler(sharePostHandler));
app.post("/api/v1/posts/:id/report", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const idempotent = await runWithIdempotency({
    req,
    actor,
    scope: `post:${req.params.id}:report`,
    handler: () => createPostReportHandler(req),
  });
  if (idempotent.replay) res.setHeader("X-Idempotency-Replay", "1");
  return res.json({ ok: true, ...idempotent.payload });
}));
app.patch("/api/v1/posts/:id", asyncHandler(async (req, res) => {
  return res.json(await updatePostHandler(req));
}));
app.delete("/api/v1/posts/:id", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ error: "invalid post id" });
  }

  const actor = readActorId(req, req.body || {});
  const result = await query(
    "UPDATE posts SET status = 'archived' WHERE id = ? AND author_id = ? AND status = 'published'",
    [postId, actor],
  );
  if (result.affectedRows !== 1) {
    const rows = await query("SELECT author_id, status FROM posts WHERE id = ? LIMIT 1", [postId]);
    if (!rows.length) return res.status(404).json({ error: "post not found" });
    if (String(rows[0].author_id || '') !== String(actor)) {
      return res.status(403).json({ error: "only the author can archive this post" });
    }
    return res.status(409).json({ error: "post is not publicly published" });
  }

  await invalidateAllPostsCaches();
  await invalidatePostCaches(postId);
  return res.json({ ok: true, postId, status: "archived" });
}));
app.get("/api/v1/posts/:id/comments", asyncHandler(async (req, res) => {
  const payload = await getPostCommentsPayload(req);
  return res.json(payload);
}));

app.post("/api/v1/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const result = await runWithIdempotency({
    req,
    actor,
    scope: "post:create",
    handler: () => createPostHandler(req),
  });
  if (result.replay) {
    res.setHeader("X-Idempotency-Replay", "1");
  }
  return res.json(result.payload);
}));

app.post("/api/v1/posts/:id/like", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const action = String(req.body?.action || "toggle");
  const idempotent = await runWithIdempotency({
    req,
    actor,
    scope: `post:${postId}:like`,
    handler: () => applyActionOnPost({
      postId,
      action,
      actor,
      actorName,
      actorAvatar,
      kind: "like",
    }),
  });
  if (idempotent.replay) res.setHeader("X-Idempotency-Replay", "1");
  const result = idempotent.payload;
  await invalidatePostCaches(postId);
  return res.json({ ok: true, likes: result.count, liked: result.active });
}));

app.post("/api/v1/posts/:id/favorite", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const action = String(req.body?.action || "toggle");
  const idempotent = await runWithIdempotency({
    req,
    actor,
    scope: `post:${postId}:favorite`,
    handler: () => applyActionOnPost({
      postId,
      action,
      actor,
      actorName,
      actorAvatar,
      kind: "favorite",
    }),
  });
  if (idempotent.replay) res.setHeader("X-Idempotency-Replay", "1");
  const result = idempotent.payload;
  await invalidatePostCaches(postId);
  return res.json({ ok: true, favorites: result.count, favorited: result.active });
}));

app.post("/api/v1/posts/:id/comments", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  const actor = readActorId(req, req.body || {});
  const result = await runWithIdempotency({
    req,
    actor,
    scope: `post:${postId}:comment`,
    handler: () => createCommentHandler(req),
  });
  if (result.replay) {
    res.setHeader("X-Idempotency-Replay", "1");
  }
  return res.json(result.payload);
}));
app.post("/api/v1/posts/:id/comment", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  const actor = readActorId(req, req.body || {});
  const result = await runWithIdempotency({
    req,
    actor,
    scope: `post:${postId}:comment`,
    handler: () => createCommentHandler(req),
  });
  if (result.replay) {
    res.setHeader("X-Idempotency-Replay", "1");
  }
  return res.json(result.payload);
}));

app.post("/api/v1/media/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: "file required" });

    const actor = readActorId(req, req.body || {});
    const filePath = req.file.path;

    runWithIdempotency({
      req,
      actor,
      scope: "media:upload",
      handler: async () => ({
        ok: true,
        media: [{
          kind: req.file.mimetype?.startsWith("video/") ? "video" : "image",
          url: await persistMediaFile(req, req.file),
          duration: 0,
        }],
      }),
    }).then(async (result) => {
      if (result.replay) {
        await fs.promises.unlink(filePath).catch(() => {});
      }
      if (result.replay) res.setHeader("X-Idempotency-Replay", "1");
      return res.json(result.payload);
    }).catch(async (uploadError) => {
      await fs.promises.unlink(filePath).catch(() => {});
      return next(uploadError);
    });
  });
});

// legacy compatibility
app.get("/api/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const q = parseSearchText(req.query.q);
  const tag = parseSearchText(req.query.tag);
  const spotId = String(req.query.spotId || "").trim();
  const cacheKey = buildFeedCacheKey({ actor, sort, limit, cursor, q, tag, spotId });
  const cached = await cacheGetJson(cacheKey);
  if (cached) {
    return res.json({
      ...cached,
      stats: cached.stats || { totalPosts: cached.total },
    });
  }
  const payload = await fetchFeedRows({
    sort,
    cursor,
    limit,
    actorId: actor,
    q,
    tag,
    spotId,
  });
  await cacheSetJson(cacheKey, payload, 20);
  return res.json({
    ...payload,
    stats: payload.stats || { totalPosts: payload.total },
  });
}));
app.get("/api/posts/:id", asyncHandler(getPostHandler));
app.patch("/api/posts/:id", asyncHandler(async (req, res) => {
  return res.json(await updatePostHandler(req));
}));
app.get("/api/posts/:id/comments", asyncHandler(async (req, res) => {
  const payload = await getPostCommentsPayload(req);
  return res.json(payload);
}));
app.post("/api/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.body || {});
  const result = await runWithIdempotency({
    req,
    actor,
    scope: "post:create",
    handler: () => createPostHandler(req),
  });
  if (result.replay) {
    res.setHeader("X-Idempotency-Replay", "1");
  }
  return res.json(result.payload);
}));
app.post("/api/posts/:id/like", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const action = String(req.body?.action || "toggle");
  const result = await applyActionOnPost({
    postId,
    action,
    actor,
    actorName,
    actorAvatar,
    kind: "like",
  });
  await invalidatePostCaches(postId);
  return res.json({ ok: true, likes: result.count, liked: result.active });
}));
app.post("/api/posts/:id/comment", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  const actor = readActorId(req, req.body || {});
  const result = await runWithIdempotency({
    req,
    actor,
    scope: `post:${postId}:comment`,
    handler: () => createCommentHandler(req),
  });
  if (result.replay) {
    res.setHeader("X-Idempotency-Replay", "1");
  }
  return res.json(result.payload);
}));
app.post("/api/posts/:id/favorite", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);
  const actorAvatar = safeText(req.body?.avatar || "", 500);
  const action = String(req.body?.action || "toggle");
  const result = await applyActionOnPost({
    postId,
    action,
    actor,
    actorName,
    actorAvatar,
    kind: "favorite",
  });
  await invalidatePostCaches(postId);
  return res.json({ ok: true, favorites: result.count, favorited: result.active });
}));
app.post("/api/posts/:id/comments", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  const actor = readActorId(req, req.body || {});
  const result = await runWithIdempotency({
    req,
    actor,
    scope: `post:${postId}:comment`,
    handler: () => createCommentHandler(req),
  });
  if (result.replay) {
    res.setHeader("X-Idempotency-Replay", "1");
  }
  return res.json(result.payload);
}));

app.use(createErrorHandler);

await ensurePostsSchemaCompatibility();
await ensureMapSchemaCompatibility();
await ensureFollowSchemaCompatibility();
await ensureAuthSchemaCompatibility();
await ensureNotificationSchemaCompatibility();
await ensureCommentSchemaCompatibility();
await ensureReportSchemaCompatibility();
await ensureBlockSchemaCompatibility();
await ensureCreatorRewardSchemaCompatibility();
await ensureGuideRewardSchemaCompatibility();

let server;
let isShuttingDown = false;

function createSafePromise(timeoutMs, promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(resolve, timeoutMs, false);
    }),
  ]);
}

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] ${signal || "manual"} received`);

  if (server) {
    await createSafePromise(
      6000,
      new Promise((resolve) => {
        server.close(() => {
          resolve(true);
        });
      })
    );
  }

  await Promise.all([
    closeDb(),
    closeCache(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

server = app.listen(Number(PORT), () => {
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  console.log(`chupian service running on http://0.0.0.0:${PORT}`);
});
