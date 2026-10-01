#!/bin/bash
# 支付宝收款码系统一键启动脚本
# 用法: bash start.sh

set -e
cd "$(dirname "$0")"

# ---------- Python 路径自动检测 ----------
# 收集所有候选 python3，优先 pyenv，然后系统
CANDIDATES=()
if command -v python3 >/dev/null 2>&1; then CANDIDATES+=("python3"); fi
[ -x "/root/.pyenv/shims/python3" ] && CANDIDATES+=("/root/.pyenv/shims/python3")
for p in /root/.pyenv/versions/3.*/bin/python3; do [ -x "$p" ] && CANDIDATES+=("$p"); done
[ -x "/usr/bin/python3" ] && CANDIDATES+=("/usr/bin/python3")
[ -x "/usr/local/bin/python3" ] && CANDIDATES+=("/usr/local/bin/python3")

PYTHON=""
for cand in "${CANDIDATES[@]}"; do
  # 已有依赖直接用
  if $cand -c "import flask, qrcode, PIL" 2>/dev/null; then
    PYTHON="$cand"
    break
  fi
  # 无依赖则尝试安装（仅当该 python 有 pip）
  if $cand -m pip --version >/dev/null 2>&1; then
    $cand -m pip install -r requirements.txt --quiet 2>/dev/null
    if $cand -c "import flask, qrcode, PIL" 2>/dev/null; then
      PYTHON="$cand"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "❌ 未找到可用的 python3（含 flask/qrcode/pillow），请先安装 Python 3 和依赖"
  exit 1
fi
PIP="$PYTHON -m pip"
echo "使用 Python: $($PYTHON --version 2>&1) ($PYTHON)"

# 1. 依赖已在上面的检测中就绪
echo "[1/3] 依赖已就绪"

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
