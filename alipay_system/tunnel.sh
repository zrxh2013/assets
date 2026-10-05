#!/usr/bin/env bash
# 内网穿透启动脚本（支付宝回调调试用）
# ============================================================
# 自动检测本地隧道工具，按优先级使用：
#   1. ngrok      （如已配置 authtoken）
#   2. cpolar     （如已配置 authtoken）
#   3. cloudflared quick tunnel  （零配置，自动下载二进制）
#
# 用法：
#   bash tunnel.sh              # 默认穿透本地 8000 端口
#   bash tunnel.sh 9000         # 穿透本地 9000 端口
#   bash tunnel.sh 8000 --ssh   # 用 SSH 反向隧道（需 TUNNEL_SSH_HOST 环境变量）
#
# 启动后，脚本会把公网 URL 写入 .tunnel_url 文件，
# 支付宝回调配置 .env 时直接读这个文件。
# ============================================================
set -e

PORT="${1:-8000}"
MODE="${2:-auto}"
TUNNEL_URL_FILE="$(dirname "$0")/.tunnel_url"
TUNNEL_PID_FILE="$(dirname "$0")/.tunnel_pid"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[tunnel]${NC} $*"; }
ok()  { echo -e "${GREEN}[ok]${NC} $*"; }
warn(){ echo -e "${YELLOW}[warn]${NC} $*"; }

# ---------- 工具检测 ----------
have() { command -v "$1" >/dev/null 2>&1; }

# ---------- 策略 1：ngrok ----------
use_ngrok() {
  if ! have ngrok; then return 1; fi
  if ! ngrok config check >/dev/null 2>&1; then
    warn "ngrok 已安装但未配置 authtoken，跳过"
    warn "  执行: ngrok config add-authtoken <你的token>"
    return 1
  fi
  log "使用 ngrok 启动隧道 → 127.0.0.1:${PORT}"
  setsid ngrok http "${PORT}" --log=stdout > /tmp/tunnel_ngrok.log 2>&1 &
  echo $! > "$TUNNEL_PID_FILE"
  sleep 4
  # ngrok API 拉取公网地址
  local url
  url=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null || true)
  if [ -z "$url" ]; then
    warn "ngrok 启动了但未拿到公网 URL，查 /tmp/tunnel_ngrok.log"
    return 1
  fi
  echo "$url" > "$TUNNEL_URL_FILE"
  ok "ngrok 隧道就绪"
  return 0
}

# ---------- 策略 2：cpolar ----------
use_cpolar() {
  if ! have cpolar; then return 1; fi
  if [ ! -f "$HOME/.cpolar/cpolar.yml" ] && [ -z "$(cpolar token 2>/dev/null)" ]; then
    warn "cpolar 未配置 authtoken，跳过"
    warn "  执行: cpolar authtoken <你的token>"
    return 1
  fi
  log "使用 cpolar 启动隧道 → 127.0.0.1:${PORT}"
  setsid cpolar http "${PORT}" --log stdout > /tmp/tunnel_cpolar.log 2>&1 &
  echo $! > "$TUNNEL_PID_FILE"
  sleep 6
  # cpolar dashboard 在 9200
  local url
  url=$(curl -s http://127.0.0.1:9200/api/tunnels 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null || true)
  if [ -z "$url" ]; then
    warn "cpolar 启动了但未拿到公网 URL，查 /tmp/tunnel_cpolar.log"
    return 1
  fi
  echo "$url" > "$TUNNEL_URL_FILE"
  ok "cpolar 隧道就绪"
  return 0
}

# ---------- 策略 3：cloudflared quick tunnel（零配置） ----------
CF_BIN="$(dirname "$0")/.bin/cloudflared"

download_cloudflared() {
  if [ -x "$CF_BIN" ]; then return 0; fi
  log "下载 cloudflared 二进制（约 30MB，仅需一次）..."
  mkdir -p "$(dirname "$CF_BIN")"
  local arch url
  arch=$(uname -m)
  case "$arch" in
    x86_64)  arch="amd64";;
    aarch64) arch="arm64";;
    *) warn "未知架构 $arch"; return 1;;
  esac
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}"
  if command -v curl >/dev/null 2>&1; then
    curl -L -s -o "$CF_BIN" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$CF_BIN" "$url"
  else
    warn "需要 curl 或 wget 来下载 cloudflared"; return 1
  fi
  chmod +x "$CF_BIN"
  ok "cloudflared 下载完成: $CF_BIN"
}

