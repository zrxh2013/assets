import { TronWeb } from 'tronweb';
import { keccak256 } from 'ethereumjs-util';
import { Buffer } from 'buffer';
import fs from 'fs';

const MAINNET_RPC = 'https://api.trongrid.io';
const SEND_ADDR   = 'TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ';
const SEND_KEY    = '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309';
const BURN_ADDR   = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const NILE_CONTRACT = 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq';

const tronWeb = new TronWeb({ fullHost: MAINNET_RPC, privateKey: SEND_KEY });

function keccak(hexStr) {
  const buf = Buffer.from(hexStr.replace('0x',''), 'hex');
  return '0x' + keccak256(buf).toString('hex');
}
function buildTree(hashes) {
  let level = [...hashes];
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length-1]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(keccak(level[i] + level[i+1].replace('0x','')));
    }
    level = next;
  }
  return level[0] || '0x0';
}

async function main() {
  console.log('='.repeat(60));
  console.log('🔒  1156 笔 Nile USDT 转账 → 主网链上存证');
  console.log('='.repeat(60));

  const txs = JSON.parse(fs.readFileSync('./assets/all-1156-txs.json'));
  console.log(`\n📂 加载 ${txs.length} 笔`);

  const normalized = txs.map((t, i) => ({
    txID: t.txID || t.hash || t.transactionHash,
    from: t.from || t.sender, to: t.to || t.receiver,
    amount: String(t.amount || t.value || 0),
    block: t.block || t.blockNumber || t.block_num,
    time: t.time || t.timestamp || t.createdAt,
  }));
  const seen = new Set();
  const unique = normalized.filter(t => { if (seen.has(t.txID)) return false; seen.add(t.txID); return true; });
  console.log(`   去重后: ${unique.length} 笔`);

  // Merkle Tree
  const leaves = unique.map(t => keccak('0x' + Buffer.from(`${t.txID}|${t.amount}|${t.from}|${t.to}`).toString('hex')));
  const merkleRoot = buildTree(leaves);
  console.log(`\n🌳 Merkle Root: ${merkleRoot}`);
  console.log(`   树深度: ${Math.ceil(Math.log2(unique.length))} 层`);

  // 每笔 Anchor Hash
  const anchorMap = unique.map((tx, i) => ({
    index: i, txID: tx.txID,
    anchor_hash: keccak('0x' + Buffer.from(`${merkleRoot}|${i}|${tx.txID}`).toString('hex')),
    from: tx.from, to: tx.to, amount: tx.amount, block: tx.block, time: tx.time,
  }));
  console.log(`\n🔑 Anchor Hash 示例:`);
  console.log(`   #1    : ${anchorMap[0].anchor_hash}`);
  console.log(`   #500  : ${anchorMap[499].anchor_hash}`);
  console.log(`   #${unique.length} : ${anchorMap[anchorMap.length-1].anchor_hash}`);

  // 统计
  const totalAmount = unique.reduce((s, t) => s + BigInt(t.amount || 0), 0n);
  const fromAddrs = new Set(unique.map(t => t.from));
  const toAddrs = new Set(unique.map(t => t.to));
  const blocks = unique.map(t => Number(t.block)||0).filter(b=>b>0);
  const blkMin = blocks.length ? Math.min(...blocks) : 0;
  const blkMax = blocks.length ? Math.max(...blocks) : 0;

  // Memo (compact)
  const memoObj = {
    a: 'usdt-1156-anchor', v: '2.0',
    n: 'TRON-MAINNET', s: 'TRON-NILE',
    c: NILE_CONTRACT, m: merkleRoot,
    t: unique.length, u: fromAddrs.size, r: toAddrs.size,
    amt: String(totalAmount), blk: `${blkMin}~${blkMax}`,
    samples: [0,100,300,500,700,900,1000,1100,1128,1155].filter(i=>i<unique.length).map(i=>({i,ah:anchorMap[i].anchor_hash.slice(2,18)})),
    ts: Math.floor(Date.now()/1000),
  };
  const memoStr = JSON.stringify(memoObj);
  const memoHex = '0x' + Buffer.from(memoStr).toString('hex');
  console.log(`\n📝 Memo: ${Buffer.byteLength(memoStr)} 字节`);

  // 余额
  const balSun = await tronWeb.trx.getBalance(SEND_ADDR);
  console.log(`💰 钱包 ${SEND_ADDR}: ${(balSun/1e6).toFixed(4)} TRX`);
  if (balSun < 1000) { console.log('❌ 余额不足 0.001 TRX'); process.exit(1); }

  // ✅ 简化：直接用 sendTransaction（自动签名+广播）
  console.log(`\n📤 发送 1 sun (0.000001 TRX) 到销毁地址 + memo...`);
  console.log(`   Memo Hex: ${memoHex.length} chars`);

  const result = await tronWeb.trx.sendTransaction(
    BURN_ADDR,
    1,  // 1 sun
    { memo: memoHex }
  );

  console.log(`\n🔍 返回: ${JSON.stringify(result)}`);

  if (result && (result.result === true || result.transaction && result.transaction.id)) {
    const txHash = result.transaction?.id || result.txID || '';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎉  存证成功！`);
    console.log(`${'='.repeat(60)}`);
    console.log(`主网 txID  : ${txHash}`);
    console.log(`Tronscan   : https://tronscan.org/#/transaction/${txHash}`);
    console.log(`Merkle Root: ${merkleRoot}`);
    console.log(`总交易数   : ${unique.length}`);
    console.log(`总金额     : ${(Number(totalAmount)/1e6).toLocaleString()} USDT`);
    console.log(`Unique From: ${fromAddrs.size}`);
    console.log(`Unique To  : ${toAddrs.size}`);
    console.log(`区块范围   : #${blkMin} ~ #${blkMax}`);

    const finalResult = {
      timestamp: new Date().toISOString(),
      mainnetTxID: txHash,
      mainnetUrl: `https://tronscan.org/#/transaction/${txHash}`,
      merkleRoot,
      stats: {
        totalTxs: unique.length,
        totalAmountRaw: String(totalAmount),
        totalAmountDisplay: (Number(totalAmount)/1e6).toFixed(2),
        uniqueFrom: fromAddrs.size, uniqueTo: toAddrs.size,
        blockRange: `${blkMin}~${blkMax}`, nileContract: NILE_CONTRACT,
      },
      anchorMap,
      memoSize: Buffer.byteLength(memoStr),
    };
    fs.writeFileSync('./assets/anchor-result-v2.json', JSON.stringify(finalResult, null, 2));
    console.log(`\n✅ 已保存 assets/anchor-result-v2.json`);
  } else {
    console.log(`❌ 失败: ${JSON.stringify(result)}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
