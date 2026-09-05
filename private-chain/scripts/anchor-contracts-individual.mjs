/**
 * anchor-contracts-individual.mjs — 每份合同单独上链存证
 * 使用 TronWeb TransactionBuilder 构造带 memo 的交易
 */

import { TronWeb } from 'tronweb';
import fs from 'fs';

const tw = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309',
});

const BURN_ADDR = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

const contracts = JSON.parse(fs.readFileSync('./assets/trust-signatures.json', 'utf-8'));

console.log(`共 ${contracts.length} 份合同，每份单独上链`);
console.log('-'.repeat(60));

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

  const memoHex = Buffer.from(memoStr, 'utf-8').toString('hex');

  // 用 TransactionBuilder 构造带 data=memo 的交易
  const tx = await tw.transactionBuilder.sendTrx(
    BURN_ADDR,
    1,
    undefined,
    { data: memoHex },
  );

  // 签名
  const signed = await tw.trx.sign(tx);

  // 广播
  const result = await tw.trx.sendRawTransaction(signed);

  return { result, memoLen: memoStr.length };
}

async function main() {
  const results = [];
  for (let i = 0; i < contracts.length; i++) {
    const c = contracts[i];
    console.log(`\n[${i + 1}/${contracts.length}] 合同 ${c.id}: ${c.title.slice(0, 20)}...`);
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
      } else {
        console.log(`  ❌ 失败: ${JSON.stringify(result).substring(0, 300)}`);
        if (result.message) {
          try {
            console.log(`  decoded: ${Buffer.from(result.message, 'hex').toString('utf-8')}`);
          } catch (e) {}
        }
        results.push({ id: c.id, error: result });
      }
    } catch (e) {
      console.log(`  ❌ 异常: ${e.message}`);
      results.push({ id: c.id, error: e.message });
    }
    if (i < contracts.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

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
