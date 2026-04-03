import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import multer from "multer";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { tx, query } from "./db.js";
import { cacheDel, cacheGetJson, cacheSetJson } from "./cache.js";
import { makeCursor, parseCursor, safeJsonList } from "./utils.js";

dotenv.config();

const {
  PORT = "3000",
  MAX_FEED_LIMIT = "40",
  UPLOAD_DIR = "./uploads",
  CORS_ORIGIN = "*",
  ALLOWED_UPLOAD_EXT = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.m4v,.mp3",
  MAX_JSON_SIZE = "2mb",
  MAX_FILE_SIZE = "120mb",
  SPOT_CACHE_TTL = "90",
} = process.env;

const SPOT_CACHE_TTL_SECONDS = Number.parseInt(SPOT_CACHE_TTL, 10) || 90;

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
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-m4v",
  "audio/mpeg",
]);

const app = express();
app.set("trust proxy", 1);
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
    allowedHeaders: ["Content-Type", "x-actor-id", "x-forwarded-for", "authorization"],
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

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});
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

async function loadPostMeta(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const inQuery = ids.map(() => "?").join(",");

  const [mediaRows, tagRows, styleRows, commentRows, likeAggRows, favAggRows] = await Promise.all([
    query(
      `SELECT post_id, kind, url, width, height, duration, cover_url, sort_order
       FROM post_media
       WHERE post_id IN (${inQuery})
       ORDER BY post_id, sort_order`,
      ids
    ),
    query(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${inQuery})`, ids),
    query(`SELECT post_id, style FROM post_styles WHERE post_id IN (${inQuery})`, ids),
    query(
      `SELECT post_id, id, actor_name AS author, content, created_at
       FROM post_comments
       WHERE post_id IN (${inQuery})
       ORDER BY post_id, id DESC
       LIMIT 80`,
      ids
    ),
    query(`SELECT post_id, COUNT(*) AS c FROM post_likes WHERE post_id IN (${inQuery}) GROUP BY post_id`, ids),
    query(`SELECT post_id, COUNT(*) AS c FROM post_favorites WHERE post_id IN (${inQuery}) GROUP BY post_id`, ids),
  ]);

  const mediaMap = new Map();
  const tagMap = new Map();
  const styleMap = new Map();
  const commentMap = new Map();
  const likeMap = new Map();
  const favMap = new Map();

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
  for (const item of likeAggRows) {
    likeMap.set(String(item.post_id), Number(item.c || 0));
  }
  for (const item of favAggRows) {
    favMap.set(String(item.post_id), Number(item.c || 0));
  }

  return rows.map((row) => {
    const key = String(row.id);
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      author: row.author_name || "匿名拍友",
      authorBio: row.author_bio || "",
      spotId: row.spot_id ? String(row.spot_id) : "",
      spotName: row.spot_name || "",
      district: row.district || "",
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
      comments: commentMap.get(key) || [],
      liked: Boolean(row.liked),
      favorited: Boolean(row.favorited),
      createdAt: row.created_at,
    };
  });
}

async function fetchFeedRows({ sort = "latest", cursor, limit, actorId }) {
  const max = Math.min(limit || 20, Number(MAX_FEED_LIMIT));
  const clauses = ["SELECT p.*"];
  const fromClause = " FROM posts p";
  const where = ["p.status='published'"];
  const params = [];

  if (cursor) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const order = sort === "hot"
    ? " ORDER BY p.stats_likes DESC, p.created_at DESC, p.id DESC"
    : " ORDER BY p.created_at DESC, p.id DESC";

  clauses.push(
    ", (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes_count",
    ", (SELECT COUNT(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorites_count",
    ", EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked",
    ", EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited"
  );
  params.unshift(actorId, actorId);

  const rows = await query(
    `${clauses.join("")} ${fromClause} WHERE ${where.join(" AND ")} ${order} LIMIT ?`,
    [...params, max + 1]
  );

  const useRows = rows.slice(0, max);
  const posts = await loadPostMeta(useRows);
  const nextCursor = useRows.length === max ? makeCursor(useRows.at(-1).createdAt, useRows.at(-1).id) : null;

  const totalRows = await query("SELECT COUNT(*) AS c FROM posts WHERE status='published'");
  const total = Number(totalRows[0]?.c || 0);
  const hasMore = useRows.length === max;

  return {
    posts,
    nextCursor,
    hasMore,
    total,
    stats: { totalPosts: total },
  };
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
      const status = Number(err?.status) || 500;
      if (!res.headersSent) {
        res.status(status).json({ error: err.message || "internal server error" });
      }
    }
  };
}

async function getPostHandler(req, res) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.query);
  const cacheKey = `post:detail:${postId}:${actor}`;

  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const rows = await query(
    `SELECT p.*,
       EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked,
       EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited
     FROM posts p WHERE p.id = ?`,
    [actor, actor, postId]
  );
  if (!rows.length) return res.status(404).json({ error: "post not found" });

  const post = (await loadPostMeta(rows))[0];
  await query("UPDATE posts SET stats_views = stats_views + 1 WHERE id = ?", [postId]);
  post.views += 1;
  await cacheSetJson(cacheKey, { post }, 120);
  return res.json({ post });
}

async function createPostHandler(req, res) {
  const body = req.body || {};
  const title = safeText(body.title, 200);
  if (!title) return res.status(400).json({ error: "title required" });
  
  const content = safeText(body.content, 3000);
  const spotId = pickInt(body.spotId, 0);
  const spotName = safeText(body.spotName || "", 80);
  const district = safeText(body.district || "", 64);
  const media = Array.isArray(body.media) ? body.media : [];
  const tags = normalizeList(body.tags || body.tag || "");
  const styles = normalizeList(body.styles || "");
  let shotAt = null;
  if (body.shotAt) {
    const parsed = new Date(body.shotAt);
    if (!Number.isNaN(parsed.getTime())) {
      shotAt = parsed.toISOString().slice(0, 19).replace("T", " ");
    }
  }

  const result = await tx(async (conn) => {
    const [postResult] = await conn.execute(
      `INSERT INTO posts
       (title, content, author_name, author_bio, spot_id, spot_name, district, direction, angle,
        time_window, best_time, shot_at, camera, lens, focal_length, aperture, shutter, iso, white_balance,
        media_type, cover_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
      [
        title,
        content,
        safeText(body.author || "匿名拍友", 64),
        safeText(body.authorBio || "", 120),
        spotId || null,
        spotName,
        district,
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
      ]
    );

    const postId = postResult.insertId;
    for (let i = 0; i < media.length; i += 1) {
      const item = media[i] || {};
      await conn.execute(
        `INSERT INTO post_media (post_id, kind, url, cover_url, width, height, duration, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          postId,
          String(item.kind || "image").slice(0, 12),
          safeText(item.url || "", 500),
          safeText(item.cover || "", 500),
          Number(item.width || 0),
          Number(item.height || 0),
          Number(item.duration || 0),
          i,
        ]
      );
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
  return res.json({ ok: true, post: normalized });
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

    const [existRows] = await conn.execute(
      `SELECT id FROM ${actionTable} WHERE post_id = ? AND actor_id = ?`,
      [postId, actor]
    );
    const exists = existRows.length > 0;
    let shouldAdd = false;

    if (normalizedAction === "like" || normalizedAction === "favorite") shouldAdd = true;
    if (normalizedAction === "unlike" || normalizedAction === "unfavorite") shouldAdd = false;
    if (normalizedAction === "toggle") shouldAdd = !exists;

    if (shouldAdd && !exists) {
      await conn.execute(
        `INSERT INTO ${actionTable} (post_id, actor_id, actor_name) VALUES (?, ?, ?)`,
        [postId, actor, actorName]
      );
      await conn.execute(`UPDATE posts SET ${countColumn} = ${countColumn} + 1 WHERE id = ?`, [postId]);
    }

    if (!shouldAdd && exists) {
      await conn.execute(
        `DELETE FROM ${actionTable} WHERE post_id = ? AND actor_id = ?`,
        [postId, actor]
      );
      await conn.execute(
        `UPDATE posts SET ${countColumn} = GREATEST(${countColumn} - 1, 0) WHERE id = ?`,
        [postId]
      );
    }

    const [updated] = await conn.execute(`SELECT ${countColumn} AS c FROM posts WHERE id = ?`, [postId]);

    return {
      count: Number(updated[0]?.c || 0),
      active: shouldAdd,
      exists,
    };
  });
}

function createErrorHandler(err, _req, res, _next) {
  if (err?.message === "Unsupported file type") {
    return res.status(415).json({ error: "Unsupported file type" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload too large" });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file too large" });
  }
  return res.status(500).json({ error: err?.message || "internal error" });
}

const healthHandler = async (_req, res) => {
  res.json({ ok: true, service: "chupian-service", now: new Date().toISOString() });
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
  const cacheKey = `feed:${actor}:${sort}:${limit}:${req.query.cursor || ""}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  const payload = await fetchFeedRows({ sort, cursor, limit, actorId: actor });
  await cacheSetJson(cacheKey, payload, 20);
  return res.json(payload);
}));
app.get("/api/v1/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const payload = await fetchFeedRows({ sort, cursor, limit, actorId: actor });
  return res.json(payload);
}));

