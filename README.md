# 出片地图 手机端（Chupian App）

这是出片地图的 React Native / Expo 移动端，围绕广州拍照机位与出片攻略做了一个轻量体验：

- 点位列表 + 时段筛选
- 点位详情（机位、时间、提示）
- 攻略列表 + 发布攻略 + 点赞 + 评论
- 内嵌网页版地图（WebView）
- 天气卡片 + 统计面板

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

推荐后端保持与 `chupian-map/server.py` 同源接口，不变更以下路径：

- `GET /api/spots`
- `GET /api/posts`
- `POST /api/posts`
- `POST /api/posts/{id}/like`
- `POST /api/posts/{id}/comment`
- `GET /api/weather`

## 说明

- 本项目当前状态为 `App v0.1`
- 目标是“可上线的 MVP”，后续建议补充登录态、图片上传、离线缓存与推送。
