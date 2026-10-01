// 批量存证广播脚本 - 根据公证送达回执单为每个受益人创建链上存证记录
import { TronWeb } from 'tronweb';

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SENDER_PRIV = '54f1337ee3587d817cd231ab106dbc8c406afdd6106dd942b7024f30b933afa1';

// 从公证送达回执单解析的受益人记录
const beneficiaries = [
  {
    name: '杨王兴',
    address: 'TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv',
    amount: '87,455.20 USDT',
    contractNo: 'PTAH-TR-2026-295205',
    receiptNo: 'PTAH-NOTARY-REC-202609-0001',
    caseNo: 'YXD-NOT202609131946421502',
  },
  {
    name: '受益人-0002',
    address: 'TTEQktFXNvQeFFqGbALhHHTtUVqieanDqz',
    amount: '89,540.00 USDT',
    contractNo: 'PTAH-TR-2026-UNKNOWN-0002',
    receiptNo: 'PTAH-NOTARY-REC-202609-0002',
    caseNo: 'YXD-NOT202609171127360889',
  },
  {
    name: '刘玉珍',
    address: 'TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG',
    amount: '92,831.00 USDT',
    contractNo: 'PTAH-TR-2026-206422',
    receiptNo: 'PTAH-NOTARY-REC-202609-0003',
    caseNo: 'YXD-NOT202609171452074484',
  },
  {
    name: '蔡金木',
    address: 'TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3',
    amount: '35,880.00 USDT',
    contractNo: 'PTAH-TR-2026-669733',
    receiptNo: 'PTAH-NOTARY-REC-202609-0004',
    caseNo: 'YXD-NOT202609131952121139',
  },
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
console.log(`发送方: ${from}`);
console.log(`受益人数量: ${beneficiaries.length}`);
console.log('='.repeat(70));

const results = [];

for (let i = 0; i < beneficiaries.length; i++) {
  const b = beneficiaries[i];
  console.log(`\n[${i + 1}/${beneficiaries.length}] ${b.name} → ${b.address}`);
  console.log(`  结算金额: ${b.amount}`);
  console.log(`  合同编号: ${b.contractNo}`);
  console.log(`  回执单号: ${b.receiptNo}`);

  // 构造 memo - 标题自动匹配受益人姓名
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
    // 构建 1 SUN TRX 转账 + memo 存证
    const tx = await tronWeb.transactionBuilder.sendTrx(b.address, 1, from);
    const txWithMemo = await tronWeb.transactionBuilder.addUpdateData(tx, memoStr, 'utf8');
    const signed = await tronWeb.trx.sign(txWithMemo);
    const result = await tronWeb.trx.sendRawTransaction(signed);

    if (result.result === true || (result.txid && !result.code)) {
      const txid = signed.txID;
      console.log(`  ✅ 广播成功 txID: ${txid}`);
      results.push({ ...b, txid, status: 'success' });
    } else {
      let msg = result.message || JSON.stringify(result);
      if (msg && /^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
        try {
          const bytes = new Uint8Array(msg.match(/.{1,2}/g).map(h => parseInt(h, 16)));
          msg = new TextDecoder().decode(bytes);
        } catch (e) {}
      }
      console.log(`  ❌ 广播失败: ${result.code || ''} ${msg}`);
      results.push({ ...b, status: 'failed', error: `${result.code} ${msg}` });
    }
  } catch (e) {
    console.log(`  ❌ 异常: ${e.message}`);
    results.push({ ...b, status: 'error', error: e.message });
  }

  // 间隔避免频率限制
  if (i < beneficiaries.length - 1) {
    await new Promise(r => setTimeout(r, 1000));
  }
}

console.log('\n' + '='.repeat(70));
console.log('批量存证广播结果汇总:');
console.log('-'.repeat(70));
let success = 0, failed = 0;
for (const r of results) {
  const icon = r.status === 'success' ? '✅' : '❌';
  console.log(`${icon} ${r.name} | ${r.amount} | ${r.address}`);
  if (r.status === 'success') {
    console.log(`   txID: ${r.txid}`);
    success++;
  } else {
    console.log(`   错误: ${r.error}`);
    failed++;
  }
}
console.log('-'.repeat(70));
console.log(`总计: ${results.length} 条 | 成功: ${success} | 失败: ${failed}`);
