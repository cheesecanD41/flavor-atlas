import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

let writeQueue = Promise.resolve();

async function ensureStorage() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await stat(RECORDS_FILE);
  } catch {
    await writeFile(RECORDS_FILE, "[]\n", "utf8");
  }
}

async function readRecords() {
  await ensureStorage();
  try {
    const value = JSON.parse(await readFile(RECORDS_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error("Could not parse records.json:", error);
    return [];
  }
}

function recordStats(records) {
  const byProvince = {};
  const regions = new Set();
  for (const record of records) {
    regions.add(String(record.regionId));
    byProvince[String(record.provinceId)] = (byProvince[String(record.provinceId)] || 0) + 1;
  }
  return { total: records.length, regions: regions.size, byProvince };
}

function sendJson(response, statusCode, data) {
  const payload = JSON.stringify(data);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}

function detectImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg", type: "jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", extension: "png", type: "png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", extension: "webp", type: "webp" };
  }
  return null;
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("请求内容过大。");
        error.statusCode = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("请求数据格式不正确。");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function handleRecordsPost(request, response) {
  const body = await readJsonBody(request);
  const regionId = cleanText(body.regionId, 32);
  const regionName = cleanText(body.regionName, 40);
  const provinceId = cleanText(body.provinceId, 32);
  const provinceName = cleanText(body.provinceName, 40);
  const description = cleanText(body.description, 500);
  const author = cleanText(body.author, 20);
  const dishName = cleanText(body.dishName, 30);

  if (!regionId || !regionName || !provinceId || !description || !author) {
    return sendJson(response, 400, { error: "地区、描述和作者信息不能为空。" });
  }
  if (String(body.description || "").trim().length > 500) {
    return sendJson(response, 400, { error: "文字描述不能超过 500 字。" });
  }
  if (String(body.author || "").trim().length > 20) {
    return sendJson(response, 400, { error: "作者名字不能超过 20 个字符。" });
  }

  const match = String(body.imageDataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return sendJson(response, 400, { error: "照片格式不正确，仅支持 JPG、PNG 或 WEBP。" });
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return sendJson(response, 400, { error: "照片内容为空。" });
  if (buffer.length > MAX_IMAGE_BYTES) {
    return sendJson(response, 413, { error: "照片超过 2MB，服务器已拒绝保存。" });
  }
  const detected = detectImage(buffer);
  if (!detected) return sendJson(response, 400, { error: "无法识别照片格式，保存已取消。" });

  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const fileName = `${id}.${detected.extension}`;
  const absoluteUploadPath = path.join(UPLOAD_DIR, fileName);
  await writeFile(absoluteUploadPath, buffer);

  const record = {
    id,
    regionId,
    regionName,
    provinceId,
    provinceName,
    imageUrl: `data/uploads/${fileName}`,
    dishName: dishName || "无名好味",
    description,
    author,
    createdAt: new Date().toISOString()
  };

  writeQueue = writeQueue
    .catch((error) => console.error("Previous write failed:", error))
    .then(async () => {
      const records = await readRecords();
      records.unshift(record);
      const tempFile = `${RECORDS_FILE}.${randomUUID()}.tmp`;
      await writeFile(tempFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      await rename(tempFile, RECORDS_FILE);
    });

  try {
    await writeQueue;
  } catch (error) {
    await unlink(absoluteUploadPath).catch(() => {});
    throw error;
  }

  return sendJson(response, 201, { record });
}

async function handleApi(request, response, requestUrl) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, { Allow: "GET, POST, OPTIONS" });
    response.end();
    return;
  }
  if (requestUrl.pathname === "/api/stats" && request.method === "GET") {
    const records = await readRecords();
    return sendJson(response, 200, recordStats(records));
  }
  if (requestUrl.pathname === "/api/records" && request.method === "GET") {
    const records = await readRecords();
    const regionId = requestUrl.searchParams.get("regionId");
    const filtered = regionId
      ? records.filter((record) => String(record.regionId) === String(regionId))
      : records;
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sendJson(response, 200, { records: filtered });
  }
  if (requestUrl.pathname === "/api/records" && request.method === "POST") {
    return handleRecordsPost(request, response);
  }
  return sendJson(response, 404, { error: "接口不存在。" });
}
async function serveStatic(request, response, requestUrl) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) throw new Error("directory");
    const extension = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[extension] || "application/octet-stream";
    const noCache = extension === ".html" || filePath.includes(`${path.sep}data${path.sep}`);
    const cacheControl = noCache ? "no-cache" : "public, max-age=3600";
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": fileStats.size,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
}
await ensureStorage();

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }
    await serveStatic(request, response, requestUrl);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : "服务器暂时开小差了。" });
    } else {
      response.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`烟火食迹 running at http://localhost:${PORT}`);
  console.log(`Records file: ${RECORDS_FILE}`);
});
