# 从仓库根构建 PC 与学员 H5，镜像自带经过校验的 nginx 模板与公开媒体定位。
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_COS_MEDIA_ORIGIN=
ARG VITE_COS_MEDIA_PREFIX=
ARG VITE_PUBLIC_H5_BASE_URL=
ARG COS_BUCKET=
ARG COS_REGION=
ARG COS_KEY_PREFIX=ruleexam/dev/
COPY web/package.json web/package-lock.json ./web/
COPY mobile/package.json mobile/package-lock.json ./mobile/
RUN npm ci --prefix web --no-audit --no-fund \
    && npm ci --prefix mobile --no-audit --no-fund
COPY web/index.html web/vite.config.ts web/tsconfig.json ./web/
COPY web/build/public-env.ts ./web/build/
COPY web/src ./web/src
COPY mobile/index.html mobile/vite.config.ts mobile/tsconfig.json ./mobile/
COPY mobile/build/public-env.ts mobile/build/mp-public-config.mjs ./mobile/build/
COPY mobile/src ./mobile/src
COPY scripts/build.mjs scripts/build-lib.mjs ./scripts/
COPY deploy/nginx/public-media-config.mjs ./deploy/nginx/
RUN node deploy/nginx/public-media-config.mjs /app/public-media.env \
    && . /app/public-media.env \
    && node scripts/build.mjs web h5

FROM nginx:1.27-alpine
ENV TZ=Asia/Shanghai
ENV NGINX_ENVSUBST_FILTER=^COS_MEDIA_CSP_SOURCE$
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/public-media.env /etc/nginx/public-media.env
COPY deploy/nginx/default.conf /etc/nginx/templates/default.conf.template
COPY deploy/nginx/15-public-media.envsh /docker-entrypoint.d/15-public-media.envsh
RUN chmod +x /docker-entrypoint.d/15-public-media.envsh
EXPOSE 80
