FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# 视频在运行阶段单独成层，这里删掉以免重复
RUN npm run build_sup && rm -rf dist/videos

# 运行阶段只含构建产物与登录服务，服务端没有第三方依赖
# 分层顺序按变动频率排列，视频最少变动，部署时只需上传变动的层
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist DATA_DIR=/data
COPY public/videos ./dist/videos
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
