# 从仓库根构建 PC 与学员 H5；配置仍由 Compose 挂载 deploy/nginx/default.conf。
FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
COPY mobile/package.json mobile/package-lock.json ./mobile/
RUN npm ci --prefix web --no-audit --no-fund \
    && npm ci --prefix mobile --no-audit --no-fund
COPY web/index.html web/vite.config.ts web/tsconfig.json ./web/
COPY web/src ./web/src
COPY mobile/index.html mobile/vite.config.ts mobile/tsconfig.json ./mobile/
COPY mobile/src ./mobile/src
COPY scripts/build.mjs scripts/build-lib.mjs ./scripts/
RUN node scripts/build.mjs web h5

FROM nginx:1.27-alpine
ENV TZ=Asia/Shanghai
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
