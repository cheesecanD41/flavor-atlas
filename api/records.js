import { getRecords, saveRecords } from "../lib/redis.js";
import { randomUUID } from "node:crypto";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function detectImage(base64DataUrl) {
  const match = String(base64DataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const mime = match[1];
  const extension = mime.split("/")[1].replace("jpeg", "jpg");
  return { mime, extension };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const records = await getRecords();
    const regionId = req.query.regionId;
    const filtered = regionId
      ? records.filter((r) => String(r.regionId) === String(regionId))
      : records;
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.status(200).json({ records: filtered });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const regionId = cleanText(body.regionId, 32);
    const regionName = cleanText(body.regionName, 40);
    const provinceId = cleanText(body.provinceId, 32);
    const provinceName = cleanText(body.provinceName, 40);
    const description = cleanText(body.description, 500);
    const author = cleanText(body.author, 20);
    const dishName = cleanText(body.dishName, 30);

    if (!regionId || !regionName || !provinceId || !description || !author) {
      return res.status(400).json({ error: "地区、描述和作者信息不能为空。" });
    }

    const detected = detectImage(body.imageDataUrl);
    if (!detected) {
      return res.status(400).json({ error: "照片格式不正确，仅支持 JPG、PNG 或 WEBP。" });
    }

    const base64Data = String(body.imageDataUrl).split(",")[1] || "";
    const buffer = Buffer.from(base64Data.replace(/\s/g, ""), "base64");
    if (!buffer.length) return res.status(400).json({ error: "照片内容为空。" });
    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: "照片超过 2MB，服务器已拒绝保存。" });
    }

    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const record = {
      id,
      regionId,
      regionName,
      provinceId,
      provinceName,
      imageUrl: body.imageDataUrl,
      dishName: dishName || "无名好味",
      description,
      author,
      createdAt: new Date().toISOString()
    };

    const records = await getRecords();
    records.unshift(record);
    await saveRecords(records);

    return res.status(201).json({ record });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
