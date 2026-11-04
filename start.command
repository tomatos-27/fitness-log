#!/bin/zsh

set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3。请先安装 Python 3，再重新运行。"
  read -r "?按回车键关闭…"
  exit 1
fi

FITNESS_LOG_PORT=4173
FITNESS_LOG_URL="http://localhost:${FITNESS_LOG_PORT}"

echo "Fitness Log 正在运行：${FITNESS_LOG_URL}"
echo "关闭此窗口即可停止。"

python3 -m http.server "${FITNESS_LOG_PORT}" --bind 127.0.0.1 &
FITNESS_LOG_SERVER_PID=$!
trap 'kill "${FITNESS_LOG_SERVER_PID}" 2>/dev/null || true' EXIT INT TERM

sleep 1
open "${FITNESS_LOG_URL}"
wait "${FITNESS_LOG_SERVER_PID}"
