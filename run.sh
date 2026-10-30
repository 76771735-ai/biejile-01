#!/bin/sh
# 容器启动脚本（抖音云平台固定调用 /opt/application/run.sh）
cd "$(dirname "$0")"
exec node index.js
