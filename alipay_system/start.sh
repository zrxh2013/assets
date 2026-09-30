#!/bin/bash
# 支付宝收款码系统一键启动脚本
# 用法: bash start.sh

set -e
cd "$(dirname "$0")"

# ---------- Python 路径自动检测 ----------
# 优先使用 python3，若不可用则尝试常见 pyenv 路径
if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif [ -x "/root/.pyenv/shims/python3" ]; then
  PYTHON="/root/.pyenv/shims/python3"
elif [ -x "/usr/bin/python3" ]; then
  PYTHON="/usr/bin/python3"
else
  # 兜底：查找 pyenv 下最新版本的 python3
  LATEST=$(ls -d /root/.pyenv/versions/3.*/bin/python3 2>/dev/null | sort -V | tail -1)
  if [ -n "$LATEST" ]; then
    PYTHON="$LATEST"
  else
    echo "❌ 未找到可用的 python3，请先安装 Python 3"
    exit 1
  fi
fi
PIP="$PYTHON -m pip"
echo "使用 Python: $($PYTHON --version 2>&1) ($PYTHON)"

# 1. 检查并安装依赖
if ! $PYTHON -c "import flask, qrcode, PIL" 2>/dev/null; then
  echo "[1/3] 安装依赖中..."
  $PIP install -r requirements.txt --quiet 2>&1 | tail -2
else
  echo "[1/3] 依赖已就绪"
fi

# 2. 杀掉占用 8000 端口的旧进程
OLD_PID=$(lsof -ti:8000 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  echo "[2/3] 停止旧进程 PID=$OLD_PID"
  kill -9 $OLD_PID 2>/dev/null || true
  sleep 1
else
  echo "[2/3] 端口空闲"
fi

# 3. 后台启动服务（使用 setsid 脱离终端，避免随父进程退出）
echo "[3/3] 启动服务..."
setsid $PYTHON app.py > /tmp/alipay_server.log 2>&1 < /dev/null &
NEW_PID=$!
echo "服务进程 PID=$NEW_PID"

# 4. 等待并验证
sleep 3
if curl -s -o /dev/null --max-time 5 http://127.0.0.1:8000/login; then
  echo ""
  echo "✅ 启动成功！"
  echo "   登录页: http://127.0.0.1:8000/login"
  echo "   测试账号: demo / 123456"
  echo "   日志: /tmp/alipay_server.log"
else
  echo ""
  echo "❌ 启动失败，日志如下:"
  cat /tmp/alipay_server.log
  exit 1
fi
