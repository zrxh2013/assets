#!/usr/bin/env bash
# 单元测试：验证 tunnel.sh 的公网 URL 抓取逻辑
# 用法：bash test_tunnel_extract.sh
# 特点：通过 source 复用 tunnel.sh 里的真实函数定义，避免代码不同步
set -e

# ---------- 路径解析（支持从任意目录运行） ----------
# $BASH_SOURCE 是当前脚本路径，$0 在某些 shell 里不可靠
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUNNEL_SH="$SCRIPT_DIR/tunnel.sh"

if [ ! -f "$TUNNEL_SH" ]; then
  echo "错误：找不到 tunnel.sh（期望路径：$TUNNEL_SH）" >&2
  exit 1
fi

# ---------- 颜色输出 ----------
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}" >&2; exit 1; }

# ---------- 从 tunnel.sh 加载函数定义 ----------
# 通过 TUNNEL_LIB_ONLY=1 让 tunnel.sh 跳过主流程，只暴露函数
TUNNEL_LIB_ONLY=1 source "$TUNNEL_SH"

# 校验关键函数已加载
if ! declare -f extract_trycloudflare_url >/dev/null 2>&1; then
  fail "extract_trycloudflare_url 未从 tunnel.sh 加载"
fi
if ! declare -f extract_tunnel_url_from_json >/dev/null 2>&1; then
  fail "extract_tunnel_url_from_json 未从 tunnel.sh 加载"
fi

# ---------- 测试用例 ----------

echo "测试 1: 标准成功日志"
LOG='2026-10-05T20:47:39Z INF Your quick Tunnel has been created! Visit it at: https://abc123-def456-789.trycloudflare.com'
URL=$(extract_trycloudflare_url "$LOG")
[ "$URL" = "https://abc123-def456-789.trycloudflare.com" ] && pass "URL=$URL" || fail "got=$URL"

echo "测试 2: 错误日志含 api.trycloudflare.com，应排除"
LOG='failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded'
URL=$(extract_trycloudflare_url "$LOG")
[ -z "$URL" ] && pass "正确返回空" || fail "got=$URL"

echo "测试 3: 错误日志和成功 URL 同时存在，只取有效 URL"
LOG='2026-10-05T20:47:39Z INF Your quick Tunnel has been created! Visit it at: https://real-xyz.trycloudflare.com
failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": timeout'
URL=$(extract_trycloudflare_url "$LOG")
[ "$URL" = "https://real-xyz.trycloudflare.com" ] && pass "URL=$URL" || fail "got=$URL"

echo "测试 4: 大小写混合的隧道 ID"
LOG='INF Your quick Tunnel has been created! Visit it at: https://AbCdEf-1234-XYZ.trycloudflare.com'
URL=$(extract_trycloudflare_url "$LOG")
[ "$URL" = "https://AbCdEf-1234-XYZ.trycloudflare.com" ] && pass "URL=$URL" || fail "got=$URL"

echo "测试 5: 没有任何 trycloudflare URL"
LOG='some random log content without url'
URL=$(extract_trycloudflare_url "$LOG")
[ -z "$URL" ] && pass "空输入返回空" || fail "got=$URL"

echo "测试 6: extract_tunnel_url_from_json 优先 https"
JSON='{"tunnels":[{"name":"http","public_url":"http://0.tcp.ngrok.io:1234"},{"name":"https","public_url":"https://abc.ngrok-free.app"}]}'
URL=$(extract_tunnel_url_from_json "$JSON")
[ "$URL" = "https://abc.ngrok-free.app" ] && pass "优先 https: URL=$URL" || fail "got=$URL"

echo "测试 7: extract_tunnel_url_from_json 空 tunnels"
JSON='{"tunnels":[]}'
URL=$(extract_tunnel_url_from_json "$JSON")
[ -z "$URL" ] && pass "空 tunnels 返回空" || fail "got=$URL"

echo "测试 8: extract_tunnel_url_from_json 损坏 JSON"
JSON='not json'
URL=$(extract_tunnel_url_from_json "$JSON")
[ -z "$URL" ] && pass "损坏 JSON 返回空" || fail "got=$URL"

echo "测试 9: extract_tunnel_url_from_json 只有 http 隧道"
JSON='{"tunnels":[{"name":"http","public_url":"http://x.tcp.ngrok.io:80"}]}'
URL=$(extract_tunnel_url_from_json "$JSON")
[ "$URL" = "http://x.tcp.ngrok.io:80" ] && pass "URL=$URL" || fail "got=$URL"

echo "测试 10: trycloudflare 多行日志，取第一个有效 URL"
LOG='INF Thank you for trying Cloudflare Tunnel.
INF Requesting new quick Tunnel on trycloudflare.com...
INF Your quick Tunnel has been created! Visit it at: https://first-xyz.trycloudflare.com
INF Connection ...'
URL=$(extract_trycloudflare_url "$LOG")
[ "$URL" = "https://first-xyz.trycloudflare.com" ] && pass "URL=$URL" || fail "got=$URL"

echo ""
echo "全部 10 个测试通过 ✓"
echo "（已通过 source 复用 $TUNNEL_SH 中的函数定义）"
