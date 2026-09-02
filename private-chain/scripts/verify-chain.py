#!/usr/bin/env python3
"""
verify-chain.py — 链上存证完整验证（Python 版，无外部依赖）

功能：
  1. 数学验证：Merkle Root、1156 条 Anchor Hash、Merkle Proof、防篡改
  2. 链上验证：主网/Nile 锚定交易查询、memo 解码
  3. 页面数据一致性：anchor-result ↔ addr-data.js ↔ 交易列表页

用法：
  python3 scripts/verify-chain.py                # 全量验证
  python3 scripts/verify-chain.py <Nile txID>    # 单笔验证 + Proof

修复（之前内联版本常见问题）:
  - memoStr.length  →  len(memoStr)          (Python 用 len(), 不是 .length)
  - .substring(a,b) →  s[a:b]                (Python 切片, 不是 .substring())
  - .includes(x)    →  x in s                (in 关键字)
  - keccak256       →  用 subprocess 调用 ethers (避免 pysha3 编译失败)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
ASSETS = HERE / "assets"
ANCHOR_FILE = ASSETS / "anchor-result-v2.json"


# ========== keccak256（通过 ethers subprocess，避免 Python C 扩展编译问题） ==========

def _run_node_keccak(hex_inputs):
    # type: (list[str]) -> list[str]
    """通过一次 Node.js 子进程批量计算一组 keccak256，输入是 0x 开头的十六进制字符串列表。"""
    if not hex_inputs:
        return []
    payload = "\n".join(hex_inputs)
    node_script = r"""
