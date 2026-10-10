// V3 Merkle Root 锚定：用 trongrid API 拉取 txID → Merkle Tree → 主网广播
const { TronWeb } = require('tronweb');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

const PRIV = JSON.parse(fs.readFileSync('/tmp/mainnet-wallet.json', 'utf8')).privateKey;
const FROM = JSON.parse(fs.readFileSync('/tmp/mainnet-wallet.json', 'utf8')).address;
const ADDR = 'TYSfgUcvATDNhqkQ2aPC5eGNo4X2c89epx';
const BURN = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const V2_TX = '0d201f3c28b1fa9a6a057325af877bd20bf66074ba57d86cb0b7f70fe24d4bbc';

function sha256Hex(a, b) {
  if (b !== undefined) return crypto.createHash('sha256').update(Buffer.from(a + b, 'hex')).digest('hex');
  return crypto.createHash('sha256').update(Buffer.from(a, 'hex')).digest('hex');
}

function buildMerkleTree(leaves) {
  if (leaves.length === 0) return { root: '', layers: [] };
  let current = leaves.map(tx => sha256Hex(tx));
  const layers = [current];
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : left;
      next.push(sha256Hex(left, right));
    }
    layers.push(next);
    current = next;
  }
  return { root: current[0], layers };
}

function getMerklePath(layers, index) {
  const path = [];
  let idx = index;
  for (let i = 0; i < layers.length - 1; i++) {
    const sibIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = sibIdx < layers[i].length ? layers[i][sibIdx] : layers[i][idx];
    path.push({ pos: idx % 2 === 0 ? 'R' : 'L', hash: sibling });
    idx = Math.floor(idx / 2);
  }
  return path;
}

function verifyPath(leaf, path, root) {
  let h = sha256Hex(leaf);
  for (const n of path) h = sha256Hex(n.pos === 'L' ? n.hash + h : h + n.hash);
  return h === root;
}

