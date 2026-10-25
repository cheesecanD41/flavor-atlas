import { Redis } from "@upstash/redis";
import { SEED_RECORDS } from "./seed.js";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const RECORDS_KEY = "flavor-atlas:records";

let seedLoaded = false;

async function loadSeedIfEmpty() {
  if (seedLoaded) return;
  const existing = await redis.get(RECORDS_KEY);
  if (Array.isArray(existing) && existing.length > 0) {
    seedLoaded = true;
    return;
  }
  await redis.set(RECORDS_KEY, SEED_RECORDS);
  seedLoaded = true;
}

export async function getRecords() {
  await loadSeedIfEmpty();
  const value = await redis.get(RECORDS_KEY);
  return Array.isArray(value) ? value : [];
}

export async function saveRecords(records) {
  await redis.set(RECORDS_KEY, records);
}

export { redis };
