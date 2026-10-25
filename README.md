# 烟火食迹 · 人间风味地图

一个以“全国 → 省份 → 地区”为浏览路径的多人地域美食图鉴。前端使用 ECharts + GeoJSON，后端使用 Node.js 内置 HTTP 服务与轻量 JSON 存储，不依赖数据库或云服务即可运行。

## 启动

```powershell
cd outputs
npm start
```

浏览器打开 `http://localhost:4173`。

也可以直接运行：

```powershell
node outputs/server.mjs
```

## 已实现

- 入口页「查询 / 记录」双模式。
- 首屏仅请求全国 GeoJSON；点击省份后才加载对应省级文件。
- 省级地图展示下辖地区，地区为最末级，点击后打开风味档案抽屉，不再继续下钻。
- 查询模式只读；记录模式在地区档案右下角显示笔形 FAB。
- 照片分片校验、Canvas 压缩、2MB 二次校验；超限照片在浏览器端直接拒绝。
- 记录通过 `POST /api/records` 写入 `data/records.json`，图片保存至 `data/uploads/`。
- JSON 写入采用排队与临时文件原子替换，可承接多人并发提交。
- 桌面与移动端响应式；CSS 烟雾、Lucide SVG 图腾和缓动过渡。
- 服务不可用时，前端自动退回浏览器 `localStorage` 演示存储。

## 数据接口

- `GET /api/stats`：总数、地区数、各省份记录数。
- `GET /api/records?regionId=440100`：读取某地区记录。
- `POST /api/records`：新增记录，图片以 data URL 提交，服务端再次校验格式与 2MB 上限。

## 重置演示数据

将 `data/records.json` 恢复为当前种子记录，并清空 `data/uploads/` 中的上传图片即可。种子内容同时位于 `data.js`，供无服务端模式下浏览。

## 部署

### Render（免费）

仓库已包含 `render.yaml`。在 [Render](https://render.com) 上选择 **New → Blueprint** 或 **New Web Service**，连接本仓库，Render 会自动识别 `package.json` 并执行：

```
npm install
node server.mjs
```

服务监听 `process.env.PORT`（由 Render 注入），无需额外配置。

### 免费计划的限制

- Render 免费 Web Service 无持久磁盘，`data/records.json` 会在每次部署时重置为仓库内的种子数据，`data/uploads/` 中的用户上传图片会随容器重启丢失。
- 15 分钟无请求会休眠，下次访问需冷启动约 30 秒。
- 如需持久化数据，可升级付费计划并挂载磁盘，或改用 Postgres / 对象存储。

### 其他平台

任何支持 Node.js 的 PaaS（Railway、Fly.io、Zeabur、Koyeb）均可部署：

```bash
npm install
node server.mjs
```

监听端口取 `$PORT` 环境变量或回退到 4173。

## 资源说明

ECharts、Lucide、中国行政区划 GeoJSON 与食物示例照均已本地化，页面运行时不依赖第三方 CDN。

## License

MIT © 2026 cheesecanD41