app.get("/api/v1/posts/:id", asyncHandler(getPostHandler));

app.post("/api/v1/posts", asyncHandler(createPostHandler));

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
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const text = safeText(req.body?.text || req.body?.content || "", 500);
  if (!text) return res.status(400).json({ error: "comment required" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);

  const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) return res.status(404).json({ error: "post not found" });

  await query(
    "INSERT INTO post_comments (post_id, actor_id, actor_name, content) VALUES (?, ?, ?, ?)",
    [postId, actor, actorName, text]
  );
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
  return res.json({ ok: true, comment: { postId, actorName, text } });
}));
app.post("/api/v1/posts/:id/comment", asyncHandler(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const text = safeText(req.body?.text || req.body?.content || "", 500);
  if (!text) return res.status(400).json({ error: "comment required" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);

  const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) return res.status(404).json({ error: "post not found" });

  await query(
    "INSERT INTO post_comments (post_id, actor_id, actor_name, content) VALUES (?, ?, ?, ?)",
    [postId, actor, actorName, text]
  );
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
  return res.json({ ok: true, comment: { postId, actorName, text } });
}));

app.post("/api/v1/media/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: "file required" });

    const rawUrl = `${req.protocol}://${req.get("host")}/media/${req.file.filename}`;
    const kind = req.file.mimetype?.startsWith("video/") ? "video" : "image";

    return res.json({ ok: true, media: [{ kind, url: rawUrl, duration: 0 }] });
  });
});

