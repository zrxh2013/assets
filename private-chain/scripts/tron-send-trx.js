// scripts/tron-send-trx.js
// 批量分发 TRX 到多个地址
// 用法:
//   TRON_NETWORK=nile TRON_PRIVATE_KEY=xxx node scripts/tron-send-trx.js <to> <amount>
//   TRON_NETWORK=nile TRON_PRIVATE_KEY=xxx node scripts/tron-send-trx.js batch <csv:addr,amount;addr,amount...>

const { createClient } = require("../tron/client");
const config = require("../tron/config");

const NETWORK = process.env.TRON_NETWORK || "mainnet";
const PRIV = process.env.TRON_PRIVATE_KEY;

async function sendTrx(toAddress, amountTrx) {
  if (!PRIV) throw new Error("请设置 TRON_PRIVATE_KEY 环境变量");
  const tronWeb = createClient(NETWORK, PRIV);
  const from = tronWeb.defaultAddress.base58;

  const amountSun = Math.floor(amountTrx * config.sun);

  console.log(`\n📤 发送 ${amountTrx} TRX (${amountSun} SUN)`);
  console.log(`   从: ${from}`);
  console.log(`   到:   ${toAddress}`);

  const balBefore = await tronWeb.trx.getBalance(from);
  if (balBefore < amountSun + 100_000) {
    throw new Error(`余额不足: 发送需要 ${(amountSun + 100_000) / config.sun} TRX，当前只有 ${balBefore / config.sun} TRX`);
  }

  // 构造普通 TRX 转账交易（无 memo）
  const tx = await tronWeb.trx.sendTransaction(toAddress, amountSun);
  if (!tx || !tx.txid) {
    throw new Error("转账失败: " + JSON.stringify(tx));
  }

  console.log(`✅ 已广播交易:`);
  console.log(`   交易哈希: ${tx.txid}`);
  console.log(`   浏览器:   https://nile.tronscan.org/#/transaction/${tx.txid}`);

  // 等待 3 秒确认
  await new Promise(r => setTimeout(r, 3000));
  const balAfter = await tronWeb.trx.getBalance(toAddress);
  console.log(`   对方余额: ${balAfter / config.sun} TRX`);

  return tx.txid;
}

async function batchSend(pairs) {
  const results = [];
  for (const { to, amount } of pairs) {
    try {
      const txid = await sendTrx(to, amount);
      results.push({ to, amount, txid, ok: true });
    } catch (e) {
      console.log(`❌ 失败 (${to}): ${e.message}`);
      results.push({ to, amount, error: e.message, ok: false });
    }
  }
  return results;
}

async function main() {
  const [_n, _s, cmd, ...args] = process.argv;

  if (!cmd) {
    console.log(`
  TRX 批量分发工具
  ─────────────────

  单笔转账:
    node scripts/tron-send-trx.js <toAddress> <amountTrx>

  批量转账 (格式: addr1,amt1;addr2,amt2;...):
    node scripts/tron-send-trx.js batch "TPBivseBCFmG8AEL38DJ4hxrFMQteENxDz,100;TBxcJtrCeCFkHp47jshFMBWGB1n7igSHm2,100"

  环境变量:
    TRON_NETWORK=mainnet|nile      默认 mainnet
    TRON_PRIVATE_KEY=<hex私钥>     必填，发送方私钥 (0x前缀可省略)
`);
    return;
  }

  if (cmd === "batch") {
    const spec = args[0];
    if (!spec) throw new Error("请提供批量转账列表");
    const pairs = spec.split(";").map(s => {
      const [to, amount] = s.split(",");
      if (!to || !amount) throw new Error(`格式错误: "${s}"，应为 addr,amount`);
      return { to: to.trim(), amount: parseFloat(amount) };
    });
    console.log(`\n🚀 开始批量分发 ${pairs.length} 笔 TRX (网络: ${NETWORK})`);
    const results = await batchSend(pairs);
    console.log("\n" + "═".repeat(50));
    console.log("📋 汇总:");
    const okCount = results.filter(r => r.ok).length;
    console.log(`   成功: ${okCount}/${pairs.length}`);
    results.forEach(r => {
      console.log(`   ${r.ok ? "✅" : "❌"} ${r.to}  ${r.amount} TRX  ${r.ok ? "txID:" + r.txid.slice(0, 16) + "…" : "错误:" + r.error}`);
    });
  } else {
    // 单笔
    const to = cmd;
    const amount = parseFloat(args[0]);
    if (!to || !amount) throw new Error("用法: node scripts/tron-send-trx.js <toAddress> <amountTrx>");
    await sendTrx(to, amount);
  }
}

main().catch(e => { console.error("❌", e.message); process.exitCode = 1; });
