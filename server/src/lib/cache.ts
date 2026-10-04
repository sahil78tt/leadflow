import { Redis } from "ioredis";
import { env } from "../config/env.js";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<number>;
}

// A mutable holder, so tests can swap the store without touching the network.
let store: CacheStore | null = null;
export const getCache = () => store;
export function setCache(next: CacheStore | null) {
  store = next;
}

/** Returns false when no Redis URL is configured (the app then simply runs without a cache). */
export function initRedisCache(): boolean {
  if (!env.UPSTASH_REDIS_URL) return false;

  const redis = new Redis(env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // fail fast while disconnected instead of queueing commands
    connectTimeout: 3000,
    commandTimeout: 1000, // a hung connection can slow a request by at most this much
  });

  let lastLog = 0;
  redis.on("error", (err: Error) => {
    // Required (an unhandled 'error' event is noisy) and throttled (reconnects fire it repeatedly).
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      console.error(`redis error (the cache fails open): ${err.message}`);
    }
  });

  store = {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, "EX", ttlSeconds);
    },
    incr: (key) => redis.incr(key),
  };
  return true;
}
