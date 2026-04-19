FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run web:build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/public /usr/share/nginx/html
COPY deploy/web-static.conf /etc/nginx/conf.d/default.conf
RUN sed -i 's|</head>|<link rel="manifest" href="/manifest.json" /><meta name="theme-color" content="#d93657" /></head>|' /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
