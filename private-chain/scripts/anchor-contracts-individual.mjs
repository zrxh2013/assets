/**
 * anchor-contracts-individual.mjs — 每份合同单独上链存证
 * 使用 TronWeb TransactionBuilder 构造带 memo 的交易
 */

import { TronWeb } from 'tronweb';
import fs from 'fs';

const tw = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: '54f1337ee3587d817cd231ab106dbc8c406afdd6106dd942b7024f30b933afa1',
});

const BURN_ADDR = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

const contracts = JSON.parse(fs.readFileSync('./assets/trust-signatures.json', 'utf-8'));

// 读取已有结果，跳过已上链的合同（断点续传）
const RESULT_FILE = './assets/contract-anchor-result.json';
let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf-8'));
} catch (e) {}
const doneIds = new Set(existing.filter(r => r.txID).map(r => r.id));
console.log(`共 ${contracts.length} 份合同，已上链 ${doneIds.size} 份，待上链 ${contracts.length - doneIds.size} 份`);
console.log('-'.repeat(60));

const results = existing.filter(r => r.txID);

async function sendContract(c) {
  const memoStr = JSON.stringify({
    ty: 'PTAH-CONTRACT',
    v: 1,
    id: c.id,
    title: c.title,
    date: c.date,
    h: c.msgHash.slice(2),
    s: c.signature.slice(2),
    signer: c.signerTronAddr,
    ts: Math.floor(Date.now() / 1000),
  });

  // TronWeb 6.5.0: sendTrx 的 data 选项无效，必须用 addUpdateData 设置 memo
  const tx = await tw.transactionBuilder.sendTrx(BURN_ADDR, 1);
  const txWithMemo = await tw.transactionBuilder.addUpdateData(tx, memoStr, 'utf8');

  // 签名
  const signed = await tw.trx.sign(txWithMemo);

  // 广播
  const result = await tw.trx.sendRawTransaction(signed);

  return { result, memoLen: memoStr.length };
}

function saveResults() {
  fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
}

async function main() {
  const pending = contracts.filter(c => !doneIds.has(c.id));
  for (let i = 0; i < pending.length; i++) {
    const c = pending[i];
    console.log(`\n[${i + 1}/${pending.length}] 合同 ${c.id}: ${c.title.slice(0, 20)}...`);
    try {
      const { result, memoLen } = await sendContract(c);
      if (result.result === true || result.success) {
        const txHash = result.txid || result.txID;
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
        saveResults();
      } else {
        console.log(`  ❌ 失败: ${JSON.stringify(result).substring(0, 200)}`);
        if (result.message) {
          try {
            console.log(`  decoded: ${Buffer.from(result.message, 'hex').toString('utf-8')}`);
          } catch (e) {}
        }
        // 失败时停止，等待用户充值后重试
        console.log('\n⛔ 交易失败，停止后续操作。请充值后重新运行本脚本。');
        saveResults();
        return;
      }
    } catch (e) {
      console.log(`  ❌ 异常: ${e.message}`);
      console.log('\n⛔ 发生异常，停止后续操作。');
      saveResults();
      return;
    }
    if (i < pending.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  const success = results.filter(r => r.txID).length;
  console.log('\n' + '='.repeat(60));
  console.log(`完成: ${success}/${contracts.length} 份合同已上链`);
  console.log('结果已保存到 ./assets/contract-anchor-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
