#!/usr/bin/env bash
# 启动 Hot App Radar 本地查看器
# 浏览器打开 http://localhost:5050/
exec python3 "$(dirname "$0")/server.py"
