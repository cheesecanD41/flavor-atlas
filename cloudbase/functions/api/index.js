"use strict";

const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("node:crypto");
const SEED_RECORDS = require("./records.json");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const COLLECTION = "records";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

let seedReady = false;

function reply(statusCode, data) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS_HEADERS),
    body: JSON.stringify(data)
  };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function ensureSeed() {
  if (seedReady) return;
  try {
    await db.createCollection(COLLECTION);
  } catch {
    // 集合已存在时忽略
  }
  const result = await db.collection(COLLECTION).count();
  if (Number(result.total) > 0) {
    seedReady = true;
    return;
  }
  for (const seed of SEED_RECORDS) {
    await db.collection(COLLECTION).add(seed);
  }
  seedReady = true;
}

async function attachImageUrls(records) {
  const fileIds = records.map((item) => item.imageFileId).filter(Boolean);
  if (!fileIds.length) return records;
  try {
    const result = await app.getTempFileURL({ fileList: fileIds });
    const urlMap = {};
    for (const file of result.fileList || []) {
      if (file.tempFileURL) urlMap[file.fileID] = file.tempFileURL;
    }
    for (const record of records) {
      if (record.imageFileId && urlMap[record.imageFileId]) {
        record.imageUrl = urlMap[record.imageFileId];
      }
    }
  } catch (error) {
    console.error("getTempFileURL failed:", error);
  }
  return records;
}

async function listRecords(regionId) {
  let query = db.collection(COLLECTION);
  if (regionId) query = query.where({ regionId: String(regionId) });
  const result = await query.orderBy("createdAt", "desc").limit(1000).get();
  return attachImageUrls(result.data || []);
}

function computeStats(records) {
  const byProvince = {};
  const regions = new Set();
  for (const record of records) {
    regions.add(String(record.regionId));
    byProvince[String(record.provinceId)] = (byProvince[String(record.provinceId)] || 0) + 1;
  }
  return { total: records.length, regions: regions.size, byProvince };
}

async function handleRecordsPost(event) {
  let body = {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "{}");
    body = JSON.parse(raw || "{}");
  } catch {
    return reply(400, { error: "请求数据格式不正确。" });
  }

  const regionId = cleanText(body.regionId, 32);
  const regionName = cleanText(body.regionName, 40);
  const provinceId = cleanText(body.provinceId, 32);
  const provinceName = cleanText(body.provinceName, 40);
  const description = cleanText(body.description, 500);
  const author = cleanText(body.author, 20);
  const dishName = cleanText(body.dishName, 30);

  if (!regionId || !regionName || !provinceId || !description || !author) {
    return reply(400, { error: "地区、描述和作者信息不能为空。" });
  }
  if (String(body.description || "").trim().length > 500) {
    return reply(400, { error: "文字描述不能超过 500 字。" });
  }
  if (String(body.author || "").trim().length > 20) {
    return reply(400, { error: "作者名字不能超过 20 个字符。" });
  }

  const match = String(body.imageDataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return reply(400, { error: "照片格式不正确，仅支持 JPG、PNG 或 WEBP。" });
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return reply(400, { error: "照片内容为空。" });
  if (buffer.length > MAX_IMAGE_BYTES) {
    return reply(413, { error: "照片超过 2MB，服务器已拒绝保存。" });
  }

  const extension = match[1].replace("image/", "").replace("jpeg", "jpg");
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const upload = await app.uploadFile({
    cloudPath: `flavor-atlas/${id}.${extension}`,
    fileContent: buffer
  });

  const record = {
    id,
    regionId,
    regionName,
    provinceId,
    provinceName,
    imageFileId: upload.fileID,
    dishName: dishName || "无名好味",
    description,
    author,
    createdAt: new Date().toISOString()
  };

  await db.collection(COLLECTION).add(record);

  const decorated = await attachImageUrls([Object.assign({}, record)]);
  return reply(201, { record: decorated[0] });
}

exports.main = async (event) => {
  const method = String(event.httpMethod || "GET").toUpperCase();
  const path = String(event.path || "/").replace(/\/+$/, "");

  if (method === "OPTIONS") {
    return {
      isBase64Encoded: false,
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ""
    };
  }

  try {
    await ensureSeed();

    if (path.endsWith("/stats")) {
      if (method !== "GET") return reply(405, { error: "接口不存在。" });
      const records = await listRecords();
      return reply(200, computeStats(records));
    }

    if (path.endsWith("/records")) {
      if (method === "GET") {
        const params = event.queryStringParameters || {};
        const records = await listRecords(params.regionId);
        return reply(200, { records });
      }
      if (method === "POST") {
        return await handleRecordsPost(event);
      }
      return reply(405, { error: "接口不存在。" });
    }

    return reply(404, { error: "接口不存在。" });
  } catch (error) {
    console.error("flavor-atlas api error:", error);
    return reply(500, { error: "服务器暂时开小差了。" });
  }
};
