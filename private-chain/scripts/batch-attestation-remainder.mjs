// 重试剩余的受益人存证广播
import { TronWeb } from 'tronweb';

const SENDER_PRIV = '54f1337ee3587d817cd231ab106dbc8c406afdd6106dd942b7024f30b933afa1';

const remaining = [
  {
    name: '受益人-13913516336',
    address: 'THmuNGuu6XbEhnb3ZMewi2wHpiagzQH547',
    amount: '28,932.00 USDT',
    contractNo: 'PTAH-TR-2026-353464',
    receiptNo: 'PTAH-NOTARY-REC-202609-0005',
    caseNo: 'YXD-NOT202609162040583936',
  },
  {
    name: '杨必胜',
    address: 'TLz94yY3DP1PjJcJH6G2XajLLtriJnJqPi',
    amount: '63,023.31 USDT',
    contractNo: 'PTAH-TR-2026-459420',
    receiptNo: 'PTAH-NOTARY-REC-202609-0006',
    caseNo: 'YXD-NOT202609152025323390',
  },
  {
    name: '张建仁',
    address: 'TQTW7w6g3jmoHJdBfvAcRjq19hNZssE1GM',
    amount: '12,577.82 USDT',
    contractNo: 'PTAH-TR-2026-398313',
    receiptNo: 'PTAH-NOTARY-REC-202609-0007',
    caseNo: 'YXD-NOT202609131835402381',
  },
  {
    name: '杨春',
    address: 'TQaK2i9Ez32roCw4SkbKPD3rANf1zwrKAd',
    amount: '130,674.00 USDT',
    contractNo: 'PTAH-TR-2026-768463',
    receiptNo: 'PTAH-NOTARY-REC-202609-0008',
    caseNo: 'YXD-NOT202609152020224905',
  },
];

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: SENDER_PRIV,
});

const from = tronWeb.defaultAddress.base58;
const results = [];

for (let i = 0; i < remaining.length; i++) {
  const b = remaining[i];
  console.log(`\n[${i + 1}/${remaining.length}] ${b.name} → ${b.address}`);

  const memoObj = {
    title: `${b.name} 信托结算存证`,
    beneficiary: b.name,
    amount: b.amount,
    contractNo: b.contractNo,
    receiptNo: b.receiptNo,
    caseNo: b.caseNo,
    address: b.address,
    ts: Math.floor(Date.now() / 1000),
  };
  const memoStr = JSON.stringify(memoObj);

  try {
    const tx = await tronWeb.transactionBuilder.sendTrx(b.address, 1, from);
    const txWithMemo = await tronWeb.transactionBuilder.addUpdateData(tx, memoStr, 'utf8');
    const signed = await tronWeb.trx.sign(txWithMemo);
    const result = await tronWeb.trx.sendRawTransaction(signed);

    if (result.result === true || (result.txid && !result.code)) {
      console.log(`  ✅ 成功 txID: ${signed.txID}`);
      results.push({ name: b.name, status: 'success', txid: signed.txID });
    } else {
      let msg = result.message || '';
      if (msg && /^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
        try {
          const bytes = new Uint8Array(msg.match(/.{1,2}/g).map(h => parseInt(h, 16)));
          msg = new TextDecoder().decode(bytes);
        } catch (e) {}
      }
      console.log(`  ❌ 失败: ${result.code || ''} ${msg}`);
      results.push({ name: b.name, status: 'failed', error: `${result.code} ${msg}` });
      // 余额不足时停止后续
      if (result.code === 'CONTRACT_VALIDATE_ERROR') break;
    }
  } catch (e) {
    console.log(`  ❌ 异常: ${e.message}`);
    results.push({ name: b.name, status: 'error', error: e.message });
    break;
  }

  await new Promise(r => setTimeout(r, 2000));
}

console.log('\n--- 结果 ---');
for (const r of results) {
  console.log(`${r.status === 'success' ? '✅' : '❌'} ${r.name} ${r.txid || r.error}`);
}
