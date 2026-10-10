#!/usr/bin/env python3
"""
anchor-v3b.py — 通过 TronGrid HTTP API 构造带 memo 的 TRX 转账，并签名广播
修复:
  - 直接使用 createtransaction (with extra=data hex)
  - 或者 createtransaction without data, 再通过 tronweb inject memo
"""
import urllib.request
import urllib.error
import json
import subprocess
import time
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

SEND_B58   = "TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ"
SEND_HEX   = "41853164f135d68b65b7492fe29009bf0dc08b6311"
BURN_B58   = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
BURN_HEX   = "410000000000000000000000000000000000000000"
PRIV_KEY   = "4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309"
FULL_HOST  = "https://api.trongrid.io"
ANCHOR_FILE = HERE / "assets" / "anchor-result-v2.json"


def _http(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def main(dry_run=False):
    with open(ANCHOR_FILE, "r") as f:
        anchor = json.load(f)
    anchor_map = anchor.get("anchorMap", [])
    merkle_root = anchor.get("merkleRoot", "")
    stats = anchor.get("stats", {})

    memo_obj = {
        "a": "usdt-1156-anchor",
        "v": "2.2",                # 精简版：印章仅本地展示、不链上存证
        "m": merkle_root,
        "t": len(anchor_map),
        "c": stats.get("nileContract", "TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq"),
        "r": stats.get("totalAmountDisplay", "599999904.27"),
        "u": stats.get("uniqueFrom", 2),
        "o": stats.get("uniqueTo", 247),
        "samples": [
            {"i": 0,    "ah": anchor_map[0]["anchor_hash"][2:16]},
            {"i": 500,  "ah": anchor_map[499]["anchor_hash"][2:16]},
            {"i": 1155, "ah": anchor_map[-1]["anchor_hash"][2:16]},
        ],
        "ts": int(time.time()),
    }
    memo_str = json.dumps(memo_obj, separators=(",", ":"))
    print(f"Memo: {len(memo_str)} bytes")
    if len(memo_str) > 500:
        memo_obj["samples"] = [{"i": 0, "ah": anchor_map[0]["anchor_hash"][2:14]}]
        del memo_obj["n"]
        memo_str = json.dumps(memo_obj, separators=(",", ":"))
        print(f"  压缩后: {len(memo_str)} bytes")
    memo_hex = memo_str.encode("utf-8").hex()

    print("\n[1] HTTP createtransaction (with data=memo_hex)...")
    try:
        ct = _http(f"{FULL_HOST}/wallet/createtransaction", {
            "owner_address": SEND_HEX,
            "to_address": BURN_HEX,
            "amount": 1,
            "extra_data": memo_hex,   # TRON createtransaction supports extra_data as memo
        })
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:600]
        print(f"  尝试 extra_data 失败 HTTP {e.code}: {body[:400]}")
        ct = None

    if ct is None or "Error" in str(ct) or (isinstance(ct, dict) and "Error" in ct):
        # Fallback: createtransaction without memo → use tronweb addTransactioMemo
        print("  extra_data 不支持，改用 createtransaction + tronweb addTransactionMemo")
        ct = _http(f"{FULL_HOST}/wallet/createtransaction", {
            "owner_address": SEND_HEX,
            "to_address": BURN_HEX,
            "amount": 1,
        })
    if isinstance(ct, dict) and "Error" in ct:
        print(f"❌ createtransaction 失败: {ct}")
        sys.exit(1)

    raw_hex = ct.get("raw_data_hex", "")
    print(f"  raw_data_hex: {len(raw_hex)} chars")
    print(f"  raw_data['data'] present:", "data" in ct.get("raw_data", {}))

    print("\n[2] Node.js: 必要时注入 memo → 签名 → 广播")
    out_path = HERE / "tmp_broadcast_result.json"
    node_code = r"""
const { TronWeb } = require('tronweb');
const fs = require('fs');
const PRIV_KEY = process.env.PRIV_KEY;
const FULL_HOST = process.env.FULL_HOST;
const rawTx = JSON.parse(process.env.RAW_TX_JSON);
const memoStr = process.env.MEMO_STR;
const OUT = process.env.OUT_PATH;
const DRY_RUN = process.env.DRY_RUN === '1';

(async function () {
  const tw = new TronWeb({ fullHost: FULL_HOST, privateKey: PRIV_KEY });
  let tx = rawTx;
  // 如果 createtransaction 没注入 data 就加 memo
  if (!tx.raw_data || !tx.raw_data.data) {
    try {
      const modified = await tw.transactionBuilder.addTransactionMemo(tx, memoStr);
      tx = modified;
      console.log('  [memoInjected] via addTransactionMemo');
    } catch (e) {
      console.error('  addTransactionMemo 失败:', e.message);
      process.exit(2);
    }
  } else {
    console.log('  [memoPreset] via extra_data');
  }
  console.log('  txID:', tx.txID ? tx.txID.slice(0,22)+'...' : await tw.trx.getTxId(tx).slice(0,22)+'...');
  console.log('  raw_data.data present:', !!(tx.raw_data && tx.raw_data.data));
  if (tx.raw_data && tx.raw_data.data) {
    const decoded = Buffer.from(tx.raw_data.data, 'base64').toString('utf-8');
    console.log('  memoPreview:', decoded.slice(0, 80) + '…');
  }

  // 签名
  try {
    const signed = await tw.trx.sign(tx, PRIV_KEY);
    console.log('  [signed OK]');
    if (DRY_RUN) {
      fs.writeFileSync(OUT, JSON.stringify({result:true, txID: tx.txID || signed.txID, note:'DRY_RUN: not broadcast', tx: {txID: signed.txID, signatureCount: (signed.signature||[]).length}}, null, 2));
      process.exit(0);
    }
    const res = await tw.trx.sendRawTransaction(signed);
    fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
    console.log('  [broadcast]', JSON.stringify(res).slice(0, 300));
  } catch (e) {
    console.error('  sign/broadcast 失败:', e.message);
    fs.writeFileSync(OUT, JSON.stringify({result:false, error:e.message}, null, 2));
    process.exit(3);
  }
})();
"""
    import os as _os
    env = dict(_os.environ)
    env.update({
        "PRIV_KEY": PRIV_KEY,
        "FULL_HOST": FULL_HOST,
        "RAW_TX_JSON": json.dumps(ct),
        "MEMO_STR": memo_str,
        "OUT_PATH": str(out_path),
        "DRY_RUN": "1" if dry_run else "0",
    })
    proc = subprocess.run(["node", "-e", node_code], capture_output=True, text=True, timeout=60, cwd=str(HERE), env=env)
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        print(f"\n[node stderr]\n{proc.stderr[:600]}")
    rc = proc.returncode

    if not out_path.exists():
        print("❌ 结果文件未生成")
        sys.exit(rc or 4)

    with open(out_path, "r") as f:
        result = json.load(f)
    print("\n[3] 广播结果")
    print(json.dumps(result, ensure_ascii=False)[:500])

    ok = result.get("result") is True or (result.get("code") is None and result.get("txID"))
    txid = result.get("txID") or result.get("txid") or result.get("tx", {}).get("txID") or ""
    if "message" in result:
        try:
            msg_bytes = bytes.fromhex(result["message"])
            print("  decoded:", msg_bytes.decode("utf-8", errors="replace"))
        except Exception:
            pass

    if ok and txid:
        print("\n" + "=" * 60)
        print("🎉 带 MEMO 主网锚定成功！")
        print(f"  txID:      {txid}")
        print(f"  Tronscan:  https://tronscan.org/#/transaction/{txid}")
        print("=" * 60)
        if not dry_run:
            anchor["mainnetTxID"] = txid
            anchor["mainnetUrl"] = f"https://tronscan.org/#/transaction/{txid}"
            anchor["anchorTxType"] = "v3b-memo-only (seals display-only, not on-chain)"
            anchor["memoSize"] = len(memo_str)
            with open(ANCHOR_FILE, "w") as f:
                json.dump(anchor, f, indent=2, ensure_ascii=False)
            print(f"✅ 已写回 {ANCHOR_FILE.name}")
    else:
        sys.exit(2)


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv or "-n" in sys.argv
    main(dry_run=dry)