const fs = require('fs');
const ethers = require('ethers');
const lines = fs.readFileSync(0, 'utf-8').trim().split('\n');
let out = '';
for (const l of lines) {
  if (!l) continue;
  out += ethers.keccak256(l) + '\n';
}
process.stdout.write(out);
"""
    proc = subprocess.run(
        ["node", "-e", node_script],
        input=payload, capture_output=True, text=True,
        cwd=str(HERE), timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "node keccak 失败 (exit %d): %s" % (proc.returncode, proc.stderr[:400])
        )
    return [l for l in proc.stdout.strip().splitlines() if l]


# ========== 叶子 / 锚定 / Merkle Tree 算法 ==========

def leaf_hash_batch(tx_list: list[dict]) -> list[str]:
    """批量计算所有叶子 = keccak256(txID|amount|from|to)，仅 1 次 Node 调用。"""
    inputs = []
    for tx in tx_list:
        data = f"{tx['txID']}|{tx['amount']}|{tx['from']}|{tx['to']}"
        inputs.append("0x" + data.encode("utf-8").hex())
    return _run_node_keccak(inputs)


def anchor_hash_batch(merkle_root: str, tx_list: list[dict]) -> list[str]:
    """批量计算所有 Anchor Hash = keccak256(merkleRoot|index|txID)，仅 1 次 Node 调用。"""
    inputs = []
    for tx in tx_list:
        data = f"{merkle_root}|{tx.get('index', 0)}|{tx.get('txID', '')}"
        inputs.append("0x" + data.encode("utf-8").hex())
    return _run_node_keccak(inputs)


def build_merkle_root(leaves_hex: list[str]) -> str:
    """构建 Merkle Root（每一层批量 keccak，仅 11 次 Node 调用，而不是 2000+ 次）。"""
    level = list(leaves_hex)
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        combined_list = []
        for i in range(0, len(level), 2):
            a = level[i].replace("0x", "")
            b = level[i + 1].replace("0x", "")
            combined_list.append("0x" + a + b)
        level = _run_node_keccak(combined_list)
    return level[0] if level else "0x" + "00" * 32


def get_merkle_proof(leaves_hex: list[str], idx: int) -> list[str]:
    """返回从叶子到根的兄弟节点 proof 列表（每层兄弟节点不用 keccak，直接取，所以不需要 subprocess）。"""
    proof: list[str] = []
    level = list(leaves_hex)
    i = idx
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        sibling_idx = i ^ 1
        proof.append(level[sibling_idx])
        # 计算下一层（这里每层都要真正 keccak 才能继续）
        combined_list = []
        for j in range(0, len(level), 2):
            a = level[j].replace("0x", "")
            b = level[j + 1].replace("0x", "")
            combined_list.append("0x" + a + b)
        level = _run_node_keccak(combined_list)
        i //= 2
    return proof


def verify_proof(leaf: str, proof: list[str], idx: int, merkle_root: str) -> bool:
    """用 proof 从 leaf 推导 merkle_root，每层 1 次 keccak（proof 深度 ≈ 11）。"""
    current = leaf
    i = idx
    for sibling in proof:
        a = current.replace("0x", "")
        b = sibling.replace("0x", "")
        if i % 2 == 0:
            combined = ["0x" + a + b]
        else:
            combined = ["0x" + b + a]
        current = _run_node_keccak(combined)[0]
        i //= 2
    return current.lower() == merkle_root.lower()


# ========== 链上查询 ==========

def tron_get_tx(txid: str, network: str = "mainnet") -> dict:
    """通过 trongrid 查询交易。network: mainnet | nile"""
    host = {
        "mainnet": "https://api.trongrid.io",
        "nile": "https://nile.trongrid.io",
    }[network]
    try:
        req = urllib.request.Request(
            f"{host}/wallet/gettransactionbyid",
            data=json.dumps({"value": txid}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.load(resp)
    except urllib.error.URLError as e:
        return {"error": str(e)}


def decode_memo(memo_hex: str) -> str | dict:
    """解码 raw_data.data (hex) → utf-8 string，尝试 JSON 解析。"""
    try:
        text = bytes.fromhex(memo_hex).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return f"(无法解码 {len(memo_hex)} hex chars)"
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


# ========== 页面数据一致性 ==========

def load_addr_data() -> list[dict]:
    """解析 detail.html 内嵌的 ALL 数组或 addr-data.js。"""
    sources = [
        ASSETS / "addr-data.js",
        ASSETS / "tx-list.html",
        ASSETS / "detail.html",
    ]
    for src in sources:
        if not src.exists():
            continue
        text = src.read_text(encoding="utf-8")
        # 找 ALL = [...] 或 window.addrData = {...} 或 const TXS = [...]
        for pattern, key in [
            (r"const\s+TXS\s*=\s*(\[[\s\S]{100,}?\])\s*;", "TXS"),
            (r"const\s+ALL\s*=\s*(\[[\s\S]{100,}?\])\s*;", "ALL"),
            (r"window\.addrData\s*=\s*(\{[\s\S]{100,}?\})\s*;", "window.addrData"),
        ]:
            m = re.search(pattern, text)
            if m:
                try:
                    obj = json.loads(m.group(1))
                    if key in ("TXS", "ALL"):
                        return list(obj)
                    if key == "window.addrData":
                        return list(obj.get("transactions", obj.get("txs", [])))
                except json.JSONDecodeError:
                    continue
    return []


# ========== 主流程 ==========

def main() -> int:
    single_tx = sys.argv[1] if len(sys.argv) > 1 else None

    print("=" * 60)
    print("  🔗 TRON 链上存证完整性验证 (Python)")
    print("=" * 60)

    # ---- 0. 加载 anchor-result-v2.json ----
    if not ANCHOR_FILE.exists():
        print(f"❌ 找不到 {ANCHOR_FILE}")
        return 1
    with open(ANCHOR_FILE, "r", encoding="utf-8") as f:
        anchor = json.load(f)
    anchor_map = list(anchor.get("anchorMap", []))
    stored_root = anchor.get("merkleRoot", "")
    mainnet_txid = anchor.get("mainnetTxID", "")
    nile_txid = "ce8bb24bd2dde5ff8869b7e9dd4d97307d377217bca7ecbb66ac2c68864fabe1"

    print(f"\n📦 加载: {ANCHOR_FILE.name}")
    print(f"   anchor_map 条数: {len(anchor_map)}")
    print(f"   merkle_root:      {stored_root[:32]}…")
    print(f"   mainnet txid:     {mainnet_txid[:20]}…")

    # ---- 1. Merkle Root 数学自洽 ----
    print("\n" + "─" * 60)
    print("【1/5】Merkle Root 数学自洽验证")
    try:
        leaves = leaf_hash_batch(anchor_map)  # ✅ 批量：仅 1 次 subprocess
    except Exception as e:
        print(f"   ❌ leaf_hash_batch 失败: {e}")
        return 2

    print(f"   叶子节点: {len(leaves)}")
    computed_root = build_merkle_root(leaves)  # ✅ 11 层 * 1 次 = 11 次 subprocess
    match_root = computed_root.lower() == stored_root.lower()
    print(f"   存储的: {stored_root}")
    print(f"   计算的: {computed_root}")
    print(f"   结果:   {'✅ 完全匹配' if match_root else '❌ 不匹配!!'}")

    # ---- 2. Anchor Hash 逐条验证 ----
    print("\n【2/5】Anchor Hash 逐条自洽验证")
    # anchor_hash 算法: keccak256(merkleRoot|index|txID)
    expected_ahs = anchor_hash_batch(stored_root, anchor_map)  # ✅ 批量：1 次 subprocess
    ok = 0
    bad_samples = []
    for exp_ah, x in zip(expected_ahs, anchor_map):
        if exp_ah.lower() == x.get("anchor_hash", "").lower():
            ok += 1
        elif len(bad_samples) < 3:
            bad_samples.append((x.get("index"), exp_ah, x.get("anchor_hash")))

    print(f"   通过: {ok}/{len(anchor_map)}")
    if bad_samples:
        for i, exp, got in bad_samples:
            print(f"     ❌ #{i}: 期望 {exp[:16]}… 实际 {got[:16]}…")

    # ---- 3. Merkle Proof 抽样 + 防篡改 ----
    print("\n【3/5】Merkle Proof 抽样验证")
    if len(leaves) >= 1156:
        samples = [0, len(leaves) // 2, len(leaves) - 1]
    else:
        samples = list(range(min(3, len(leaves))))

    for s in samples:
        proof = get_merkle_proof(leaves, s)
        vfy = verify_proof(leaves[s], proof, s, stored_root)
        label = "首笔" if s == 0 else ("尾笔" if s == len(leaves) - 1 else "中间笔")
        txid_short = anchor_map[s].get("txID", "?")[:12] + "…"
        print(f"   {label} (#{s}, txID={txid_short}): {'✅' if vfy else '❌'}  proof_len={len(proof)}")

    # 伪造交易 - 用第一笔的 proof 验证一个假 leaf
    fake_input = ["0x" + b"FAKE_TAMPERED_TX_0123456789".hex()]
    fake_leaf = _run_node_keccak(fake_input)[0]
    proof0 = get_merkle_proof(leaves, 0)
    fake_ok = verify_proof(fake_leaf, proof0, 0, stored_root)
    print(f"   伪造交易测试: {'❌ 错误接受!' if fake_ok else '✅ 正确拒绝 (防篡改)'}")

    # ---- 4. 链上交易查询 ----
    print("\n【4/5】链上交易存在性验证")

    # 4.1 主网
    if mainnet_txid:
        d = tron_get_tx(mainnet_txid, "mainnet")
        if "error" in d:
            print(f"   主网: ⚠️ 查询异常 {d['error'][:60]}")
        elif d.get("txID") == mainnet_txid:
            raw = d.get("raw_data", {})
            memo = raw.get("data")
            memo_text = decode_memo(memo) if memo else "缺失"
            if isinstance(memo_text, dict):
                memo_display = f"JSON({len(json.dumps(memo_text))} bytes) ✅"
            else:
                memo_display = memo_text[:50] if len(str(memo_text)) > 50 else memo_text
            print(f"   主网 ✅ txID={mainnet_txid[:20]}… memo: {memo_display}")
        else:
            print(f"   主网 ❌ 返回: {str(d)[:100]}")

    # 4.2 Nile
    d2 = tron_get_tx(nile_txid, "nile")
    if "error" in d2:
        print(f"   Nile: ⚠️ 查询异常 {d2['error'][:60]}")
    elif d2.get("txID") == nile_txid:
        raw2 = d2.get("raw_data", {})
        memo2 = raw2.get("data")
        mt = decode_memo(memo2) if memo2 else "缺失"
        if isinstance(mt, dict):
            sample_keys = list(mt.keys())[:5]
            print(f"   Nile ✅ txID={nile_txid[:20]}… memo: JSON keys={sample_keys}")
        else:
            print(f"   Nile ✅ txID={nile_txid[:20]}… memo: {str(mt)[:50]}")
    else:
        print(f"   Nile ❌ 返回: {str(d2)[:100]}")

    # ---- 5. 页面数据一致性 ----
    print("\n【5/5】页面数据 ↔ anchor-result 一致性")
    page_txs = load_addr_data()
    print(f"   页面加载交易条数: {len(page_txs)}")

    if len(page_txs) == len(anchor_map) and len(page_txs) > 0:
        # 随机抽样比对 anchor_hash
        page_ah = {tx.get("txID", ""): tx.get("anchor_hash", "") for tx in page_txs
                   if isinstance(tx, dict)}
        anchor_ah = {x["txID"]: x["anchor_hash"] for x in anchor_map}
        matched = sum(1 for tid, ah in anchor_ah.items()
                      if page_ah.get(tid, "").lower() == ah.lower())
        print(f"   txID↔anchor_hash 匹配: {matched}/{len(anchor_ah)}")
        if matched == len(anchor_ah):
            print(f"   ✅ 页面数据与 anchor-result 完全一致")
        else:
            print(f"   ⚠️  部分不匹配")
    elif page_txs:
        print(f"   ⚠️  页面 {len(page_txs)} vs anchor {len(anchor_map)} 条数不一致")
    else:
        print(f"   ⚠️  无法从页面文件中解析数据（可能需要手动核对）")

    # ---- 单笔查询 ----
    if single_tx:
        print("\n" + "─" * 60)
        print(f"  🔎 单笔查询: {single_tx}")
        found = next((x for x in anchor_map if x.get("txID") == single_tx or
                      (isinstance(x.get("txID"), str) and x["txID"].startswith(single_tx))), None)
        if not found:
            print(f"   ❌ 此 txID 不在 anchor_map 中")
            return 3
        idx = found["index"]
        proof = get_merkle_proof(leaves, idx)
        valid = verify_proof(leaves[idx], proof, idx, stored_root)
        ah_ok = anchor_hash(stored_root, idx, found["txID"]).lower() == found["anchor_hash"].lower()
        print(f"   序号:       #{idx} (第 {idx+1}/{len(anchor_map)} 笔)")
        print(f"   Anchor Hash: {found['anchor_hash']} {'✅' if ah_ok else '❌'}")
        print(f"   From:        {found.get('from', 'N/A')}")
        print(f"   To:          {found.get('to', 'N/A')}")
        print(f"   Amount:      {found.get('amount', 'N/A')}")
        print(f"   Proof 长度:  {len(proof)}")
        print(f"   Merkle Proof: {'✅ 通过' if valid else '❌ 失败'}")
        print(f"   Nile:        https://nile.tronscan.org/#/transaction/{found['txID']}")
        print(f"   主网锚定:    {anchor.get('mainnetUrl', 'N/A')}")

    # ---- 总结 ----
    print("\n" + "=" * 60)
    print("  📊 验证总结")
    print("=" * 60)
    issues = 0
    if not match_root: issues += 1
    if ok != len(anchor_map): issues += 1
    if fake_ok: issues += 1

    if issues == 0:
        print("  ✅ 所有检查通过，存证数据自洽、防篡改有效")
    else:
        print(f"  ⚠️  共 {issues} 项异常，请检查上方 ❌ 标记")
        return 4

    print(f"\n  🌐 页面访问:")
    print(f"    列表: http://localhost:8888/assets/tx-list.html")
    print(f"    汇总: http://localhost:8888/assets/ledger.html")
    print(f"    详情: http://localhost:8888/assets/detail.html?tx=<txID>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
