// scripts/tron-query.js
// 波场主网链上查询 CLI 工具
// 用法：
//   node scripts/tron-query.js balance <tron地址>           # 查询 TRX+USDT 余额
//   node scripts/tron-query.js account <tron地址>           # 查询账户详情
//   node scripts/tron-query.js resource <tron地址>          # 查询带宽能量资源
//   node scripts/tron-query.js tx <tron地址> [limit]        # 查询最近交易
//   node scripts/tron-query.js usdt-tx <tron地址> [limit]   # 查询 USDT 转账
//   node scripts/tron-query.js block [高度|latest]          # 查询区块信息
//   node scripts/tron-query.js current                     # 查询当前区块高度

const {
  createClient,
  getTrxBalance,
  getUsdtBalance,
  getAccountResource,
  getAccountInfo,
  getRecentTransactions,
  getBlockByNumber,
  getCurrentBlock,
  getUsdtTransfers,
  config,
} = require("../tron/client");

const { isValidTronAddress } = require("../tron/address-generator");

const NETWORK = process.env.TRON_NETWORK || "mainnet";
const tronWeb = createClient(NETWORK);

async function main() {
  const [_node, _script, cmd, ...args] = process.argv;

  if (!cmd) {
    printHelp();
    return;
  }

  const networkColor = NETWORK === "mainnet" ? "\x1b[33m主网" : `\x1b[36m${NETWORK}`;
  console.log(`\x1b[2m波场链${networkColor} \x1b[0m  RPC: ${config[NETWORK].fullNode}`);
  console.log("─".repeat(60));

  try {
    switch (cmd.toLowerCase()) {
      case "balance":   return await cmdBalance(args[0]);
      case "account":   return await cmdAccount(args[0]);
      case "resource":  return await cmdResource(args[0]);
      case "tx":        return await cmdTx(args[0], parseInt(args[1]) || 10);
      case "usdt-tx":   return await cmdUsdtTx(args[0], parseInt(args[1]) || 10);
      case "block":     return await cmdBlock(args[0] || "latest");
      case "current":   return await cmdCurrent();
      default:
        console.error(`❌ 未知命令: ${cmd}\n`);
        printHelp();
    }
  } catch (e) {
    console.error("❌ 执行失败：", e.message);
  }
}

function printHelp() {
  console.log(`
  波场链主网查询工具
  ─────────────────────────

  用法: node scripts/tron-query.js <命令> [参数]

  命令:
    balance   <tron地址>          查询 TRX + USDT 余额
    account   <tron地址>          查询账户详情（是否激活、创建时间等）
    resource  <tron地址>          查询带宽、能量、冻结资源
    tx        <tron地址> [limit]  查询最近交易（默认10条）
    usdt-tx   <tron地址> [limit]  查询 USDT 转账记录（默认10条）
    block     [高度|latest]       查询指定区块（默认最新）
    current                       查询当前区块高度

  环境变量:
    TRON_NETWORK=mainnet|nile     指定网络（默认 mainnet）
    TRON_PRO_API_KEY=xxx          可选：TronGrid Pro API Key（解除请求限制）

  示例:
    node scripts/tron-query.js balance TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE
    node scripts/tron-query.js tx TKcsyU2fhhWj5qg4tF5Y9aLhLcLbL1K6cQ 20
    TRON_NETWORK=nile node scripts/tron-query.js current
`);
}

function ensureAddress(addr) {
  if (!addr) {
    throw new Error("请提供要查询的地址");
  }
  if (!isValidTronAddress(addr)) {
    // 尝试从 EVM 地址转换
    if (addr.startsWith("0x") && addr.length === 42) {
      const { evmToTron } = require("../tron/address-generator");
      const tronAddr = evmToTron(addr);
      console.log(`\x1b[2m提示：EVM 地址自动转换为波场地址 ${tronAddr}\x1b[0m`);
      return tronAddr;
    }
    throw new Error(`无效的波场地址: ${addr}`);
  }
  return addr;
}

// ==== 各命令实现 ====

async function cmdBalance(rawAddr) {
  const addr = ensureAddress(rawAddr);
  console.log(`📮 查询地址: ${addr}`);
  console.log("");

  const [trx, usdt] = await Promise.all([
    getTrxBalance(tronWeb, addr),
    getUsdtBalance(tronWeb, addr, NETWORK),
  ]);

  console.log(`  💰 TRX 余额:   ${trx.trx.toLocaleString()} TRX  (${trx.sun.toLocaleString()} SUN)`);
  if (usdt.error) {
    console.log(`  💵 USDT 余额:  ⚠️ 查询失败：${usdt.error}`);
  } else {
    console.log(`  💵 USDT 余额:  ${usdt.usdt.toLocaleString()} USDT`);
  }
}

async function cmdAccount(rawAddr) {
  const addr = ensureAddress(rawAddr);
  console.log(`📮 查询地址: ${addr}`);
  console.log("");

  const info = await getAccountInfo(tronWeb, addr);
  if (info.error) {
    console.error("❌ 查询失败：", info.error);
    return;
  }
  console.log(`  ✅ 激活状态:   ${info.activated ? "已激活" : "\x1b[31m未激活（链上无数据）\x1b[0m"}`);
  console.log(`  📍 地址:       ${info.address}`);
  console.log(`  💰 TRX 余额:   ${info.balance.toLocaleString()} TRX`);
  console.log(`  📊 交易次数:   ${info.txCount.toLocaleString()}`);
  console.log(`  🏭 发币次数:   ${info.assetIssuedCount}`);
  console.log(`  🔑 权限数量:   ${info.permissions}`);
  if (info.createTime) console.log(`  🎂 创建时间:   ${info.createTime}`);
  if (info.latestOpTime) console.log(`  ⏰ 最近操作:   ${info.latestOpTime}`);
}

