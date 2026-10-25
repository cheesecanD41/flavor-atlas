import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const RECORDS_KEY = "flavor-atlas:records";

export async function getRecords() {
  const value = await redis.get(RECORDS_KEY);
  return Array.isArray(value) ? value : [];
}

export async function saveRecords(records) {
  await redis.set(RECORDS_KEY, records);
}

export { redis };
