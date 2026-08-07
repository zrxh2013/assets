#!/bin/bash
# 支付宝收款码系统一键启动脚本
# 用法: bash /workspace/alipay_system/start.sh

set -e
cd "$(dirname "$0")"

# 1. 检查并安装依赖
if ! python3 -c "import flask, qrcode, PIL" 2>/dev/null; then
  echo "[1/3] 安装依赖中..."
  pip3 install -r requirements.txt --quiet 2>&1 | tail -2
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

# 3. 后台启动服务
echo "[3/3] 启动服务..."
nohup python3 app.py > /tmp/alipay_server.log 2>&1 &
NEW_PID=$!
echo "服务进程 PID=$NEW_PID"

# 4. 等待并验证
sleep 2
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:8000/login; then
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
