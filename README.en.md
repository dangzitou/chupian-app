# Chupian App (Expo)

A lightweight mobile client for Chupian Map, focused on Guangzhou shooting spots and photo guides.

Features:

- Spot list + time filters
- Spot detail pages (angles, time, suggestions)
- Xiaohongshu-style community feed for shooting posts (title/content/tags/camera meta)
- One-click publish flow with photo info (spot, angle, direction, lens/focal/iso, etc.) + image/video/live media
- Interaction loop: like, favorite, comments
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

The app supports both `/api/v1` and legacy `/api` endpoints (prefers `/api/v1`):

- Health
  - `GET /api/v1/health`
- Spots
  - `GET /api/v1/spots`
  - `GET /api/spots` (compat)
- Community
  - `GET /api/v1/community/feed`
    - supports query params: `q` (keyword), `tag` (tag/style), `sort` (latest/hot), `cursor`, `limit`
  - `GET /api/v1/posts`
    - supports query params: `q` (keyword), `tag` (tag/style), `sort` (latest/hot), `cursor`, `limit`
  - `GET /api/v1/community/discovery`
    - returns `signals` (trending tag/style list), optional `type=tag|style` and `limit`
  - `GET /api/v1/posts/{id}`
  - `POST /api/v1/posts`
  - `POST /api/v1/posts/{id}/like`
  - `POST /api/v1/posts/{id}/favorite`
  - `POST /api/v1/posts/{id}/comments`
  - `POST /api/v1/media/upload`
  - `GET /api/v1/community/me/likes`
  - `GET /api/v1/community/me/favorites`
  - `GET /api/v1/weather`
- Compatibility endpoints
  - `GET /api/posts`
  - `GET /api/posts/{id}`
  - `POST /api/posts`
  - `POST /api/posts/{id}/like`
  - `POST /api/posts/{id}/favorite`
  - `POST /api/posts/{id}/comment`
  - `POST /api/posts/{id}/comments`
  - `GET /api/weather`

## Local QA (integration + adversarial)

```bash
cd backend && npm install
cd ..
npm run qa:integration
npm run qa:adversarial
```

If DB is not available, DB-dependent checks are reported as warnings; for full mode:

```bash
cd backend && mysql -h 127.0.0.1 -u root -p < schema.sql
REDIS_URL=redis://127.0.0.1:6379 QA_REQUIRE_DB=1 npm run qa:integration
```

## Web deploy on port 80

> Ensure the backend is reachable first (default `http://localhost:3000`).

```bash
npm run web:build
npm run web:serve
npx serve web-build -l 80 --single
```

### Production deploy (MySQL + Redis + backend + nginx)

```bash
cd deploy
docker compose up -d --build
```

Nginx listens on 80 and proxies `/api`, `/media`, `/health` to the backend.

## Production readiness checklist

- Backend uses **MySQL + Redis + Node** with pooling, rate limiting, and cache invalidation.
- Like/favorite/comment writes are idempotent based on `postId + actorId`.
- Feed critical indexes are included in `backend/schema.sql` (`status + created_at`, `status + stats_likes` etc.) for high-concurrency reads.
- Recommended before go-live:
  - `cd backend && npm i && npm start`
  - `cd .. && npm run qa:integration`
  - `cd .. && npm run qa:adversarial`

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
