# 抖音云容器服务部署镜像（Node 18）
# 平台约定：应用目录 /opt/application，启动命令 /opt/application/run.sh（由平台注入，无需 ENTRYPOINT）
# 若构建时拉取 DockerHub 失败（2024 年后大陆无法直连），把下一行换成国内镜像源：
# FROM docker.m.daocloud.io/library/node:18-alpine
FROM node:18-alpine
MAINTAINER bijiele
WORKDIR /opt/application
COPY package.json ./
# 用国内 npm 镜像装依赖
RUN npm install --registry=https://registry.npmmirror.com/
COPY . .
RUN chmod +x ./run.sh
EXPOSE 8000
