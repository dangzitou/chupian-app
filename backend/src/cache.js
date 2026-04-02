import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const { REDIS_URL = "redis://127.0.0.1:6379" } = process.env;

export const redis = new Redis(REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: 2,
});

export async function cacheGetJson(key) {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export async function cacheSetJson(key, value, ttlSeconds = 20) {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(pattern) {
  const keys = await redis.keys(pattern);
  if (!keys.length) return 0;
  return redis.del(keys);
}
