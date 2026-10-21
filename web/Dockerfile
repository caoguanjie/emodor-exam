# 前端构建产物镜像（多阶段：vite build → nginx 托管）
# nginx 配置由 docker-compose 以 bind mount 注入（deploy/nginx/default.conf，保持单一来源）
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
ENV TZ=Asia/Shanghai
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
