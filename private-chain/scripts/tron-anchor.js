// scripts/tron-anchor.js
// Nile → 目标网络 锚定 & 跨链查询 CLI 工具
//
// 用法:
//   # 锚定单条 Nile 交易 (默认主网；设 TRON_ANCHOR_NETWORK=nile 可改写到 Nile)
//   TRON_PRIVATE_KEY=xxx [TRON_ANCHOR_NETWORK=nile] node scripts/tron-anchor.js anchor <nile-txID> [备注]
//
//   # 批量锚定
//   TRON_PRIVATE_KEY=xxx [TRON_ANCHOR_NETWORK=nile] node scripts/tron-anchor.js anchor-batch <tx1,tx2,tx3>
//
//   # 解码锚定交易（自动查主网/Nile）
//   node scripts/tron-anchor.js decode <any-anchor-txID>
//
//   # 智能查任意 txID：自动判断 主网锚定/Nile锚定/Nile普通交易/不存在
//   node scripts/tron-anchor.js query <any-txID>
//
//   # 看 Nile 交易原文
//   node scripts/tron-anchor.js fetch <nile-txID>

const {
  anchorNileTx,
  decodeAnchorTx,
  resolveAnyTxID,
  fetchNileTx,
} = require("../tron/anchor");

const PRIV = process.env.TRON_PRIVATE_KEY;
const TARGET_NET = (process.env.TRON_ANCHOR_NETWORK || "mainnet").toLowerCase();

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) return printHelp();

  try {
    switch (cmd) {
      case "anchor": return await cmdAnchor(args[0], args[1] || "");
      case "anchor-batch": return await cmdAnchorBatch(args[0]);
      case "decode": return await cmdDecode(args[0]);
      case "query":  return await cmdQuery(args[0]);
      case "fetch":  return await cmdFetch(args[0]);
      default: console.error("❌ 未知命令:", cmd); printHelp();
    }
  } catch (e) {
    console.error("❌ 失败:", e.message);
  }
}

function printHelp() {
  console.log(`
波场跨链锚定工具（支持主网 / Nile 双网锚定）
═══════════════════════════════════════════════

命令:
  anchor       <nile-txID> [备注]   把 Nile 交易锚定到目标网络 (默认主网)
  anchor-batch <tx1,tx2,...>        批量锚定（逗号分隔）
  decode       <txID>               解码锚定交易 (自动查主网+Nile)
  query        <any-txID>           ⭐ 智能查：锚定/Nile/普通交易 自动识别
  fetch        <nile-txID>          查看 Nile 交易详情

环境变量:
  TRON_PRIVATE_KEY=xxx              钱包私钥（anchor 命令必需）
  TRON_ANCHOR_NETWORK=mainnet|nile  锚定写入的目标网络 (默认 mainnet)
  TRON_INCLUDE_MEMO=0|1             锚定时是否包含原文 memo（默认 1）

示例:
  # ① 正常用法：锚定到主网
  TRON_PRIVATE_KEY=xxx node scripts/tron-anchor.js anchor 4953e6d7... "备注"

  # ② 演示闭环：把锚定也写在 Nile (不需主网 TRX)
  TRON_PRIVATE_KEY=<Nile 私钥> TRON_ANCHOR_NETWORK=nile \\
    node scripts/tron-anchor.js anchor-batch "tx1,tx2,tx3"

  # ③ 查询 / 解码
  node scripts/tron-anchor.js query  acbf10ed...
  node scripts/tron-anchor.js decode f8c2f...
`);
}

// ── anchor ──
async function cmdAnchor(txID, comment) {
  if (!txID) throw new Error("请提供 Nile txID");
  if (!PRIV) throw new Error("请设置 TRON_PRIVATE_KEY 环境变量");
  const includeMemo = process.env.TRON_INCLUDE_MEMO !== "0";
  const targetDisplay = TARGET_NET === "mainnet" ? "\x1b[33m主网\x1b[0m" : `\x1b[36m${TARGET_NET.toUpperCase()}\x1b[0m`;

  console.log(`📥 抓取 Nile 交易: ${txID.slice(0,20)}…`);
  console.log(`🎯 写入目标网络: ${targetDisplay}`);
  const ret = await anchorNileTx({
    privateKey: PRIV,
    nileTxID: txID,
    targetNetwork: TARGET_NET,
    comment,
    includeMemo,
  });

  const a = ret.anchor;
  const n = ret.src;
  const netName = a.network === "nile" ? "🟢 Nile" : "🌐 主网";
  console.log("");
  console.log(`✅ ${netName} 锚定广播成功！`);
  console.log("─".repeat(60));
  console.log("  🌐 锚定 txID:", a.txID);
  console.log("     浏览器:", a.explorer);
  console.log("  📝 锚定到的 Nile 交易:", n.txID);
  console.log("     浏览器:", a.nileExplorer);
  console.log("     区块: #" + n.blockNumber, "  时间:", tsFmt(n.timestamp));
  console.log("     类型:", n.contractType, "  状态:", n.status);
  console.log("     发送方:", n.from);
  console.log("     接收方:", n.to || "—");
  if (n.amount > 0) console.log("     金额:", (n.amount/1e6).toLocaleString(), "TRX");
  if (n.memoDecoded) {
    const short = n.memoDecoded.length > 60 ? n.memoDecoded.slice(0,60)+"…" : n.memoDecoded;
    console.log("     内容:", short);
  }
  const feeLabel = a.network === "nile" ? "手续费" : "主网手续费";
  console.log(`  💰 ${feeLabel}:`, a.fee);
}