// legacy compatibility
app.get("/api/posts", asyncHandler(async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = pickInt(req.query.limit, 20, { min: 1, max: 40 });
  const payload = await fetchFeedRows({ sort: "latest", cursor, limit, actorId: actor });
  return res.json({
    posts: payload.posts,
    total: payload.total,
    stats: { posts: payload.total, totalLikes: payload.stats?.totalPosts || 0, authors: 0 },
  });
}));
app.get("/api/posts/:id", asyncHandler(getPostHandler));
app.post("/api/posts", asyncHandler(createPostHandler));
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
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const text = safeText(req.body?.text || req.body?.content || "", 500);
  if (!text) return res.status(400).json({ error: "comment required" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);

  const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) return res.status(404).json({ error: "post not found" });

  await query(
    "INSERT INTO post_comments (post_id, actor_id, actor_name, content) VALUES (?, ?, ?, ?)",
    [postId, actor, actorName, text]
  );
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
  return res.json({ ok: true, comment: { postId, actorName, text } });
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
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const text = safeText(req.body?.text || req.body?.content || "", 500);
  if (!text) return res.status(400).json({ error: "comment required" });
  const actor = readActorId(req, req.body || {});
  const actorName = safeText(req.body?.author || "匿名拍友", 80);

  const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
  if (!exists?.id) return res.status(404).json({ error: "post not found" });

  await query(
    "INSERT INTO post_comments (post_id, actor_id, actor_name, content) VALUES (?, ?, ?, ?)",
    [postId, actor, actorName, text]
  );
  await invalidateAllPostsCaches();
  await cacheDel(`post:detail:${postId}:*`);
  return res.json({ ok: true, comment: { postId, actorName, text } });
}));

app.use(createErrorHandler);

app.listen(Number(PORT), () => {
  console.log(`chupian service running on http://0.0.0.0:${PORT}`);
});
