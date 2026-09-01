// scripts/tron-anchor.js
// Nile → 主网 锚定 & 跨链查询 CLI 工具
//
// 用法:
//   # 锚定单条 Nile 交易到主网
//   TRON_PRIVATE_KEY=xxx node scripts/tron-anchor.js anchor <nile-txID> [备注]
//
//   # 批量锚定（逗号分隔）
//   TRON_PRIVATE_KEY=xxx node scripts/tron-anchor.js anchor-batch <tx1,tx2,tx3>
//
//   # 解码主网锚定交易
//   node scripts/tron-anchor.js decode <mainnet-txID>
//
//   # 智能查任意 txID：自动判断主网/Nile/锚定
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
波场跨链锚定工具
═══════════════════════════════════════════════

命令:
  anchor       <nile-txID> [备注]   把 Nile 交易锚定到主网
  anchor-batch <tx1,tx2,...>        批量锚定（逗号分隔）
  decode       <mainnet-txID>       解码主网锚定交易
  query        <any-txID>           ⭐ 智能查：主网/Nile/锚定自动识别
  fetch        <nile-txID>          查看 Nile 交易详情

环境变量:
  TRON_PRIVATE_KEY=xxx              主网私钥（anchor 命令必需）
  TRON_INCLUDE_MEMO=0|1             锚定时是否包含原文 memo（默认 1）

示例:
  TRON_PRIVATE_KEY=xxx node scripts/tron-anchor.js anchor 4953e6d7...  "TRX 转账测试"
  node scripts/tron-anchor.js query  acbf10ed...
  node scripts/tron-anchor.js decode f8c2f...
`);
}

// ── anchor ──
async function cmdAnchor(txID, comment) {
  if (!txID) throw new Error("请提供 Nile txID");
  if (!PRIV) throw new Error("请设置 TRON_PRIVATE_KEY 环境变量");
  const includeMemo = process.env.TRON_INCLUDE_MEMO !== "0";

  console.log("📥 抓取 Nile 交易:", txID);
  const ret = await anchorNileTx({
    privateKey: PRIV,
    nileTxID: txID,
    comment,
    includeMemo,
  });

  const a = ret.anchor;
  const n = ret.nile;
  console.log("");
  console.log("✅ 主网锚定广播成功！");
  console.log("─".repeat(60));
  console.log("  🌐 主网锚定 txID:", a.txID);
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
  console.log("  💰 主网手续费:", a.fee);
}

// ── anchor-batch ──
async function cmdAnchorBatch(txList) {
  if (!txList) throw new Error("请提供逗号分隔的 Nile txID 列表");
  if (!PRIV) throw new Error("请设置 TRON_PRIVATE_KEY 环境变量");
  const tids = txList.split(",").map(s => s.trim()).filter(Boolean);
  const includeMemo = process.env.TRON_INCLUDE_MEMO !== "0";

  console.log(`批量锚定 ${tids.length} 笔 Nile 交易到主网...\n`);
  const results = [];
  for (let i = 0; i < tids.length; i++) {
    const tid = tids[i];
    process.stdout.write(`[${i+1}/${tids.length}] ${tid.slice(0,20)}… → `);
    try {
      const r = await anchorNileTx({ privateKey: PRIV, nileTxID: tid, includeMemo });
      results.push({ nileTx: tid, mainTx: r.anchor.txID, ok: true });
      console.log("✅ " + r.anchor.txID.slice(0,18) + "…");
    } catch (e) {
      results.push({ nileTx: tid, ok: false, err: e.message });
      console.log("❌ " + e.message);
    }
    if (i < tids.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n══════════════════════════════════════");
  console.log(`  完成: ${results.filter(r=>r.ok).length}/${tids.length}`);
  results.forEach(r => {
    if (r.ok) {
      console.log(`  ✅ ${r.nileTx.slice(0,18)}… → ${r.mainTx.slice(0,18)}…`);
      console.log(`     主网: https://tronscan.org/#/transaction/${r.mainTx}`);
    } else {
      console.log(`  ❌ ${r.nileTx.slice(0,18)}… → ${r.err}`);
    }
  });
}

// ── decode ──
async function cmdDecode(txID) {
  if (!txID) throw new Error("请提供主网 txID");
  const d = await decodeAnchorTx(txID);
  if (!d.ok) {
    console.log("❌ 非主网交易或不存在:", d.reason, d.message || "");
    return;
  }
  console.log("📡 主网 txID:", txID);
  console.log("   区块: #" + (d.blockNumber||"?"), "  时间:", tsFmt(d.timestamp));
  console.log("   状态:", d.status, "  手续费:", d.fee ? (d.fee/1e6).toFixed(6)+" TRX" : "-");
  console.log("");
  if (d.isAnchor) {
    const a = d.anchor;
    console.log("🔗 这是一条 Nile → 主网 锚定记录（版本 v" + a.v + "）");
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
  if (r.foundOn === "mainnet") {
    console.log("✅ 找到: 🌐 主网交易");
    console.log("   区块: #" + (r.blockNumber||"?"), "  时间:", tsFmt(r.timestamp));
    console.log("   状态:", r.status);
    console.log("   浏览器: https://tronscan.org/#/transaction/" + txID);
    if (r.isAnchor) {
      console.log("");
      const a = r.anchor; const n = a.n || {};
      console.log("🔗 这是锚定记录  →  指向 Nile txID:", n.tx);
      console.log("   Nile 浏览器: https://nile.tronscan.org/#/transaction/" + n.tx);
      console.log("   类型:", n.tp, "  金额:", n.am ? (n.am/1e6).toLocaleString()+" TRX" : "-");
      if (n.da) console.log("   内容:", n.da.length > 120 ? n.da.slice(0,120)+"…" : n.da);
    }
  }
  if (r.foundOn === "nile") {
    const n = r.nile;
    console.log("✅ 找到: 🟢 Nile 测试网交易");
    console.log("   区块: #" + n.blockNumber, "  时间:", tsFmt(n.timestamp));
    console.log("   浏览器: https://nile.tronscan.org/#/transaction/" + txID);
    console.log("   类型:", n.contractType, "  状态:", n.status);
    if (n.amount) console.log("   金额:", (n.amount/1e6).toLocaleString(), "TRX");
    if (n.memoDecoded) console.log("   内容:", n.memoDecoded.length>120?n.memoDecoded.slice(0,120)+"…":n.memoDecoded);
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
