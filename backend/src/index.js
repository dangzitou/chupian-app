import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import multer from "multer";
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
} = process.env;

const SPOT_CACHE_TTL_SECONDS = Number.parseInt(SPOT_CACHE_TTL, 10) || 90;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = Number.parseInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || "65000", 10) || 65000;
const HTTP_HEADERS_TIMEOUT_MS = Number.parseInt(process.env.HTTP_HEADERS_TIMEOUT_MS || "20000", 10) || 20000;
const HTTP_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || "180000", 10) || 180000;
const IDEMPOTENCY_TTL_SECONDS = Number.parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || "3600", 10) || 3600;
const IDEMPOTENCY_LOCK_SECONDS = Number.parseInt(process.env.IDEMPOTENCY_LOCK_SECONDS || "60", 10) || 60;
const API_RATE_LIMIT_WINDOW_SECONDS = 60;
const API_RATE_LIMIT_MAX = 240;
const API_RATE_LIMIT_WINDOW_MS = API_RATE_LIMIT_WINDOW_SECONDS * 1000;
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

fs.mkdirSync(ASSET_DIR, { recursive: true });

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
  const bucketStartMs = bucketStart * API_RATE_LIMIT_WINDOW_MS;
  return {
    bucketStartMs,
    bucketResetMs: bucketStartMs + API_RATE_LIMIT_WINDOW_MS,
    key: `rate_limit:${identity}:${bucketStart}`,
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
  const { bucketResetMs, key } = buildApiRateLimitPayload(req, now);
  const remainingWindowMs = Math.max(bucketResetMs - now, 0);

  let count = null;

  const redisCount = await cacheIncrWithTtl(key, API_RATE_LIMIT_WINDOW_SECONDS, 1);
  if (Number.isFinite(redisCount)) {
    count = Number(redisCount);
  }

  if (count == null) {
    count = await checkInMemoryRateLimit(key, bucketResetMs);
  }

  const remainingCount = Math.max(API_RATE_LIMIT_MAX - count, 0);
  res.setHeader("X-Rate-Limit-Limit", String(API_RATE_LIMIT_MAX));
  res.setHeader("X-Rate-Limit-Remaining", String(remainingCount));
  res.setHeader("X-Rate-Limit-Reset", String(Math.ceil(bucketResetMs / 1000)));

  if (count > API_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucketResetMs - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      error: "too many requests",
      limit: API_RATE_LIMIT_MAX,
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

app.use("/media", express.static(ASSET_DIR));

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

function readActorId(req, body = {}) {
  const candidate = String(
    req.headers["x-actor-id"] ||
      body.actorId ||
      body.authorId ||
      ipToActorFingerprint(req) ||
      req.ip ||
      "anonymous"
  );
  return crypto.createHash("md5").update(candidate).digest("hex").slice(0, 24);
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

function buildFeedBaseWhere({ q = "", tag = "" } = {}) {
  const where = ["p.status='published'"];
  const params = [];
  appendSearchConditions({ where, params }, parseSearchText(q), parseSearchText(tag));
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
      spotId: row.spot_id ? String(row.spot_id) : "",
      spotName: row.spot_name || "",
      district: row.district || "",
      latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
      longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
      cover: row.cover_url || "",
      angle: row.angle || "",
      direction: row.direction || "",
      timeWindow: row.time_window || "",
      bestTime: row.best_time || "day",
      shotAt: row.shot_at || row.created_at,
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

async function fetchFeedRows({ sort = "latest", cursor, limit, actorId, q = "", tag = "" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const clauses = ["SELECT p.*"];
  const fromClause = " FROM posts p";
  const { where, params } = buildFeedBaseWhere({ q, tag });
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

function buildFeedCacheKey({ actor, sort, limit, cursor, q, tag }) {
  const token = [q, tag].map((value) => clampString(String(value || ""), 48).toLowerCase()).join("|");
  return `feed:${actor}:${sort}:${limit}:${cursor?.id || "0"}:${cursor?.createdAt || "0"}:${token}`;
}

async function fetchActorFeedRows({ table, actorId, limit, cursor, sort = "latest" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const relation = table === "post_favorites" ? "post_favorites" : "post_likes";
  const fromClause = `
    FROM posts p
    INNER JOIN ${relation} t ON t.post_id = p.id
  `;
  const where = ["p.status='published'", `t.actor_id = ?`];
  const params = [actorId];
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

async function fetchAuthorFeedRows({ actorId, limit, cursor, sort = "latest" }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const where = ["p.status='published'", "p.author_id = ?"];
  const params = [actorId];
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

  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    count: Number(r.cnt || 0),
  })).filter((r) => Boolean(r.name));
}

async function invalidateAllPostsCaches() {
  await cacheDel("post:detail:*");
  await cacheDel("feed:*");
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

async function applyAuthorFollow({ actor, actorName, targetAuthorId, action = "toggle" }) {
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
      await conn.execute(
        "INSERT IGNORE INTO author_follows (follower_id, followed_id, actor_name) VALUES (?, ?, ?)",
        [actor, targetAuthorId, actorName]
      );
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
  ];
  const params = [actorId];
  const baseWhere = [...where];
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

  const totalRows = await query(`SELECT COUNT(*) AS c FROM posts p WHERE ${whereClause}`, baseWhere);
  const total = Number(totalRows[0]?.c || 0);

  return {
    posts,
    nextCursor,
    hasMore: useRows.length === max,
    total,
    stats: { totalPosts: total },
  };
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
     FROM posts p WHERE p.id = ?`,
    [actor, actor, actor, postId]
  );
  if (!rows.length) return res.status(404).json({ error: "post not found" });

  const post = (await loadPostMeta(rows, { includeComments: withComments, actor }))[0];
  await query("UPDATE posts SET stats_views = stats_views + 1 WHERE id = ?", [postId]);
  post.views += 1;
  await cacheSetJson(cacheKey, { post }, 120);
  return res.json({ post });
}

async function getPostCommentsPayload(req) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    const err = new Error("invalid post id");
    err.status = 400;
    throw err;
  }

  const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) {
    const err = new Error("post not found");
    err.status = 404;
    throw err;
  }

  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 12, { min: 1, max: Number(MAX_FEED_LIMIT) });
  const [rows, countRows] = await Promise.all([
    query(
      `SELECT id, actor_name AS author, content, created_at
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
      text: row.content,
      createdAt: row.created_at,
    })),
    nextCursor,
    hasMore: useRows.length === limit,
    total: Number(countRows[0]?.c || 0),
  };
}

async function createPostHandler(req) {
  const body = req.body || {};
  const title = safeText(body.title, 200);
  if (!title) throw Object.assign(new Error("title required"), { status: 400 });
  const media = Array.isArray(body.media) ? body.media : [];
  if (!media.length) throw Object.assign(new Error("media required"), { status: 400 });

  const content = safeText(body.content, 3000);
  if (!content) throw Object.assign(new Error("content required"), { status: 400 });
  const spotId = pickInt(body.spotId, 0);
  const spotName = safeText(body.spotName || "", 80);
  const district = safeText(body.district || "", 64);
  const latitude = pickFloat(body.latitude, null, { min: -90, max: 90 });
  const longitude = pickFloat(body.longitude, null, { min: -180, max: 180 });
  const tags = normalizeList(body.tags || body.tag || "");
  const styles = normalizeList(body.styles || "");
  const actorId = readActorId(req, body);
  let shotAt = null;
  if (body.shotAt) {
    const parsed = new Date(body.shotAt);
    if (!Number.isNaN(parsed.getTime())) {
      shotAt = parsed.toISOString().slice(0, 19).replace("T", " ");
    }
  }

    const result = await tx(async (conn) => {
      const postValues = [
        title,
        content,
        safeText(actorId, 64),
        safeText(body.author || "匿名拍友", 64),
        safeText(body.authorBio || "", 120),
        spotId || null,
        spotName,
        district,
        latitude,
        longitude,
        safeText(body.direction || "", 80),
        safeText(body.angle || "", 80),
        safeText(body.timeWindow || "", 80),
        body.bestTime === "night" || body.bestTime === "golden" ? body.bestTime : "day",
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
         (title, content, author_id, author_name, author_bio, spot_id, spot_name, district, latitude, longitude, direction, angle,
        time_window, best_time, shot_at, camera, lens, focal_length, aperture, shutter, iso, white_balance,
        media_type, cover_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
        postValues
      );

      const postId = postResult.insertId;
      let acceptedMedia = 0;
      for (let i = 0; i < media.length; i += 1) {
        const item = media[i] || {};
        const url = safeText(item.url || "", 500);
        if (!url) continue;
        acceptedMedia += 1;
        await conn.execute(
          `INSERT INTO post_media (post_id, kind, url, cover_url, width, height, duration, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            postId,
            String(item.kind || "image").slice(0, 12),
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

    return postId;
  });

  await invalidateAllPostsCaches();
  const detail = await query("SELECT p.* FROM posts p WHERE p.id = ?", [result]);
  const normalized = (await loadPostMeta(detail))[0];
  return { ok: true, post: normalized };
}

async function applyActionOnPost({ postId, action, actor, actorName, kind }) {
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
    const [postRows] = await conn.execute("SELECT id FROM posts WHERE id = ?", [postId]);
    if (!postRows.length) throw new Error("post not found");

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
  const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) {
    const err = new Error("post not found");
    err.status = 404;
    throw err;
  }

  const result = await query(
    "INSERT INTO post_comments (post_id, actor_id, actor_name, content) VALUES (?, ?, ?, ?)",
    [postId, actor, author, text]
  );
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
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
      text,
      createdAt: insertedComment?.created_at || new Date().toISOString(),
    },
  };
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
const weatherHandler = async (_req, res) => {
  res.json({
    ok: true,
    temp: 27,
    feelsLike: 31,
    humidity: 74,
    wind: 3,
    label: "阳光明媚",
    location: "广州",
  });
};
app.get("/health", healthHandler);
app.get("/api/v1/health", healthHandler);
app.get("/api/v1/system/health", healthHandler);
app.get("/api/weather", weatherHandler);
app.get("/api/v1/weather", weatherHandler);

async function spotsHandler(_req, res) {
  const cacheKey = "spots:list:v2";
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const spots = await query("SELECT * FROM spots ORDER BY name");
  const payload = {
    spots: spots.map((s) => ({
      ...s,
      lat: Number(s.latitude),
      lng: Number(s.longitude),
      tags: safeJsonList(s.tags),
      styles: safeJsonList(s.styles),
    })),
  };
  await cacheSetJson(cacheKey, payload, SPOT_CACHE_TTL_SECONDS);
  return res.json(payload);
}

app.get("/api/v1/spots", asyncHandler(spotsHandler));
app.get("/api/spots", asyncHandler(spotsHandler));

app.get("/api/v1/community/feed", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const q = parseSearchText(req.query.q);
  const tag = parseSearchText(req.query.tag);
  const cacheKey = buildFeedCacheKey({
    actor,
    sort,
    limit,
    cursor,
    q,
    tag,
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
  const payload = await fetchFeedRows({
    sort,
    cursor,
    limit,
    actorId: actor,
    q,
    tag,
  });
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
app.get("/api/v1/community/me/following", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchFollowingFeedRows({
    actorId: actor,
    limit,
    cursor,
    sort,
  });
  res.json(payload);
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
  const state = await applyAuthorFollow({
    actor,
    actorName,
    targetAuthorId,
    action,
  });
  res.json({
    ok: true,
    authorId: targetAuthorId,
    followed: state.following,
    following: state.following,
    followers: state.followers,
    action,
  });
}));

app.get("/api/community/me/following", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchFollowingFeedRows({
    actorId: actor,
    limit,
    cursor,
    sort,
  });
  res.json(payload);
}));

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
  const state = await applyAuthorFollow({
    actor,
    actorName,
    targetAuthorId,
    action,
  });
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
  const action = String(req.body?.action || "toggle");
  const result = await applyActionOnPost({
    postId,
    action,
    actor,
    actorName,
    kind: "like",
  });
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
  return res.json({ ok: true, likes: result.count, liked: result.active });
}));

app.post("/api/v1/posts/:id/favorite", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);
  const action = String(req.body?.action || "toggle");
  const result = await applyActionOnPost({
    postId,
    action,
    actor,
    actorName,
    kind: "favorite",
  });
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
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
    const uploadPayload = {
      ok: true,
      media: [{
        kind: req.file.mimetype?.startsWith("video/") ? "video" : "image",
        url: `${req.protocol}://${req.get("host")}/media/${req.file.filename}`,
        duration: 0,
      }],
    };

    runWithIdempotency({
      req,
      actor,
      scope: "media:upload",
      handler: async () => uploadPayload,
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
  const payload = await fetchFeedRows({
    sort,
    cursor,
    limit,
    actorId: actor,
    q,
    tag,
  });
  return res.json({
    ...payload,
    stats: payload.stats || { totalPosts: payload.total },
  });
}));
app.get("/api/posts/:id", asyncHandler(getPostHandler));
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
  const action = String(req.body?.action || "toggle");
  const result = await applyActionOnPost({
    postId,
    action,
    actor,
    actorName,
    kind: "like",
  });
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
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
  const action = String(req.body?.action || "toggle");
  const result = await applyActionOnPost({
    postId,
    action,
    actor,
    actorName,
    kind: "favorite",
  });
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
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
await ensureFollowSchemaCompatibility();

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