// 用 curl 拉取 trongrid API
function curlJSON(url) {
  try {
    const out = execSync('curl -s "' + url + '" -H "User-Agent: Mozilla/5.0" 2>/dev/null', { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(out.toString());
  } catch(e) { return null; }
}

(async () => {
  console.log('=== V3 Merkle Root 锚定 ===\n');

  // 1. 拉取全部 TRC20 交易 txID
  console.log('1. 拉取交易 txID (trongrid API)...');
  let allTxIDs = [];
  let fingerprint = '';
  let page = 0;

  while (true) {
    let url = 'https://nile.trongrid.io/v1/accounts/' + ADDR + '/transactions/trc20?limit=200&order_by=block_timestamp,desc';
    if (fingerprint) url += '&fingerprint=' + fingerprint;
    
    const data = curlJSON(url);
    if (!data || !data.success || !data.data) {
      console.log('  API 返回失败, page ' + page);
      break;
    }
    
    for (const tx of data.data) {
      if (tx.transaction_id) allTxIDs.push(tx.transaction_id);
    }
    
    page++;
    fingerprint = data.meta?.fingerprint;
    process.stdout.write('\r  已拉取 ' + allTxIDs.length + ' 笔 (page ' + page + ')');
    
    if (!fingerprint || data.data.length < 200) break;
    if (page > 30) { console.log('\n  达到 30 页上限'); break; }
  }

  // 去重
  allTxIDs = [...new Set(allTxIDs)];
  console.log('\n  总计: ' + allTxIDs.length + ' 笔 txID (去重后)');

  if (allTxIDs.length === 0) {
    console.error('❌ 没有拉到交易，退出');
    process.exit(1);
  }

  // 2. 构建 Merkle Tree
  console.log('\n2. 构建 Merkle Tree...');
  const { root, layers } = buildMerkleTree(allTxIDs);
  console.log('  叶子数: ' + allTxIDs.length);
  console.log('  Tree 层数: ' + layers.length);
  console.log('  Merkle Root: ' + root);

  // 3. 验证测试
  console.log('\n3. Merkle Path 验证测试...');
  for (const idx of [0, Math.floor(allTxIDs.length / 2), allTxIDs.length - 1]) {
    const path = getMerklePath(layers, idx);
    const valid = verifyPath(allTxIDs[idx], path, root);
    console.log('  第 ' + (idx + 1) + ' 笔 (' + allTxIDs[idx].slice(0, 12) + '...): ' + path.length + ' 层, ' + (valid ? '✅' : '❌'));
  }

  // 4. 构造 V3 memo
  console.log('\n4. 构造 V3 memo...');
  const memo = {
    ty: 'BATCH',
    v: 3,
    s: 'nile',
    a: ADDR.slice(0, 12),
    n: allTxIDs.length,
    root: root,
    prev: V2_TX.slice(0, 16),
    algo: 'SHA256'
  };
  const memoStr = JSON.stringify(memo);
  const memoSize = Buffer.byteLength(memoStr, 'utf8');
  console.log('  memo 大小: ' + memoSize + ' bytes');
  console.log('  memo: ' + memoStr.slice(0, 120) + '...');

  // 保存 Merkle tree
  fs.writeFileSync('/tmp/merkle-tree.json', JSON.stringify({
    root, leafCount: allTxIDs.length, leaves: allTxIDs,
    layers, createdAt: new Date().toISOString()
  }));
  console.log('  Merkle Tree 已保存到 /tmp/merkle-tree.json');

  // 5. 主网广播
  console.log('\n5. 主网广播...');
  const tw = new TronWeb({ fullHost: 'https://api.trongrid.io', privateKey: PRIV });
  const acct = await tw.trx.getAccount(FROM);
  console.log('  余额:', ((acct.balance || 0) / 1e6).toFixed(2), 'TRX');

  const unSignedTx = await tw.transactionBuilder.sendTrx(BURN, 1, FROM);
  unSignedTx.raw_data.data = Buffer.from(memoStr, 'utf8').toString('hex');
  const txUtil = tw.utils.transaction;
  const pb = txUtil.txJsonToPb(unSignedTx);
  unSignedTx.txID = txUtil.txPbToTxID(pb).replace(/^0x/, '');
  unSignedTx.raw_data_hex = txUtil.txPbToRawDataHex(pb).toLowerCase();

  const signed = await tw.trx.sign(unSignedTx);
  const result = await tw.trx.sendRawTransaction(signed);
  console.log('  广播:', result.result ? '✅ 成功' : '❌ 失败');

  if (result.result) {
    const txID = signed.txID || unSignedTx.txID;
    console.log('  主网 txID:', txID);
    console.log('\n  等待确认 (10秒)...');
    await new Promise(r => setTimeout(r, 10000));

    const info = await tw.trx.getTransactionInfo(txID);
    const bn = info.blockNumber;
    const fee = (info.fee || 0) / 1e6;
    console.log('\n=== 链上验证 ===');
    console.log('  Block:', bn ? '#' + bn : 'pending');
    console.log('  Fee:', fee.toFixed(6), 'TRX');

    const tx = await tw.trx.getTransaction(txID);
    if (tx?.raw_data?.data) {
      const decoded = Buffer.from(tx.raw_data.data, 'hex').toString('utf8');
      const json = JSON.parse(decoded);
      console.log('\n=== memo 解码 ===');
      console.log('  类型:', json.ty, '| 版本:', json.v);
      console.log('  交易数:', json.n);
      console.log('  Merkle Root:', json.root);
      console.log('  算法:', json.algo);
    }

    const after = await tw.trx.getAccount(FROM);
    console.log('\n  剩余余额:', ((after.balance || 0) / 1e6).toFixed(2), 'TRX');
    console.log('\n🔗 https://tronscan.org/#/transaction/' + txID);
  } else {
    console.error('  错误:', JSON.stringify(result));
  }
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
