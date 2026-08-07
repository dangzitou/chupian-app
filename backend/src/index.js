import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import multer from "multer";
import { tx, query } from "./db.js";
import { cacheDel, cacheGetJson, cacheSetJson } from "./cache.js";
import { makeCursor, parseCursor, safeJsonList } from "./utils.js";

dotenv.config();

const {
  PORT = "3000",
  MAX_FEED_LIMIT = "40",
  UPLOAD_DIR = "./uploads",
  CORS_ORIGIN = "*",
} = process.env;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const ASSET_DIR = path.join(ROOT_DIR, UPLOAD_DIR);

fs.mkdirSync(ASSET_DIR, { recursive: true });

const app = express();
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(","),
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/media", express.static(ASSET_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: () => ASSET_DIR,
    filename: (_, file, cb) => {
      const ext = file.originalname.includes(".")
        ? file.originalname.split(".").pop()
        : "jpg";
      cb(null, `${Date.now()}-${randomUUID().slice(0, 6)}.${ext}`);
    },
  }),
  limits: { fileSize: 120 * 1024 * 1024 },
});

function readActorId(req, body = {}) {
  const candidate =
    String(req.headers["x-actor-id"] || body.actorId || body.author || req.ip || "anonymous");
  return crypto.createHash("md5").update(candidate).digest("hex").slice(0, 24);
}

function normalizeList(raw) {
  if (!raw || !raw.length) return [];
  return String(raw)
    .split(/[,，/|#]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 24);
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
  const q = ["SELECT p.*", " FROM posts p"];
  const where = ["p.status='published'"];
  const params = [];

  if (cursor) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const order = sort === "hot"
    ? " ORDER BY p.stats_likes DESC, p.created_at DESC, p.id DESC"
    : " ORDER BY p.created_at DESC, p.id DESC";

  q.push(
    ", (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes_count",
    ", (SELECT COUNT(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorites_count",
    ", EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked",
    ", EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited"
  );
  params.unshift(actorId, actorId);

  const rows = await query(
    `${q.join("")} WHERE ${where.join(" AND ")} ${order} LIMIT ?`,
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

app.get("/health", async (_req, res) => {
  res.json({ ok: true, service: "chupian-service", now: new Date().toISOString() });
});

app.get("/api/v1/spots", async (_req, res) => {
  const spots = await query("SELECT * FROM spots ORDER BY name");
  res.json({ spots: spots.map((s) => ({ ...s, lat: Number(s.latitude), lng: Number(s.longitude), tags: safeJsonList(s.tags), styles: safeJsonList(s.styles) })) });
});

app.get("/api/v1/community/feed", async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = Number(req.query.limit || 20);
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const cacheKey = `feed:${actor}:${sort}:${limit}:${req.query.cursor || ""}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  try {
    const payload = await fetchFeedRows({ sort, cursor, limit, actorId: actor });
    await cacheSetJson(cacheKey, payload, 20);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message || "feed failed" });
  }
});

app.get("/api/v1/posts/:id", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });

  const actor = readActorId(req, req.query);
  const cacheKey = `post:detail:${postId}:${actor}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return res.json(cached);

  try {
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
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message || "post detail failed" });
  }
});

app.post("/api/v1/posts", async (req, res) => {
  const body = req.body || {};
  const title = String(body.title || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  const actor = readActorId(req, body);
  const content = String(body.content || "").trim();

  const spotId = Number(body.spotId || 0) || null;
  const spotName = String(body.spotName || "");
  const district = String(body.district || "");
  const media = Array.isArray(body.media) ? body.media : [];
  const tags = normalizeList(body.tags || body.tag || "");
  const styles = normalizeList(body.styles || "");

  try {
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
          String(body.author || "匿名拍友").slice(0, 64),
          String(body.authorBio || ""),
          spotId,
          spotName,
          district,
          String(body.direction || ""),
          String(body.angle || ""),
          String(body.timeWindow || ""),
          body.shotAt || null,
          String(body.camera || ""),
          String(body.lens || ""),
          String(body.focalLength || ""),
          String(body.aperture || ""),
          String(body.shutter || ""),
          String(body.iso || ""),
          String(body.whiteBalance || ""),
          Array.isArray(media) && media[0] ? media[0].kind || "image" : "image",
          Array.isArray(media) && media[0] ? media[0].url || "" : "",
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
            String(item.url || ""),
            String(item.cover || ""),
            Number(item.width || 0),
            Number(item.height || 0),
            Number(item.duration || 0),
            i,
          ]
        );
      }
      for (const t of tags) {
        if (!t) continue;
        await conn.execute(
          "INSERT IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)",
          [postId, t]
        );
      }
      for (const s of styles) {
        if (!s) continue;
        await conn.execute(
          "INSERT IGNORE INTO post_styles (post_id, style) VALUES (?, ?)",
          [postId, s]
        );
      }
      return postId;
    });

    await invalidateAllPostsCaches();
    const detail = await query("SELECT p.* FROM posts p WHERE p.id = ?", [result]);
    const normalized = (await loadPostMeta(detail))[0];
    res.json({ ok: true, post: normalized });
  } catch (err) {
    res.status(500).json({ error: err.message || "create failed" });
  }
});

