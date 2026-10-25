import { Redis } from "@upstash/redis";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const RECORDS_KEY = "flavor-atlas:records";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let seedLoaded = false;

async function loadSeedIfEmpty() {
  if (seedLoaded) return;
  const existing = await redis.get(RECORDS_KEY);
  if (Array.isArray(existing) && existing.length > 0) {
    seedLoaded = true;
    return;
  }
  try {
    const seedPath = path.join(__dirname, "..", "data", "records.json");
    const seeds = JSON.parse(readFileSync(seedPath, "utf8"));
    if (Array.isArray(seeds) && seeds.length > 0) {
      await redis.set(RECORDS_KEY, seeds);
    }
  } catch (e) {
    console.error("Failed to load seed data:", e);
  }
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
