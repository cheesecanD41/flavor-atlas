import { getRecords } from "../lib/redis.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const records = await getRecords();
  const byProvince = {};
  const regions = new Set();
  for (const record of records) {
    regions.add(String(record.regionId));
    byProvince[String(record.provinceId)] = (byProvince[String(record.provinceId)] || 0) + 1;
  }
  return res.status(200).json({ total: records.length, regions: regions.size, byProvince });
}
