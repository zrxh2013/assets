// USDT 转账凭证 - 批量版本
// 向每个受益人转账真实金额的 USDT，同时在 memo 中携带存证数据
// 链上看起来就是普通的 USDT 转账，金额与确权金额一致
// 支持断点续传
import { TronWeb } from 'tronweb';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ============ 配置 ============
const SENDER_PRIV = '你的发送方私钥';
const USDT_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // 波场主网 USDT 合约
const RESULTS_FILE = '/tmp/usdt-attestation-results.json';

const tw = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: SENDER_PRIV,
});

// ============ 受益人列表 ============
const beneficiaries = [
  { name: "杨王兴", addr: "TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv", amount: "87455.20", receipt: "REC-0001" },
  { name: "陈志琦", addr: "TTEQktFXNvQeFFqGbALhHHTtUVqieanDqz", amount: "89540.00", receipt: "REC-0002" },
  { name: "刘玉珍", addr: "TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG", amount: "92831.00", receipt: "REC-0003" },
  { name: "蔡金木", addr: "TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3", amount: "35880.00", receipt: "REC-0004" },
  { name: "13913516336", addr: "THmuNGuu6XbEhnb3ZMewi2wHpiagzQH547", amount: "28932.00", receipt: "REC-0005" },
  { name: "杨必胜", addr: "TLz94yY3DP1PjJcJH6G2XajLLtriJnJqPi", amount: "63023.31", receipt: "REC-0006" },
  { name: "张建仁", addr: "TQTW7w6g3jmoHJdBfvAcRjq19hNZssE1GM", amount: "12577.82", receipt: "REC-0007" },
  { name: "杨春", addr: "TQaK2i9Ez32roCw4SkbKPD3rANf1zwrKAd", amount: "130674.00", receipt: "REC-0008" },
  { name: "孙影", addr: "TY8MjaQgjXevUto8CPFTiDjYzY4eq1ZBUZ", amount: "211359.04", receipt: "REC-0009" },
  { name: "吴胜才", addr: "TUKqF7NKq9wm8H2BjdMteY3YNucesSxTEX", amount: "133650.01", receipt: "REC-0010" },
  // ... 更多受益人可在此添加
];

// ============ 工具函数 ============
function loadResults() {
  if (existsSync(RESULTS_FILE)) {
    return JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
  }
  return {};
}

function saveResults(results) {
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// ============ 单笔 USDT 转账凭证 ============
async function attestOne(b, sender) {
  const amountUsdt = parseFloat(b.amount);
  const amountSun = Math.floor(amountUsdt * 1e6);

  // 构造 memo
  const memoData = {
    t: b.name,
    a: b.amount,
    r: b.receipt,
    addr: b.addr,
    ts: Math.floor(Date.now() / 1000),
  };
  const memoHex = Buffer.from(JSON.stringify(memoData)).toString('hex');

  // 构造 USDT 转账交易
  const result = await tw.transactionBuilder.triggerSmartContract(
    USDT_ADDR,
    'transfer(address,uint256)',
    { feeLimit: 100000000 },
    [
      { type: 'address', value: b.addr },
      { type: 'uint256', value: amountSun },
    ],
    sender
  );

  const tx = result.transaction;

  // 添加 memo 并重新计算 txID 和 raw_data_hex（关键步骤）
  tx.raw_data.data = memoHex;
  const { txJsonToPb, txPbToTxID, txPbToRawDataHex } = tw.utils.transaction;
  const pb = txJsonToPb(tx);
  tx.txID = txPbToTxID(pb).replace(/^0x/, '');
  tx.raw_data_hex = txPbToRawDataHex(pb).toLowerCase();

  // 签名并广播
  const signed = await tw.trx.sign(tx, SENDER_PRIV);
  const sent = await tw.trx.sendRawTransaction(signed);

  return {
    txid: sent.txid,
    memo: JSON.stringify(memoData),
    amount: amountUsdt,
  };
}

// ============ 批量执行 ============
async function main() {
  const sender = tw.defaultAddress.base58;
  console.log('发送方:', sender);
  console.log('USDT 合约:', USDT_ADDR);
  console.log('受益人数量:', beneficiaries.length);
  console.log('');

  // 检查 USDT 总余额
  const contract = await tw.contract().at(USDT_ADDR);
  const usdtBal = Number((await contract.balanceOf(sender).call()).toString()) / 1e6;
  const totalNeed = beneficiaries.reduce((s, b) => s + parseFloat(b.amount), 0);
  console.log(`USDT 余额: ${usdtBal.toLocaleString()} USDT`);
  console.log(`需要总额: ${totalNeed.toLocaleString()} USDT`);
  if (usdtBal < totalNeed) {
    console.error(`❌ USDT 余额不足，还差 ${(totalNeed - usdtBal).toLocaleString()} USDT`);
    return;
  }
  console.log('✅ USDT 余额充足');
  console.log('');

  // 加载已完成记录（断点续传）
  const results = loadResults();
  console.log(`已完成 ${Object.keys(results).length} 笔，待处理 ${beneficiaries.length - Object.keys(results).length} 笔`);
  console.log('');

  let success = 0;
  let failed = 0;

  for (const b of beneficiaries) {
    if (results[b.receipt]) {
      console.log(`⏭ 跳过 ${b.receipt} ${b.name}（已完成）`);
      continue;
    }

    try {
      const r = await attestOne(b, sender);
      results[b.receipt] = {
        name: b.name,
        addr: b.addr,
        amount: b.amount,
        txid: r.txid,
        memo: r.memo,
        time: new Date().toISOString(),
      };
      saveResults(results);
      success++;
      console.log(`✅ ${b.receipt} ${b.name} | ${b.amount} USDT | tx: ${r.txid.slice(0, 16)}...`);
    } catch (e) {
      failed++;
      console.error(`❌ ${b.receipt} ${b.name} 失败: ${e.message}`);
    }

    // 间隔避免触发限流
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('');
  console.log('=== 执行完毕 ===');
  console.log(`成功: ${success} 笔`);
  console.log(`失败: ${failed} 笔`);
  console.log(`总计完成: ${Object.keys(results).length} / ${beneficiaries.length} 笔`);
  console.log(`结果文件: ${RESULTS_FILE}`);
}

main().catch((e) => console.error('Fatal:', e));