async function applyActionOnPost({ postId, action, actor, actorName, kind }) {
  const isLike = kind === "like";
  return tx(async (conn) => {
    const [postRows] = await conn.execute("SELECT id, stats_likes, stats_favorites FROM posts WHERE id = ?", [postId]);
    if (!postRows.length) throw new Error("post not found");

    const actionTable = isLike ? "post_likes" : "post_favorites";
    const countColumn = isLike ? "stats_likes" : "stats_favorites";

    const [existRows] = await conn.execute(
      `SELECT id FROM ${actionTable} WHERE post_id = ? AND actor_id = ?`,
      [postId, actor]
    );
    const exists = existRows.length > 0;
    const normalizeAction = String(action || "toggle");
    let shouldAdd = false;

    if (normalizeAction === "like" || normalizeAction === "favorite") shouldAdd = true;
    if (normalizeAction === "unlike" || normalizeAction === "unfavorite") shouldAdd = false;
    if (normalizeAction === "toggle") shouldAdd = !exists;

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
      await conn.execute(`UPDATE posts SET ${countColumn} = GREATEST(${countColumn} - 1, 0) WHERE id = ?`, [postId]);
    }

    const [updated] = await conn.execute(`SELECT ${countColumn} AS c FROM posts WHERE id = ?`, [postId]);
    return {
      count: Number(updated[0]?.c || 0),
      active: shouldAdd,
      exists,
    };
  });
}

app.post("/api/v1/posts/:id/like", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = String(req.body?.author || "匿名拍友").slice(0, 80);
  const action = String(req.body?.action || "toggle");
  try {
    const result = await applyActionOnPost({ postId, action, actor, actorName, kind: "like" });
    await invalidateAllPostsCaches();
    await cacheDel(`post:detail:${postId}:*`);
    res.json({ ok: true, likes: result.count, liked: result.active });
  } catch (err) {
    const msg = err.message === "post not found" ? 404 : 500;
    res.status(msg).json({ error: err.message });
  }
});

app.post("/api/v1/posts/:id/favorite", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.body || {});
  const actorName = String(req.body?.author || "匿名拍友").slice(0, 80);
  const action = String(req.body?.action || "toggle");
  try {
    const result = await applyActionOnPost({ postId, action, actor, actorName, kind: "favorite" });
    await invalidateAllPostsCaches();
    await cacheDel(`post:detail:${postId}:*`);
    res.json({ ok: true, favorites: result.count, favorited: result.active });
  } catch (err) {
    const msg = err.message === "post not found" ? 404 : 500;
    res.status(msg).json({ error: err.message });
  }
});

app.post("/api/v1/posts/:id/comments", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const text = String(req.body?.text || req.body?.content || "").trim();
  if (!text) return res.status(400).json({ error: "comment required" });
  const actor = readActorId(req, req.body || {});
  const actorName = String(req.body?.author || "匿名拍友").slice(0, 80);
  const safeText = text.slice(0, 500);

  try {
    const [exists] = await query("SELECT id FROM posts WHERE id = ?", [postId]);
    if (!exists.length) return res.status(404).json({ error: "post not found" });

    await query(
      "INSERT INTO post_comments (post_id, actor_id, actor_name, content) VALUES (?, ?, ?, ?)",
      [postId, actor, actorName, safeText]
    );
    await invalidateAllPostsCaches();
    await cacheDel(`post:detail:${postId}:*`);
    res.json({ ok: true, comment: { postId, actorName, text: safeText } });
  } catch (err) {
    res.status(500).json({ error: err.message || "comment failed" });
  }
});

app.post("/api/v1/media/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });
  const rawUrl = `${req.protocol}://${req.get("host")}/media/${req.file.filename}`;
  const kind = req.file.mimetype.startsWith("video/") ? "video" : "image";
  res.json({ ok: true, media: [{ kind, url: rawUrl, duration: 0 }] });
});

// legacy compatibility
app.get("/api/posts", async (req, res) => {
  const actor = readActorId(req, req.query);
  const cursor = parseCursor(req.query.cursor || "");
  const limit = Number(req.query.limit || 20);
  const sort = "latest";
  const payload = await fetchFeedRows({ sort, cursor, limit, actorId: actor });
  res.json({
    posts: payload.posts,
    total: payload.total,
    stats: { posts: payload.total, totalLikes: 0, authors: 0 },
  });
});
app.get("/api/posts/:id", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ error: "invalid post id" });
  const actor = readActorId(req, req.query);
  const cacheKey = `post:detail:${postId}:${actor}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached && cached.post) return res.json(cached);

  const rows = await query(
    `SELECT p.*,
       EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.actor_id = ?) AS liked,
       EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id AND f.actor_id = ?) AS favorited
     FROM posts p WHERE p.id = ?`,
    [actor, actor, postId]
  );
  if (!rows.length) return res.status(404).json({ error: "post not found" });
  const post = (await loadPostMeta(rows))[0];
  await cacheSetJson(cacheKey, { post }, 120);
  res.json({ post });
});
app.post("/api/posts", async (req, res) => {
  req.url = "/api/v1/posts";
  req.path = "/api/v1/posts";
  return app._router.handle(req, res);
});
app.post("/api/posts/:id/like", async (req, res) => {
  req.url = req.url.replace("/api/posts/", "/api/v1/posts/");
  req.path = req.path.replace("/api/posts/", "/api/v1/posts/");
  return app._router.handle(req, res);
});
app.post("/api/posts/:id/comment", async (req, res) => {
  req.url = `/api/v1/posts/${req.params.id}/comments`;
  req.path = req.path.replace("/comment", "/comments");
  return app._router.handle(req, res);
});

app.listen(Number(PORT), () => {
  console.log(`chupian service running on http://0.0.0.0:${PORT}`);
});
