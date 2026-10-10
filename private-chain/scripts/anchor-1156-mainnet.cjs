// ============================================================
// 1156 笔 Nile USDT 转账 → 主网链上存证
// ============================================================
const { TronWeb } = require('tronweb');
const { keccak256, toHex } = require('ethereumjs-util');
const fs = require('fs');

// ---- 配置 ----
const MAINNET_RPC = 'https://api.trongrid.io';
const SEND_ADDR   = 'TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ';
const SEND_KEY    = '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309';
const BURN_ADDR   = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'; // Tron 销毁地址
const NILE_CONTRACT = 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq';
const DATA_FILE   = './assets/all-1156-txs.json';

// ---- 初始化 TronWeb ----
const tronWeb = new TronWeb({
  fullHost: MAINNET_RPC,
  privateKey: SEND_KEY,
});

console.log('='.repeat(60));
console.log('🔒  1156 笔 Nile USDT 转账 → 主网链上存证');
console.log('='.repeat(60));

// ---- 1. 加载数据 ----
console.log('\n📂 加载数据...');
const txs = JSON.parse(fs.readFileSync(DATA_FILE));
console.log(`   共 ${txs.length} 笔交易`);

// 规范化数据（不同来源字段名可能不同）
const normalized = txs.map((t, i) => ({
  index: i,
  txID: t.txID || t.hash || t.transactionHash || t.tx_hash,
  from: t.from || t.sender,
  to: t.to || t.receiver,
  amount: String(t.amount || t.value || 0),
  block: t.block || t.blockNumber || t.block_num,
  time: t.time || t.timestamp || t.createdAt,
}));

// 去重（按 txID）
const seen = new Set();
const unique = normalized.filter(t => {
  if (seen.has(t.txID)) return false;
  seen.add(t.txID);
  return true;
});
console.log(`   去重后: ${unique.length} 笔`);

// ---- 2. 构建 Merkle Tree ----
console.log('\n🌳 构建 Merkle Tree...');

function keccak(hexStr) {
  const buf = Buffer.from(hexStr.replace('0x',''), 'hex');
  return '0x' + keccak256(buf).toString('hex');
}

// 叶子节点: keccak256(txID + "|" + amount + "|" + from + "|" + to)
function leafHash(tx) {
  const data = `${tx.txID}|${tx.amount}|${tx.from}|${tx.to}`;
  return keccak('0x' + Buffer.from(data).toString('hex'));
}

// 计算每笔的 Anchor Hash: keccak256(MerkleRoot + index + txID)
function anchorHash(merkleRoot, index, txID) {
  return keccak('0x' + Buffer.from(`${merkleRoot}|${index}|${txID}`).toString('hex'));
}

// 构建 Merkle Tree
function buildTree(hashes) {
  let level = hashes.slice();
  while (level.length > 1) {
    const next = [];
    if (level.length % 2 === 1) level.push(level[level.length-1]); // 奇数末尾复制
    for (let i = 0; i < level.length; i += 2) {
      next.push(keccak(level[i] + level[i+1].replace('0x','')));
    }
    level = next;
  }
  return level[0] || '0x0';
}

const leaves = unique.map(leafHash);
const merkleRoot = buildTree(leaves);
console.log(`   Merkle Root: ${merkleRoot}`);
console.log(`   树深度: ${Math.ceil(Math.log2(unique.length))} 层`);

// ---- 3. 生成每笔独立 Anchor Hash ----
console.log('\n🔑 生成每笔独立 Anchor Hash...');
const anchorMap = unique.map((tx, i) => ({
  index: i,
  txID: tx.txID,
  anchor_hash: anchorHash(merkleRoot, i, tx.txID),
  from: tx.from,
  to: tx.to,
  amount: tx.amount,
  block: tx.block,
  time: tx.time,
}));
console.log(`   已为 ${anchorMap.length} 笔生成 Anchor Hash`);
console.log(`   第 1 笔: ${anchorMap[0].anchor_hash}`);
console.log(`   第 500 笔: ${anchorMap[499]?.anchor_hash}`);
console.log(`   最后 笔: ${anchorMap[anchorMap.length-1].anchor_hash}`);

// ---- 4. 验证 Merkle Proof ----
console.log('\n✅ Merkle Proof 验证...');
function getProof(hashes, index) {
  const proof = [];
  let level = hashes.slice();
  let idx = index;
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length-1]);
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push(level[pairIdx]);
    idx = Math.floor(idx / 2);
    level = level.filter((_, i) => i % 2 === 0 || i === pairIdx);
    level = level.slice(0, Math.ceil(level.length / 2) * 2);
    const next = [];
    if (level.length % 2 === 1) level.push(level[level.length-1]);
    for (let i = 0; i < level.length; i += 2) {
      next.push(keccak(level[i] + level[i+1].replace('0x','')));
    }
    level = next;
  }
  return proof;
}
const idx0 = 0, idxMid = Math.floor(unique.length/2), idxLast = unique.length-1;
const fakeHash = '0x' + 'aa'.repeat(32);
const proof0 = getProof(leaves, idx0);
function verifyProof(leaf, proof, index, root) {
  let h = leaf;
  let idx = index;
  for (const sib of proof) {
    h = idx % 2 === 0 ? keccak(h + sib.replace('0x','')) : keccak(sib + h.replace('0x',''));
    idx = Math.floor(idx / 2);
  }
  return h === root;
}
console.log(`   第 ${idx0+1} 笔 proof → ${verifyProof(leaves[idx0], proof0, idx0, merkleRoot) ? '✅' : '❌'}`);
const proofMid = getProof(leaves, idxMid);
console.log(`   第 ${idxMid+1} 笔 proof → ${verifyProof(leaves[idxMid], proofMid, idxMid, merkleRoot) ? '✅' : '❌'}`);
const proofLast = getProof(leaves, idxLast);
console.log(`   最后 ${unique.length} 笔 proof → ${verifyProof(leaves[idxLast], proofLast, idxLast, merkleRoot) ? '✅' : '❌'}`);
console.log(`   伪造交易 proof → ${verifyProof(fakeHash, proof0, 0, merkleRoot) ? '❌ 错误接受' : '✅ 正确拒绝'}`);

