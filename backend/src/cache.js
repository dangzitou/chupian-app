import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const { REDIS_URL = "redis://127.0.0.1:6379" } = process.env;

export const redis = new Redis(REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
});
let lastRedisErrTs = 0;
redis.on("error", (err) => {
  const now = Date.now();
  if (now - lastRedisErrTs > 10_000) {
    console.error(`[redis] ${err.message}`);
    lastRedisErrTs = now;
  }
});

export async function cacheGetJson(key) {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  } catch (err) {
    return null;
  }
}

export async function cacheSetJson(key, value, ttlSeconds = 20) {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    return;
  }
}

export async function cacheDel(pattern) {
  try {
    const keys = await redis.keys(pattern);
    if (!keys.length) return 0;
    return redis.del(keys);
  } catch (err) {
    return 0;
  }
}
