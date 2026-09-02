#!/usr/bin/env python3
"""
anchor-v3.py — 带 memo 的主网 TRX 转账锚定脚本
修复:
  1. createtransaction 需要 hex 地址（原 Base58）
  2. raw_data JSON 里的合约字段也用 hex
  3. 错误地使用了 .substring() / .length 等 JS 风格
  4. Python 中 .substring() 不存在，改用切片 [:]
  5. 所有地址/数字格式化规范
"""

import urllib.request
import json
import subprocess
import time
import sys
from pathlib import Path

# ========== 配置 ==========
HERE = Path(__file__).resolve().parent.parent

SEND_HEX   = "41853164f135d68b65b7492fe29009bf0dc08b6311"   # TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ
SEND_B58   = "TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ"
BURN_HEX   = "410000000000000000000000000000000000000000"   # T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb
BURN_B58   = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
PRIV_KEY   = "4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309"
FULL_HOST  = "https://api.trongrid.io"
ANCHOR_FILE = HERE / "assets" / "anchor-result-v2.json"


def _log(tag, msg=""):
    print(f"\n[{tag}] {msg}")


def _http(url, payload):
    """统一的 TronGrid HTTP 调用"""
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def main():
    # ====== 读取 anchor 数据 ======
    if not ANCHOR_FILE.exists():
        print(f"❌ 找不到 {ANCHOR_FILE}")
        sys.exit(1)

    with open(ANCHOR_FILE, "r") as f:
        anchor = json.load(f)
    anchor_map = anchor.get("anchorMap", [])
    merkle_root = anchor.get("merkleRoot", "")
    stats = anchor.get("stats", {})

    # ====== 构造 memo ======
    memo_obj = {
        "a": "usdt-1156-anchor",
        "v": "2.0",
        "n": "TRON-MAINNET",
        "s": "TRON-NILE",
        "c": stats.get("nileContract", "TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq"),
        "m": merkle_root,
        "t": len(anchor_map),
        "u": stats.get("uniqueFrom", 2),
        "r": stats.get("uniqueTo", 247),
        "amt": stats.get("totalAmountDisplay", "599999904.27"),
        "samples": [
            {"i": 0,    "ah": anchor_map[0]["anchor_hash"][2:20]},
            {"i": 500,  "ah": anchor_map[499]["anchor_hash"][2:20]},
            {"i": 1155, "ah": anchor_map[-1]["anchor_hash"][2:20]},
        ],
        "ts": int(time.time()),
    }
    memo_str = json.dumps(memo_obj, separators=(",", ":"))
    print(f"Memo: {len(memo_str)} bytes")
    if len(memo_str) > 900:
        print(f"⚠️  memo 超过 900 字节限制 ({len(memo_str)})，尝试压缩...")
        # 截断 samples
        memo_obj["samples"] = [{"i":0, "ah":anchor_map[0]["anchor_hash"][2:18]}]
        del memo_obj["n"]
        del memo_obj["s"]
        memo_str = json.dumps(memo_obj, separators=(",", ":"))
        print(f"压缩后: {len(memo_str)} bytes")

    # ====== 1. createtransaction (hex 地址) ======
    _log("1", "构建 TRX 转账交易 (hex 地址)...")
    try:
        ct = _http(f"{FULL_HOST}/wallet/createtransaction", {
            "owner_address": SEND_HEX,
            "to_address": BURN_HEX,
            "amount": 1,
        })
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"❌ 构建失败 HTTP {e.code}: {body}")
        sys.exit(1)

    if "Error" in ct:
        print(f"❌ 构建失败: {ct['Error']}")
        sys.exit(1)

    raw_data_hex = ct.get("raw_data_hex", "")
    print(f"    raw_data_hex: {len(raw_data_hex)} chars")

    # ====== 2. 注入 memo + 签名 + 广播（通过 Node.js subprocess 调用 tronweb） ======
    _log("2", "注入 memo protobuf + 签名 + 广播...")

    node_code = rf"""
const {{ TronWeb }} = require('tronweb');
const {{ Buffer }} = require('buffer');
const fs = require('fs');
const path = require('path');

const PRIV_KEY = "{PRIV_KEY}";
const FULL_HOST = "{FULL_HOST}";
const rawHex = "{raw_data_hex}";
const memoStr = {json.dumps(memo_str)};

const tw = new TronWeb({{ fullHost: FULL_HOST, privateKey: PRIV_KEY }});
const TransactionBuilder = require('tronweb').TransactionBuilder;
const tb = new TransactionBuilder(tw);
const txUtils = tw.utils.transaction;

(async function () {{
  // a) 用 TransactionBuilder API 重新构造 data=memo 的 tx（这样 memo 会正确进 protobuf）
  const memoHex = Buffer.from(memoStr, 'utf-8').toString('hex');
  let tx = await tb.sendTrx(
    '{BURN_B58}',
    1,
    undefined,
    {{ data: memoHex }}   // ⭐ 关键：options.data 会被展开成 raw_data.data → protobuf memo
  );

  console.log('  [buildOK] txID:', tx.txID.substring(0, 24) + '...');
  console.log('  [rawData] hex len:', tx.raw_data_hex.length, 'chars');
  console.log('  [rawData.data] 存在:', !!tx.raw_data.data);
  if (tx.raw_data.data) {{
    console.log('  [memoDecoded]:',
      Buffer.from(tx.raw_data.data, 'hex').toString('utf-8').substring(0, 60) + '...');
  }}

  // b) 签名
  const signed = await tw.trx.sign(tx, PRIV_KEY);
  console.log('  [signed] signature[0] len:', signed.signature?.[0]?.length || '?');

  // c) 广播
  try {{
    const result = await tw.trx.sendRawTransaction(signed);
    console.log('  [broadcast]:', JSON.stringify(result).substring(0, 200));
    fs.writeFileSync('/tmp/anchor-v3-bcast.json', JSON.stringify(result, null, 2));
  }} catch (err) {{
    console.error('  ❌ 广播报错:', err.message);
    process.exit(1);
  }}
}})();
"""

    try:
        proc = subprocess.run(
            ["node", "-e", node_code],
            capture_output=True, text=True, timeout=45,
            cwd=str(HERE),
        )
    except subprocess.TimeoutExpired:
        print("❌ Node 子进程超时 45s")
        sys.exit(1)

    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        print(f"\n[node stderr] {proc.stderr[:400]}")

    if proc.returncode != 0:
        print(f"\n❌ Node 退出码 {proc.returncode}")
        sys.exit(proc.returncode)

    # ====== 3. 读取结果 ======
    _log("3", "处理广播结果...")
    bcast_path = Path("/tmp/anchor-v3-bcast.json")
    if not bcast_path.exists():
        print("⚠️  /tmp/anchor-v3-bcast.json 不存在（可能是 Node 侧脚本路径问题）")
        sys.exit(0)

    with open(bcast_path, "r") as f:
        bcast = json.load(f)

    result_flag = bcast.get("result", False)
    txid = bcast.get("txid") or bcast.get("txID") or bcast.get("transaction", {}).get("id", "")

    if result_flag and txid:
        print("\n" + "=" * 60)
        print("🎉 带 MEMO 的主网锚定成功！")
        print("=" * 60)
        print(f"  txID:      {txid}")
        print(f"  Tronscan:  https://tronscan.org/#/transaction/{txid}")
        anchor["mainnetTxID"] = txid
        anchor["mainnetUrl"] = f"https://tronscan.org/#/transaction/{txid}"
        anchor["anchorTxType"] = "v3-with-memo"
        anchor["memoSize"] = len(memo_str)
        with open(ANCHOR_FILE, "w") as f:
            json.dump(anchor, f, indent=2, ensure_ascii=False)
        print(f"  ✅ 已更新 {ANCHOR_FILE.name}")
    else:
        print(f"  ❌ 失败: {json.dumps(bcast, ensure_ascii=False)[:300]}")
        # 解码 BANDWITH_ERROR 等 hex 消息
        if "message" in bcast:
            try:
                msg_hex = bcast["message"]
                if isinstance(msg_hex, str):
                    msg_bytes = bytes.fromhex(msg_hex)
                    msg_txt = msg_bytes.decode("utf-8", errors="replace")
                    print(f"  decoded message: {msg_txt}")
            except Exception:
                pass
        sys.exit(2)


if __name__ == "__main__":
    main()
