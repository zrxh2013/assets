#!/usr/bin/env bash
# 单元测试：验证 tunnel.sh 的公网 URL 抓取逻辑
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# 直接复制 tunnel.sh 里的两个核心抓取函数
extract_trycloudflare_url() {
  local text="$1"
  echo "$text" \
    | grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" \
    | grep -v "^https://api\.trycloudflare\.com$" \
    | head -1
}

extract_tunnel_url_from_json() {
  local text="$1"
  echo "$text" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ts = d.get('tunnels') or []
    if not ts:
        sys.exit(0)
    https_urls = [t['public_url'] for t in ts if str(t.get('public_url','')).startswith('https://')]
    if https_urls:
        print(https_urls[0])
    else:
        print(ts[0].get('public_url',''))
except Exception:
    pass
" 2>/dev/null
}

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

echo "测试 10: trycloudflare 多行文本，取第一个有效 URL"
LOG='INF Thank you for trying Cloudflare Tunnel.
INF Requesting new quick Tunnel on trycloudflare.com...
INF Your quick Tunnel has been created! Visit it at: https://first-xyz.trycloudflare.com
INF Connection ...'
URL=$(extract_trycloudflare_url "$LOG")
[ "$URL" = "https://first-xyz.trycloudflare.com" ] && pass "URL=$URL" || fail "got=$URL"

echo ""
echo "全部 10 个测试通过 ✓"
