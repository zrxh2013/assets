#!/bin/bash
# TRON 私链节点启动脚本
# 必须使用 Java 8，因为 Java 9+ 移除了 javax.annotation.PostConstruct，
# 导致 Manager.init() 的 @PostConstruct 不被处理，创世块无法创建。

JAVA8_HOME="/root/.local/share/mise/installs/java/temurin-8.0.502+7"
NODE_DIR="/workspace/private-chain/tron-node"
JAR="$NODE_DIR/FullNode.jar"
CONF="$NODE_DIR/config.conf"
LOG="$NODE_DIR/logs/tron.log"
PIDFILE="$NODE_DIR/tron-node.pid"

if [ ! -d "$JAVA8_HOME" ]; then
  echo "❌ Java 8 未找到: $JAVA8_HOME"
  exit 1
fi

JAVA="$JAVA8_HOME/bin/java"

cd "$NODE_DIR" || exit 1

case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "⚠️ 节点已在运行 (PID: $(cat "$PIDFILE"))"
      exit 0
    fi
    echo "🚀 启动 TRON 私链节点 (Java 8)..."
    nohup "$JAVA" -jar "$JAR" -c "$CONF" --witness > /dev/null 2>&1 &
    echo $! > "$PIDFILE"
    echo "PID: $(cat "$PIDFILE")"
    echo "等待节点初始化..."
    sleep 5
    for i in $(seq 1 30); do
      if curl -s -X POST http://127.0.0.1:18090/wallet/getnowblock 2>/dev/null | grep -q '"blockID"'; then
        echo "✅ 节点启动成功"
        exit 0
      fi
      sleep 2
    done
    echo "⚠️ 节点可能未完全启动，请检查日志: $LOG"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      PID=$(cat "$PIDFILE")
      echo "🛑 停止节点 (PID: $PID)..."
      kill "$PID" 2>/dev/null
      sleep 3
      kill -9 "$PID" 2>/dev/null
      rm -f "$PIDFILE"
      echo "✅ 节点已停止"
    else
      echo "⚠️ 未找到 PID 文件，尝试查找 java 进程..."
      pkill -9 -f "FullNode.jar"
    fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "✅ 节点运行中 (PID: $(cat "$PIDFILE"))"
      curl -s -X POST http://127.0.0.1:18090/wallet/getblockbylatestnum -H "Content-Type: application/json" -d '{"num":1}' 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('区块高度:', d['block'][0]['block_header']['raw_data']['number'])" 2>/dev/null
    else
      echo "❌ 节点未运行"
      exit 1
    fi
    ;;
  restart)
    "$0" stop
    sleep 2
    "$0" start
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
