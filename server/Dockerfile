# RuleExam API 服务镜像（NestJS，Node 22 —— unpdf@1.8.1 要求 engines.node>=22，勿降级）
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json && cp package.json dist/../ && \
    mkdir -p /staging && cp -r node_modules /staging/node_modules

FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app
# 扫描版 PDF 多模态兜底需要 pdfinfo / pdftoppm，将页面渲染为 image_url。
RUN apk add --no-cache poppler-utils
# 运行期依赖仅 prod（镜像瘦身）：直接复用 build 阶段 node_modules（当前全为运行所需）
COPY --from=build /staging/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data/uploads /app/data/logs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health > /dev/null 2>&1 || exit 1
CMD ["node", "dist/main.js"]