// ---- 5. 准备主网 memo ----
console.log('\n📝 准备主网 memo...');

// 统计数据
const totalAmount = unique.reduce((s, t) => s + BigInt(t.amount || 0), 0n);
const fromAddrs = new Set(unique.map(t => t.from));
const toAddrs = new Set(unique.map(t => t.to));
const blocks = unique.map(t => Number(t.block) || 0).filter(b => b > 0);
const blockMin = blocks.length ? Math.min(...blocks) : 0;
const blockMax = blocks.length ? Math.max(...blocks) : 0;

// memo 结构（紧凑 JSON）
const memoObj = {
  a: 'usdt-1156-anchor',        // anchor 类型
  v: '2.0',                      // 版本
  n: 'TRON-MAINNET',             // 网络
  s: 'TRON-NILE',                // 源网络
  c: NILE_CONTRACT,              // Nile USDT 合约
  m: merkleRoot,                 // Merkle Root ⭐
  t: unique.length,               // 总交易数
  u: fromAddrs.size,             // unique from
  r: toAddrs.size,               // unique to
  amt: String(totalAmount),      // 总金额（raw, 6 位小数）
  blk: `${blockMin}~${blockMax}`, // 区块范围
  // 10 个样本 Anchor Hash（前 5 + 中 5）
  samples: [0, 100, 300, 500, 700, 900, 1000, 1100, 1128, 1155].filter(i => i < unique.length).map(i => ({
    i, tx: anchorMap[i].txID.slice(0,10)+'...',
    ah: anchorMap[i].anchor_hash.slice(2, 14),  // anchor hash 短码
  })),
  ts: Math.floor(Date.now() / 1000),
};

const memoStr = JSON.stringify(memoObj);
console.log(`   memo JSON 大小: ${Buffer.byteLength(memoStr)} 字节`);
console.log(`   (TRON memo 上限约 900 字节)`);

// 转 hex 注入
const memoHex = '0x' + Buffer.from(memoStr).toString('hex');
console.log(`   memo hex 长度: ${memoHex.length}`);

// ---- 6. 主网广播 ----
console.log('\n📡 查询钱包余额...');
const balanceSun = await tronWeb.trx.getBalance(SEND_ADDR);
const balanceTRX = balanceSun / 1_000_000;
console.log(`   钱包: ${SEND_ADDR}`);
console.log(`   余额: ${balanceTRX.toFixed(4)} TRX`);

if (balanceTRX < 0.01) {
  console.log('❌ 余额不足，请先充值 TRX');
  process.exit(1);
}

console.log('\n📤 构造 TRX 转账锚定交易...');
// 发送 0 TRX + memo，手续费约 0.001 TRX
const tx = await tronWeb.trx.sendTransaction(
  BURN_ADDR,
  0,  // 0 TRX value，只花 gas
  { memo: memoHex }
);

console.log(`   交易构造成功`);
console.log(`   txID: ${tx.transaction.id}`);

// 签名
const signed = await tronWeb.trx.sign(tx);
console.log('   签名完成');

// 广播
console.log('\n🚀 广播到主网...');
const result = await tronWeb.trx.sendRawTransaction(signed);

if (result && result.result === true) {
  console.log(`✅ 广播成功！`);
  console.log(`   主网 txID: ${result.transaction.id}`);
  console.log(`   Tronscan:  https://tronscan.org/#/transaction/${result.transaction.id}`);
} else {
  console.log(`❌ 广播失败: ${JSON.stringify(result)}`);
  process.exit(1);
}

// ---- 7. 保存结果 ----
console.log('\n💾 保存结果...');
const finalResult = {
  timestamp: new Date().toISOString(),
  mainnetTxID: result.transaction.id,
  mainnetUrl: `https://tronscan.org/#/transaction/${result.transaction.id}`,
  merkleRoot,
  stats: {
    totalTxs: unique.length,
    totalAmountRaw: String(totalAmount),
    totalAmountDisplay: (Number(totalAmount) / 1e6).toFixed(2),
    uniqueFrom: fromAddrs.size,
    uniqueTo: toAddrs.size,
    blockRange: `${blockMin}~${blockMax}`,
    nileContract: NILE_CONTRACT,
  },
  anchorMap: anchorMap,  // 全部 1156 笔的独立 Anchor Hash
  memoSize: Buffer.byteLength(memoStr),
};

fs.writeFileSync('./assets/anchor-result-v2.json', JSON.stringify(finalResult, null, 2));
console.log('✅ 已保存到 assets/anchor-result-v2.json');

console.log('\n' + '='.repeat(60));
console.log('🎉  存证完成！');
console.log('='.repeat(60));
console.log(`\n主网锚定交易: ${result.transaction.id}`);
console.log(`Merkle Root : ${merkleRoot}`);
console.log(`总交易数    : ${unique.length}`);
console.log(`总金额      : ${(Number(totalAmount)/1e6).toLocaleString()} USDT`);
console.log(`\n每笔独立 Anchor Hash = keccak256(MerkleRoot + index + txID)`);
console.log(`可在 Tronscan 主网查询: https://tronscan.org/#/transaction/${result.transaction.id}`);