// ── anchor-batch ──
async function cmdAnchorBatch(txList) {
  if (!txList) throw new Error("请提供逗号分隔的 Nile txID 列表");
  if (!PRIV) throw new Error("请设置 TRON_PRIVATE_KEY 环境变量");
  const tids = txList.split(",").map(s => s.trim()).filter(Boolean);
  const includeMemo = process.env.TRON_INCLUDE_MEMO !== "0";
  const targetDisplay = TARGET_NET === "mainnet" ? "\x1b[33m主网\x1b[0m" : `\x1b[36m${TARGET_NET.toUpperCase()}\x1b[0m`;
  const explorerBase = TARGET_NET === "nile"
    ? "https://nile.tronscan.org/#/transaction/"
    : "https://tronscan.org/#/transaction/";
  const explorerLabel = TARGET_NET === "nile" ? "Nile" : "主网";

  console.log(`批量锚定 ${tids.length} 笔 Nile 交易到 ${targetDisplay}...\n`);
  const results = [];
  for (let i = 0; i < tids.length; i++) {
    const tid = tids[i];
    process.stdout.write(`[${i+1}/${tids.length}] ${tid.slice(0,20)}… → `);
    try {
      const r = await anchorNileTx({
        privateKey: PRIV,
        nileTxID: tid,
        targetNetwork: TARGET_NET,
        includeMemo,
      });
      results.push({ nileTx: tid, tgtTx: r.anchor.txID, ok: true, fee: r.anchor.fee });
      console.log("✅ " + r.anchor.txID.slice(0,18) + "…");
    } catch (e) {
      results.push({ nileTx: tid, ok: false, err: e.message });
      console.log("❌ " + e.message);
    }
    if (i < tids.length - 1) await new Promise(r => setTimeout(r, 600));
  }

  const okCount = results.filter(r=>r.ok).length;
  console.log("\n══════════════════════════════════════");
  console.log(`  完成: ${okCount}/${tids.length}   目标网络: ${explorerLabel}`);
  results.forEach(r => {
    if (r.ok) {
      console.log(`  ✅ ${r.nileTx.slice(0,18)}… → ${r.tgtTx.slice(0,18)}…`);
      console.log(`     ${explorerLabel}: ${explorerBase}${r.tgtTx}`);
    } else {
      console.log(`  ❌ ${r.nileTx.slice(0,18)}… → ${r.err}`);
    }
  });
  // 把结果写入 /tmp 便于后续 decode/query 验证脚本读取
  try {
    require("fs").writeFileSync(
      "/tmp/anchor-results.json",
      JSON.stringify({ target: TARGET_NET, results }, null, 2)
    );
  } catch (_) {}
}

// ── decode ──
async function cmdDecode(txID) {
  if (!txID) throw new Error("请提供 txID");
  const d = await decodeAnchorTx(txID);
  if (!d.ok) {
    console.log("❌ 主网 / Nile 均未找到此 txID:", d.reason, d.message || "");
    return;
  }
  const netLabel = d.network === "nile" ? "🟢 Nile 测试网" : "🌐 主网";
  console.log("📡 txID 所在网络:", netLabel);
  console.log("   txID:", txID);
  console.log("   区块: #" + (d.blockNumber||"?"), "  时间:", tsFmt(d.timestamp));
  console.log("   状态:", d.status, "  手续费:", d.fee ? (d.fee/1e6).toFixed(6)+" TRX" : "-");
  console.log("");
  if (d.isAnchor) {
    const a = d.anchor;
    const srcLabel = (a.src || "nile") === "nile" ? "Nile" : a.src;
    const tgtLabel = d.network === "nile" ? "Nile" : "主网";
    console.log("🔗 这是一条 " + srcLabel + " → " + tgtLabel + " 锚定记录（版本 v" + a.v + "）");
    console.log("─".repeat(60));
    const n = a.n || {};
    console.log("  🟢 源网络: Nile 测试网");
    console.log("  🆔 Nile txID:", n.tx);
    console.log("     浏览器:", "https://nile.tronscan.org/#/transaction/" + n.tx);
    console.log("  📦 区块: #" + n.bn, "  时间:", tsFmt(n.ts));
    console.log("  👤 发送方:", n.fr);
    if (n.to) console.log("  👥 接收方:", n.to);
    console.log("  📋 类型:", n.tp, "  状态:", n.st);
    if (n.am) console.log("  💰 金额:", (n.am/1e6).toLocaleString(), "TRX");
    if (n.da) {
      try {
        const obj = JSON.parse(n.da);
        console.log("  📝 内容(JSON):", JSON.stringify(obj, null, 2).split("\n").map(l=>"     "+l).join("\n").trimEnd());
      } catch (_) {
        console.log("  📝 内容:", n.da);
      }
    }
    if (a.c) console.log("  💬 备注:", a.c);
  } else {
    console.log("这不是一条锚定交易。普通 memo:");
    console.log("  " + (d.rawMemo || "(空)"));
  }
}

