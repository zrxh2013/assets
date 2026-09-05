/**
 * anchor-contracts.mjs — 将 10 份 PtahDAO 信托合同签名批量上链
 * 
 * 每份合同的 (id, msgHash, signature) 写入 TRON 主网交易 memo
 * 因 memo 限制 ~900 字节，分 4 批上链 (3+3+3+1)
 * 
 * 发送地址: TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ
 * 接收地址: T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb (黑洞)
 * 金额: 1 drop (0.000001 TRX)
 */

import { TronWeb } from 'tronweb';
import { Buffer } from 'buffer';
import fs from 'fs';
import crypto from 'crypto';

const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });
const SEND_HEX = '41853164f135d68b65b7492fe29009bf0dc08b6311';  // TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ
const BURN_HEX = '410000000000000000000000000000000000000000';  // T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb
const PRIV_KEY = '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309';

// 读取合同签名
const contracts = JSON.parse(fs.readFileSync('./assets/trust-signatures.json', 'utf-8'));

// 精简每条记录：去掉 0x 前缀
const compact = contracts.map(c => ({
  id: c.id,
  h: c.msgHash.slice(2),   // keccak256 哈希 (64 hex)
  s: c.signature.slice(2), // secp256k1 签名 (130 hex)
}));

// 分批：每批最多 3 份（保证 memo < 900 字节）
const BATCH_SIZE = 3;
const batches = [];
for (let i = 0; i < compact.length; i += BATCH_SIZE) {
  batches.push(compact.slice(i, i + BATCH_SIZE));
}

console.log(`共 ${compact.length} 份合同，分 ${batches.length} 批上链`);
batches.forEach((b, i) => {
  const memo = JSON.stringify({
    ty: 'PTAH-CONTRACT',
    v: 1,
    b: i,
    total: batches.length,
    n: b.length,
    c: b,
  });
  console.log(`  批次 ${i + 1}: ${memo.length} bytes (合同 ${b.map(x => x.id).join(',')})`);
});

async function sendBatch(batchIdx, batchData) {
  const memoStr = JSON.stringify({
    ty: 'PTAH-CONTRACT',
    v: 1,
    b: batchIdx,
    total: batches.length,
    n: batchData.length,
    c: batchData,
    ts: Math.floor(Date.now() / 1000),
  });

  // 1. 构建交易
  const resp = await fetch('https://api.trongrid.io/wallet/createtransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_address: SEND_HEX, to_address: BURN_HEX, amount: 1 }),
  });
  const ct = await resp.json();
  if (ct.Error) throw new Error(ct.Error);

  // 2. 注入 memo protobuf (field 12, wire type 2)
  const memoBytes = Buffer.from(memoStr, 'utf-8');
  const memoProto = Buffer.concat([
    Buffer.from([0x62]),                    // field 12 << 3 | 2 = 0x62
    Buffer.from([memoBytes.length]),        // length (varint, 假设 < 128)
    memoBytes,
  ]);
  const rawBuf = Buffer.from(ct.raw_data_hex, 'hex');
  
  // 找到 timestamp 字段 (0x58) 结束位置，在其后插入 memo
  let tsEnd = rawBuf.length;
  for (let i = rawBuf.length - 1; i >= 0; i--) {
    if (rawBuf[i] === 0x58) {
      let pos = i + 1;
      while (pos < rawBuf.length && (rawBuf[pos] & 0x80)) pos++;
      pos++;
      tsEnd = pos;
      break;
    }
  }
  const finalRaw = Buffer.concat([rawBuf.slice(0, tsEnd), memoProto, rawBuf.slice(tsEnd)]);
  const finalRawHex = finalRaw.toString('hex');
  const txID = crypto.createHash('sha256').update(finalRaw).digest('hex');

  const tx = {
    raw_data: { ...ct.raw_data, memo: memoStr },
    raw_data_hex: finalRawHex,
    txID: txID,
    visible: false,
  };

  // 3. 签名
  const { signTransaction } = tw.utils.crypto;
  const signed = signTransaction(PRIV_KEY, tx);

  // 4. 广播
  const bcastResp = await fetch('https://api.trongrid.io/wallet/broadcasttransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  });
  const bcast = await bcastResp.json();

  return { bcast, txID, memoLen: memoStr.length };
}

async function main() {
  const results = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`\n[批次 ${i + 1}/${batches.length}] 上链中...`);
    try {
      const { bcast, txID, memoLen } = await sendBatch(i, batches[i]);
      if (bcast.result === true) {
        const txHash = bcast.txid || txID;
        console.log(`  ✅ 成功! txID: ${txHash}`);
        console.log(`  🔗 Tronscan: https://tronscan.org/#/transaction/${txHash}`);
        console.log(`  📝 memo: ${memoLen} bytes`);
        results.push({
          batch: i + 1,
          txID: txHash,
          url: `https://tronscan.org/#/transaction/${txHash}`,
          contracts: batches[i].map(c => c.id),
          memoLen,
        });
      } else {
        console.error(`  ❌ 失败: ${JSON.stringify(bcast).substring(0, 500)}`);
        if (bcast.message) {
          try {
            console.error(`  decoded: ${Buffer.from(bcast.message, 'hex').toString('utf-8')}`);
          } catch (e) {}
        }
        results.push({ batch: i + 1, error: bcast });
      }
    } catch (e) {
      console.error(`  ❌ 异常: ${e.message}`);
      results.push({ batch: i + 1, error: e.message });
    }
    // 等待 2 秒避免频率限制
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  // 保存结果
  fs.writeFileSync(
    './assets/contract-anchor-result.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\n' + '='.repeat(60));
  console.log(`完成: ${results.filter(r => r.txID).length}/${batches.length} 批成功`);
  console.log('结果已保存到 ./assets/contract-anchor-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
