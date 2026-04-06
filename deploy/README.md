# 出片地图生产部署（MySQL + Redis + 后端 + Web）

目录下默认按生产级最小体量部署结构组织：

- `backend/`：Express API（端口 3000）
- `deploy/docker-compose.yml`：编排 MySQL、Redis、后端、前端静态站、Nginx
- `deploy/nginx.conf`：Nginx 反向代理，把 `/api`、`/api/v1`、`/media`、`/health` 透传到后端，其余走前端
- `deploy/web.Dockerfile`：构建前端静态资源并在 80 提供服务

## 一键启动

```bash
cd /home/agentuser/workspace/chupian-app/deploy
docker compose up -d --build
```

启动后：
- 前端页面：http://localhost（Nginx 监听 80）
- API 健康检查：http://localhost/health
- 数据库数据持久化到 Docker volume：`mysql_data`

## 环境变量

- 后端：
  - `MYSQL_HOST=mysql`
  - `MYSQL_PORT=3306`
  - `MYSQL_DATABASE=chupian`
  - `MYSQL_USER=chupian`
  - `MYSQL_PASSWORD=chupian_pwd`
- `REDIS_URL=redis://redis:6379`
- `MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD`：生产环境必须通过 `.env` 或部署系统注入，不要使用 compose 默认值
- `MYSQL_CONNECTION_LIMIT`、`MYSQL_QUEUE_LIMIT`：分别控制连接池大小和排队上限

- 前端（移动端发布配置）
  - `.env` 或 `EXPO_PUBLIC_API_BASE` 指向后端网关，如 `http://api.your-domain.com`

> 如果你是用 `docker-compose` + Nginx 一体化部署，前端 web 包会自动使用当前域名同源地址作为 API 基础地址，无需额外设置 `EXPO_PUBLIC_API_BASE`。

> 前端静态站默认由 `nginx` 监听 80 对外输出。`web` 服务与 `api` 保持独立端口（80），仅通过内网反代。

## 常见运维建议（轻量高并发）

1. 使用 CDN 缓存 `dist` 静态资源（`/` 下入口文件、图片、JS/CSS）；
2. 启用 Redis 短 TTL 缓存热点 feed/list；
3. MySQL 建立复合索引（`posts(status, created_at, id)` / `posts(status, stats_likes, created_at, id)` 等）；
4. `apiLimiter` 可调整为按 IP + UID 的更细粒度，并结合反向代理统一限速；
5. 每次发布前执行 `mysql schema.sql` 与 `npm run qa`（需确保数据库与缓存服务就绪）。
