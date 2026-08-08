FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run web:build

FROM node:22-alpine
WORKDIR /app
RUN npm i -g serve

COPY --from=builder /app/dist ./dist
EXPOSE 80
CMD ["serve", "dist", "-l", "80", "--single"]
