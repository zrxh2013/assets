/**
 * anchor-contracts-individual.mjs — 每份合同单独上链存证
 * 
 * 每份 PtahDAO 信托合同的 (id, msgHash, signature) 写入一笔独立的
 * TRON 主网交易 memo，实现"签约即上链"。
 * 
 * 单份 memo 约 250-300 字节，远低于 900 字节限制。
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

console.log(`共 ${contracts.length} 份合同，每份单独上链`);
console.log('-'.repeat(60));

async function sendContract(c) {
  // 构造单份合同 memo
  const memoStr = JSON.stringify({
    ty: 'PTAH-CONTRACT',   // 类型：PtahDAO 合同存证
    v: 1,                  // 版本
    id: c.id,              // 合同编号
    title: c.title,        // 合同标题
    date: c.date,          // 签署日期
    h: c.msgHash.slice(2), // keccak256 哈希 (64 hex)
    s: c.signature.slice(2), // secp256k1 签名 (130 hex)
    signer: c.signerTronAddr, // 签名地址
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

  // 2. 注入 memo protobuf (field 12, wire type 2 = 0x62)
  const memoBytes = Buffer.from(memoStr, 'utf-8');
  const memoProto = Buffer.concat([
    Buffer.from([0x62]),
    Buffer.from([memoBytes.length]),
    memoBytes,
  ]);
  const rawBuf = Buffer.from(ct.raw_data_hex, 'hex');

  // 定位 timestamp 字段 (0x58) 结束位置
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
  for (let i = 0; i < contracts.length; i++) {
    const c = contracts[i];
    console.log(`\n[${i + 1}/${contracts.length}] 合同 ${c.id}: ${c.title.slice(0, 20)}...`);
    try {
      const { bcast, txID, memoLen } = await sendContract(c);
      if (bcast.result === true) {
        const txHash = bcast.txid || txID;
        console.log(`  ✅ 上链成功`);
        console.log(`  txID: ${txHash}`);
        console.log(`  Tronscan: https://tronscan.org/#/transaction/${txHash}`);
        console.log(`  memo: ${memoLen} bytes`);
        results.push({
          id: c.id,
          title: c.title,
          date: c.date,
          txID: txHash,
          url: `https://tronscan.org/#/transaction/${txHash}`,
          memoLen,
          msgHash: c.msgHash,
          signature: c.signature,
          signerTronAddr: c.signerTronAddr,
        });
      } else {
        console.log(`  ❌ 失败: ${JSON.stringify(bcast).substring(0, 300)}`);
        if (bcast.message) {
          try {
            console.log(`  decoded: ${Buffer.from(bcast.message, 'hex').toString('utf-8')}`);
          } catch (e) {}
        }
        results.push({ id: c.id, error: bcast });
      }
    } catch (e) {
      console.log(`  ❌ 异常: ${e.message}`);
      results.push({ id: c.id, error: e.message });
    }
    // 间隔 1.5 秒避免频率限制
    if (i < contracts.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  // 保存结果
  fs.writeFileSync(
    './assets/contract-anchor-result.json',
    JSON.stringify(results, null, 2),
  );

  const success = results.filter(r => r.txID).length;
  console.log('\n' + '='.repeat(60));
  console.log(`完成: ${success}/${contracts.length} 份合同已上链`);
  console.log('结果已保存到 ./assets/contract-anchor-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