async function cmdResource(rawAddr) {
  const addr = ensureAddress(rawAddr);
  console.log(`📮 查询地址: ${addr}`);
  console.log("");

  const res = await getAccountResource(tronWeb, addr);
  if (res.error) {
    console.error("❌ 查询失败：", res.error);
    return;
  }

  const pct = (used, limit) => limit > 0 ? ((used / limit) * 100).toFixed(1) + "%" : "-";

  console.log(`  📡 带宽 (NET):`);
  console.log(`      总量/已用/可用:   ${res.netLimit} / ${res.netUsed} / ${res.netAvailable}`);
  console.log(`      使用率:           ${pct(res.netUsed, res.netLimit)}`);
  console.log("");
  console.log(`  ⚡ 能量 (ENERGY):`);
  console.log(`      总量/已用/可用:   ${res.energyLimit} / ${res.energyUsed} / ${res.energyAvailable}`);
  console.log(`      使用率:           ${pct(res.energyUsed, res.energyLimit)}`);
  console.log("");
  console.log(`  🔒 质押冻结 TRX:      ${res.frozenBalance.toLocaleString()} TRX`);
}

async function cmdTx(rawAddr, limit) {
  const addr = ensureAddress(rawAddr);
  console.log(`📮 查询地址: ${addr}`);
  console.log(`📋 最近 ${limit} 条交易记录：`);
  console.log("");

  const txs = await getRecentTransactions(tronWeb, addr, limit);
  if (txs.error) {
    console.error("❌ 查询失败：", txs.error);
    return;
  }
  if (txs.length === 0) {
    console.log("  （暂无交易记录）");
    return;
  }

  const statusColor = (s) => s === "SUCCESS" ? "\x1b[32m成功\x1b[0m" : `\x1b[31m${s}\x1b[0m`;
  console.log(
    `${"#".padEnd(4)}${"区块".padEnd(10)}${"时间".padEnd(22)}${"类型".padEnd(28)}${"状态".padEnd(10)}${"Fee(TRX)"}`
  );
  console.log("─".repeat(80));
  txs.forEach((tx, i) => {
    console.log(
      `${String(i + 1).padEnd(4)}` +
      `${String(tx.blockNumber).padEnd(10)}` +
      `${String(tx.timestamp).slice(5, 25).padEnd(22)}` +
      `${String(tx.contractType).padEnd(28)}` +
      `${statusColor(tx.status).padEnd(10)}` +
      `${tx.fee}`
    );
    console.log(`     txID: ${tx.txID}`);
  });
}

async function cmdUsdtTx(rawAddr, limit) {
  const addr = ensureAddress(rawAddr);
  console.log(`📮 查询地址: ${addr}`);
  console.log(`💵 最近 ${limit} 条 USDT 转账：`);
  console.log("");

  const txs = await getUsdtTransfers(tronWeb, addr, NETWORK, limit);
  if (txs.error) {
    console.error("⚠️ ", txs.error);
    if (txs.note) console.log(`   💡 ${txs.note}`);
    return;
  }
  if (txs.length === 0) {
    console.log("  （暂无 USDT 转账记录）");
    return;
  }
  txs.forEach((tx, i) => {
    console.log(
      `#${i + 1} 区块${tx.blockNumber} · ${tx.timestamp.slice(5, 19)}\n` +
      `    ${tx.from.slice(0, 14)}… → ${tx.to.slice(0, 14)}…  数量: ${tx.value.toLocaleString()} USDT\n` +
      `    txID: ${tx.txID}`
    );
  });
}

async function cmdBlock(arg) {
  if (arg === "latest" || arg == null) {
    const block = await getCurrentBlock(tronWeb);
    if (block.error) return console.error("❌ 查询失败：", block.error);
    console.log(`  🗂️ 当前区块高度: \x1b[1m${block.blockNumber.toLocaleString()}\x1b[0m`);
    console.log(`  ⏰ 出块时间:     ${block.timestamp}`);
    console.log(`  🏅 出块节点:     ${block.witnessAddress}`);
    return;
  }
  const num = parseInt(arg);
  if (isNaN(num)) {
    throw new Error("请提供有效的区块高度数字");
  }
  const block = await getBlockByNumber(tronWeb, num);
  if (block.error) return console.error("❌ 查询失败：", block.error);
  console.log(`  🗂️ 区块高度:     ${block.blockNumber.toLocaleString()}`);
  console.log(`  ⏰ 出块时间:     ${block.timestamp}`);
  console.log(`  🏅 出块节点:     ${block.witnessAddress}`);
  console.log(`  🌳 Tx Trie Root: ${block.txTrieRoot}`);
  console.log(`  👨 父块 Hash:    ${block.parentHash}`);
  console.log(`  📦 交易数量:     ${block.txCount}`);
}

async function cmdCurrent() {
  await cmdBlock("latest");
}

main().then(() => console.log(""));
