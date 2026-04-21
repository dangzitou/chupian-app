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

export async function cacheSetIfNotExists(key, value, ttlSeconds = 60) {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const result = await redis.set(key, raw, "NX", "EX", ttlSeconds);
    return result === "OK";
  } catch (err) {
    return false;
  }
}

export async function cacheIncrWithTtl(key, ttlSeconds = 60, startAt = 1) {
  try {
    const value = await redis.eval(
      `
        local value = redis.call('INCR', KEYS[1])
        local ttl = redis.call('TTL', KEYS[1])
        if ttl < 0 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return value
      `,
      1,
      key,
      Math.max(1, Number(ttlSeconds) || 1),
      Math.max(1, Number(startAt) || 1),
    );
    return Number(value);
  } catch (err) {
    return null;
  }
}

export async function pingCache() {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch (_err) {
    return false;
  }
}

export async function cacheDel(pattern) {
  try {
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 300);
      if (Array.isArray(keys) && keys.length) {
        deleted += Number(await redis.del(...keys));
      }
      cursor = nextCursor;
    } while (cursor !== "0");
    return deleted;
  } catch (err) {
    return 0;
  }
}

export async function closeCache() {
  try {
    await redis.quit();
  } catch (err) {
    // ignore
  }
}
