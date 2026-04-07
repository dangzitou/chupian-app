# 出片地图 手机端（Chupian App）

这是出片地图的 React Native / Expo 移动端，围绕广州拍照机位与出片攻略做了一个更偏「内容社区」的体验：

- 点位列表 + 时段筛选
- 点位详情（机位、时间、提示）
- 小红书式「出片帖」列表（支持标题、正文、标签、拍摄参数）
- 一键发布：地点、角度、方向、相机、焦距、快门、ISO 等摄影参数 + 图片/视频/实况素材
- 点赞 / 收藏 / 评论互动闭环
- 内嵌网页版地图（WebView）
- 天气卡片 + 统计面板

🌐 语言： [中文 README](README.md) · [English README](README.en.md)

## 本地运行

```bash
cd /home/agentuser/workspace/chupian-app
npm install
npm run start
```

打开 Expo 菜单可选择：

- `a`：Android
- `i`：iOS 模拟器/真机
- `w`：Web

## 服务器配置

移动端默认请求 `http://42.194.251.188`，建议改为环境变量注入，避免硬编码 IP：

```bash
EXPO_PUBLIC_API_BASE=https://your-domain-or-ip
npm run start
```

`src/config.js` 兼容优先级：

1. `EXPO_PUBLIC_API_BASE`
2. `API_BASE`
3. 内置默认地址（用于开发回退）

## 项目结构

```text
chupian-app/
├── App.js                  # 底部 Tab + 路由
├── src/
│   ├── screens/            # 各页面
│   ├── api.js              # API 请求封装
│   ├── config.js           # 配色 + API_BASE
│   └── data/ categories.js  # 分类常量
├── assets/                 # 应用图标
└── app.json                # Expo 配置
```

## 与后端协同

后端现在支持 `/api/v1` 与传统 `/api` 两套兼容路径（优先 `/api/v1`）：

- 健康检查
  - `GET /api/v1/health`
- 点位
  - `GET /api/v1/spots`
  - `GET /api/spots`（兼容）
- 社区
  - `GET /api/v1/community/feed`
    - 支持查询参数：`q`（关键词）、`tag`（标签/风格）、`sort`（latest/hot）、`cursor`、`limit`
  - `GET /api/v1/posts`
    - 支持查询参数：`q`（关键词）、`tag`（标签/风格）、`sort`（latest/hot）、`cursor`、`limit`
  - `GET /api/v1/community/discovery`
    - 返回 `signals`（热门标签/风格排行榜），可选 `type=tag|style` 与 `limit`
  - `GET /api/v1/posts/{id}`
  - `POST /api/v1/posts`
  - `POST /api/v1/posts/{id}/like`
  - `POST /api/v1/posts/{id}/favorite`
  - `POST /api/v1/posts/{id}/comments`
  - `POST /api/v1/media/upload`
  - `GET /api/v1/community/me/likes`（我的点赞）
  - `GET /api/v1/community/me/favorites`（我的收藏）
  - `GET /api/v1/weather`
- 兼容端点
  - `GET /api/posts`
  - `GET /api/posts/{id}`
  - `POST /api/posts`
  - `POST /api/posts/{id}/like`
  - `POST /api/posts/{id}/favorite`
  - `POST /api/posts/{id}/comment`
  - `POST /api/posts/{id}/comments`
  - `GET /api/weather`

## 联调与安全验证（本地）

```bash
cd backend && npm install
cd ..
npm run qa:integration      # 联调核验（健康检查、接口兼容、核心业务流程）
npm run qa:adversarial      # 攻防/对抗性测试（异常参数、边界输入、非法文件类型、签名）
```

无数据库可用时，`qa:integration` 会标记数据库依赖项为“待补环境”而非失败；若要做完整验收，请启动 MySQL/Redis 并执行：

```bash
cd backend && mysql -h 127.0.0.1 -u root -p < schema.sql
REDIS_URL=redis://127.0.0.1:6379 QA_REQUIRE_DB=1 npm run qa:integration
```

## Web 部署到 80 端口（可发布）

> 先确认后端在 3000（或自定义端口）可访问。

```bash
# 1) 打包 web 前端
npm run web:build

# 2) 使用静态服务发布到 80 端口（同机部署）
npm run web:serve

# 示例：绑定到自定义域名（nginx 反代到 80）
npx serve web-build -l 80 --single
```

### 一键生产部署（含数据库与 Redis）

```bash
cd deploy
docker compose up -d --build
```

服务会以 80 端口对外（Nginx），并通过同网关把 `/api`、`/media`、`/health` 代理到后端服务。

## 生产级可用说明（生产前建议）

- 后端使用 **MySQL + Redis + Node**：已内置连接池、请求限流、缓存和缓存失效逻辑；
- 评论/点赞/收藏统一通过 `postId + actorId` 幂等化，支持高并发幂等写入；
- feed 查询已补充高频索引（`schema.sql`）：热点列表按 `status + created_at` 与 `status + stats_likes` 多维索引；
- 上线前执行：
  - `cd backend && npm i && npm start`
  - `cd .. && npm run qa:integration`
  - `cd .. && npm run qa:adversarial`

## 说明

- 本项目当前状态为 `App v0.1`
- 目标是“可上线的 MVP”，后续建议补充登录态、图片上传、离线缓存与推送。
