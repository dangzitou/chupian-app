# Chupian App (Expo)

A lightweight mobile client for Chupian Map, focused on Guangzhou shooting spots and photo guides.

Features:

- Spot list + time filters
- Spot detail pages (angles, time, suggestions)
- Post list + publish guide + like + comments
- Embedded web map (WebView)
- Weather cards + statistics panel

🌐 Languages: [中文 README](README.md) · [English README](README.en.md)

## Run locally

```bash
cd /home/agentuser/workspace/chupian-app
npm install
npm run start
```

From the Expo menu:

- `a`: Android
- `i`: iOS simulator/device
- `w`: Web

## API base URL

By default, app requests `http://42.194.251.188`.
Use environment variables to avoid hardcoding:

```bash
EXPO_PUBLIC_API_BASE=https://your-domain-or-ip
npm run start
```

`src/config.js` resolution order:

1. `EXPO_PUBLIC_API_BASE`
2. `API_BASE`
3. Built-in fallback address

## Backend contracts

The app expects `chupian-map/server.py` compatible endpoints:

- `GET /api/spots`
- `GET /api/posts`
- `POST /api/posts`
- `POST /api/posts/{id}/like`
- `POST /api/posts/{id}/comment`
- `GET /api/weather`

## Project structure

```text
chupian-app/
├── App.js                  # bottom tab + stack navigation
├── src/
│   ├── screens/            # screens
│   ├── api.js              # API wrappers
│   ├── config.js           # theme + API_BASE
│   └── data/ categories.js  # category constants
├── assets/                 # app icons
└── app.json                # Expo config
```

## Roadmap

- Add auth/session
- Upload cover images directly
- Offline cache
- Push notifications

## Note

- Project state: `App v0.1`
- Target: production-ready MVP