// ── query ──
async function cmdQuery(txID) {
  if (!txID) throw new Error("请提供 txID");
  console.log("🔍 智能查询 txID:", txID);
  console.log("─".repeat(60));
  const r = await resolveAnyTxID(txID);
  if (r.foundOn === "none") {
    console.log("❌", r.message);
    return;
  }
  // 分支 1：通过 decodeAnchorTx 找到（主网或 Nile，可能是锚定）—— 其结构带 isAnchor
  if (typeof r.isAnchor !== "undefined") {
    const netLabel = r.foundOn === "nile" ? "🟢 Nile 测试网交易" : "🌐 主网交易";
    console.log("✅ 找到:", netLabel);
    console.log("   区块: #" + (r.blockNumber||"?"), "  时间:", tsFmt(r.timestamp));
    console.log("   状态:", r.status || "-");
    const base = r.foundOn === "nile"
      ? "https://nile.tronscan.org/#/transaction/"
      : "https://tronscan.org/#/transaction/";
    console.log("   浏览器:", base + txID);
    if (r.isAnchor) {
      console.log("");
      const a = r.anchor; const n = a.n || {};
      const srcLabel = (a.src || "nile") === "nile" ? "Nile" : a.src;
      const tgtLabel = r.foundOn === "nile" ? "Nile" : "主网";
      console.log("🔗 这是「" + srcLabel + " → " + tgtLabel + "」锚定记录  →  指向 " + srcLabel + " txID:", n.tx);
      console.log("   源浏览器: https://nile.tronscan.org/#/transaction/" + n.tx);
      console.log("   类型:", n.tp || "-", "  金额:", n.am ? (n.am/1e6).toLocaleString()+" TRX" : "-");
      if (n.da) {
        try {
          const obj = JSON.parse(n.da);
          console.log("   内容 (JSON):", JSON.stringify(obj, null, 2).split("\n").map(l => "      "+l).join("\n").trimEnd());
        } catch (_) {
          console.log("   内容:", n.da.length > 120 ? n.da.slice(0,120)+"…" : n.da);
        }
      }
      if (a.c) console.log("   备注:", a.c);
    }
    return;
  }
  // 分支 2：普通 Nile 交易（通过 fetchNileTx 找到）—— 结构带 nile
  if (r.foundOn === "nile") {
    const n = r.nile;
    console.log("✅ 找到: 🟢 Nile 测试网交易（非锚定）");
    console.log("   区块: #" + n.blockNumber, "  时间:", tsFmt(n.timestamp));
    console.log("   浏览器: https://nile.tronscan.org/#/transaction/" + txID);
    console.log("   类型:", n.contractType, "  状态:", n.status);
    if (n.amount) console.log("   金额:", (n.amount/1e6).toLocaleString(), "TRX");
    if (n.memoDecoded) {
      try {
        if (n.memoIsJson) {
          console.log("   内容 (JSON):\n" + JSON.stringify(n.memoJson, null, 2).split("\n").map(l => "     "+l).join("\n").trimEnd());
        } else {
          console.log("   内容:", n.memoDecoded.length > 120 ? n.memoDecoded.slice(0,120)+"…" : n.memoDecoded);
        }
      } catch (_) {}
    }
  }
}

// ── fetch ──
async function cmdFetch(txID) {
  if (!txID) throw new Error("请提供 Nile txID");
  const n = await fetchNileTx(txID);
  console.log("🟢 Nile 交易:", txID);
  console.log("   区块: #" + n.blockNumber, "  时间:", tsFmt(n.timestamp));
  console.log("   类型:", n.contractType, "  状态:", n.status);
  console.log("   发送:", n.from, "  →  接收:", n.to || "—");
  if (n.amount) console.log("   金额:", (n.amount/1e6).toLocaleString(), "TRX");
  if (n.memoDecoded) {
    try {
      if (n.memoIsJson) {
        console.log("   memo(JSON):\n" + JSON.stringify(n.memoJson, null, 2).split("\n").map(l=>"     "+l).join("\n").trimEnd());
      } else {
        console.log("   memo:", n.memoDecoded);
      }
    } catch (_) {}
  }
  console.log("   浏览器:", "https://nile.tronscan.org/#/transaction/" + txID);
}

function tsFmt(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
  catch (_) { return String(ts); }
}

main().then(() => process.exit(0));