use_cloudflared() {
  if have cloudflared; then
    CF_BIN="cloudflared"
  else
    if ! download_cloudflared; then return 1; fi
  fi
  log "使用 cloudflare quick tunnel → 127.0.0.1:${PORT}"
  # quick tunnel 模式：无需账号、无需登录，cloudflare 临时分配一个 trycloudflare.com 域名
  setsid "$CF_BIN" tunnel --url "http://127.0.0.1:${PORT}" \
      > /tmp/tunnel_cloudflared.log 2>&1 &
  echo $! > "$TUNNEL_PID_FILE"
  # cloudflared 启动日志里有 "Your quick Tunnel has been created! Visit it at: https://xxx.trycloudflare.com"
  # 真正的隧道域名形如 https://xxx-xxx-xxx.trycloudflare.com，不能匹配 api.trycloudflare.com（那是错误日志里的 API 端点）
  local url=""
  for i in $(seq 1 15); do
    sleep 2
    # 只匹配 "Your quick Tunnel has been created! Visit it at:" 行里的 URL，避免抓到错误信息里的 api 端点
    url=$(grep -E "Your quick Tunnel has been created" /tmp/tunnel_cloudflared.log 2>/dev/null \
          | grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" | head -1)
    [ -n "$url" ] && break
    # 检测明确的失败标志
    if grep -q "failed to request quick Tunnel" /tmp/tunnel_cloudflared.log 2>/dev/null; then
      warn "cloudflared 创建 quick tunnel 失败（可能是网络限制 / DNS / 出站被阻断）"
      warn "  查看日志: /tmp/tunnel_cloudflared.log"
      warn "  或换其他策略: bash tunnel.sh 8000 --ssh"
      return 1
    fi
  done
  if [ -z "$url" ]; then
    warn "cloudflared 启动了但 30 秒内未拿到公网 URL"
    warn "  查看日志: /tmp/tunnel_cloudflared.log"
    return 1
  fi
  echo "$url" > "$TUNNEL_URL_FILE"
  ok "cloudflared 隧道就绪"
  return 0
}

# ---------- 策略 4：SSH 反向隧道（可选） ----------
use_ssh() {
  local ssh_host="${TUNNEL_SSH_HOST:-}"
  local ssh_port="${TUNNEL_SSH_PORT:-22}"
  local ssh_user="${TUNNEL_SSH_USER:-root}"
  local remote_port="${TUNNEL_SSH_REMOTE_PORT:-8000}"
  if [ -z "$ssh_host" ]; then
    warn "SSH 模式需设置环境变量："
    warn "  export TUNNEL_SSH_HOST=你的公网服务器IP"
    warn "  export TUNNEL_SSH_USER=root"
    warn "  export TUNNEL_SSH_REMOTE_PORT=8000  # 公网服务器监听端口"
    return 1
  fi
  log "使用 SSH 反向隧道 → ${ssh_host}:${remote_port} → 127.0.0.1:${PORT}"
  setsid ssh -n -N -R "${remote_port}:127.0.0.1:${PORT}" \
      -p "$ssh_port" "$ssh_user@$ssh_host" > /tmp/tunnel_ssh.log 2>&1 &
  echo $! > "$TUNNEL_PID_FILE"
  sleep 2
  # 假设公网服务器有 https 域名指向 remote_port（用户自己配 nginx）
  local url="${TUNNEL_PUBLIC_URL:-http://${ssh_host}:${remote_port}}"
  echo "$url" > "$TUNNEL_URL_FILE"
  ok "SSH 反向隧道就绪（请确认公网服务器 ${ssh_host}:${remote_port} 已可达）"
  return 0
}

# ---------- 停止已有隧道 ----------
stop_existing() {
  if [ -f "$TUNNEL_PID_FILE" ]; then
    local old_pid
    old_pid=$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      log "停止已有隧道进程 PID=$old_pid"
      kill -9 "$old_pid" 2>/dev/null || true
    fi
    rm -f "$TUNNEL_PID_FILE"
  fi
  rm -f "$TUNNEL_URL_FILE"
}

# ---------- 主流程 ----------
if [ "$PORT" = "stop" ]; then
  stop_existing
  ok "隧道已停止"
  exit 0
fi

stop_existing

case "$MODE" in
  --ssh|ssh) use_ssh ;;
  --ngrok|ngrok) use_ngrok ;;
  --cpolar|cpolar) use_cpolar ;;
  --cf|cloudflared) use_cloudflared ;;
  auto|"")
    if use_ngrok; then
      TUNNEL_OK=1
    elif use_cpolar; then
      TUNNEL_OK=1
    elif use_cloudflared; then
      TUNNEL_OK=1
    elif use_ssh; then
      TUNNEL_OK=1
    fi
    ;;
  *) echo "未知模式: $MODE"; exit 2 ;;
esac

if [ ! -f "$TUNNEL_URL_FILE" ]; then
  echo ""
  warn "所有穿透策略均失败"
  echo ""
  echo "排查建议："
  echo "  1. 安装 ngrok:  https://ngrok.com/download"
  echo "  2. 安装 cpolar: https://www.cpolar.com/install"
  echo "  3. 网络通畅时脚本会自动下载 cloudflared"
  echo "  4. 有公网服务器用 SSH 反向隧道：bash tunnel.sh 8000 --ssh"
  exit 1
fi

URL=$(cat "$TUNNEL_URL_FILE")
echo ""
ok "隧道已就绪"
echo "  公网地址: ${URL}"
echo "  本地服务: http://127.0.0.1:${PORT}"
echo ""
echo "支付宝回调配置（写入 .env）："
echo "  ALIPAY_NOTIFY_URL=${URL}/alipay/notify"
echo "  ALIPAY_RETURN_URL=${URL}/pay/return"
echo ""
echo "  URL 已保存: $(readlink -f "$TUNNEL_URL_FILE")"
echo "  停止隧道: bash $(readlink -f "$0") stop"
