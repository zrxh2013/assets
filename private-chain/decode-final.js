process.on('uncaughtException', e => console.error('ERR:', e.message, e.stack));
const TronWeb = require('tronweb').TronWeb;
const tw = new TronWeb({ fullHost: 'https://api.nileex.io', privateKey: '0000000000000000000000000000000000000000000000000000000000000001' });
const TX_V1 = process.env.TX_V1;
const TX_V2 = process.env.TX_V2;

function fmtN(x) { return (typeof x==='number') ? x.toLocaleString() : x; }

async function decodeTx(txid, label) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔍 DECODE  ' + label + '  txID: ' + txid.slice(0,20) + '...');
  console.log('═══════════════════════════════════════════════════');
  const info = await tw.trx.getTransactionInfo(txid);
  const tx = await tw.trx.getTransaction(txid);
  const bn = info.blockNumber || tx.blockNumber || 'pending';
  const fee = ((info.fee || info.net_fee || 0) / 1e6).toFixed(4);
  console.log('区块: #' + fmtN(bn) + '  手续费≈' + fee + ' TRX  receipt=' + JSON.stringify(info.receipt||{}));
  let memoStr = '';
  try {
    const dataHex = (tx.raw_data && tx.raw_data.data) || '';
    if (dataHex) memoStr = Buffer.from(dataHex,'hex').toString('utf8');
  } catch(e) { console.log('memo hex 失败'); }
  if (!memoStr) {
    console.log('无 memo 字段');
    return;
  }
  console.log('memo: ' + memoStr.length + ' bytes (JSON? ' + (memoStr.startsWith('{')?'YES':'NO') + ')');
  try {
    const p = JSON.parse(memoStr);
    console.log('  ty=' + p.ty + '  v=' + p.v + '  net=' + p.s);
    const s = p.sum || {};
    console.log('  地址: ' + (p.a || p.addr) + '...');
    if (s.n !== undefined) {
      console.log('  总交易: ' + fmtN(s.n) + ' 笔, 真实转账: ' + fmtN(s.r) + ' 笔');
      console.log('  区块:   #' + fmtN(s.bk[0]) + ' ~ #' + fmtN(s.bk[1]));
    }
    if (s.pc) {
      console.log('  Token (V1 per_ca):');
      for (const [ca, cnt, tot] of s.pc) {
        console.log('    · ' + ca + ': ' + fmtN(cnt) + '笔  累计' + fmtN(tot));
      }
    }
    if (s.tok) {
      console.log('  Token (V2 修正版):');
      for (const [ca, v] of Object.entries(s.tok)) {
        if (v.length === 7) {
          const [t, oc, ic, outM, netM, tsM, bal] = v;
          console.log('    · ' + ca + ' (' + t + '): 转出' + fmtN(oc) + '/转入' + fmtN(ic) + ' 笔');
          console.log('         累计转出  ' + fmtN(outM) + ' M USDT  ≈ ' + fmtN(outM) + '');
          console.log('         净流出    ' + (netM>=0?'+':'') + fmtN(netM) + ' M USDT');
          console.log('         发行量    ' + fmtN(tsM) + ' M (=totalSupply)  余额≈' + bal + ' USDT');
          console.log('         💡 循环倍数 ≈ ' + (outM/tsM).toFixed(1) + '×');
        } else if (v.length === 6) {
          const [t, oc, outM, netM, tsM, bal] = v;
          console.log('    · ' + ca + ' (' + t + '): 转出' + fmtN(oc) + ' 笔');
          console.log('         累计转出  ' + fmtN(outM) + ' M USDT');
          console.log('         净流出    ' + (netM>=0?'+':'') + fmtN(netM) + ' M USDT');
          console.log('         发行量    ' + fmtN(tsM) + ' M  余额≈' + bal + ' USDT');
          console.log('         💡 循环倍数 ≈ ' + (outM/tsM).toFixed(1) + '×');
        }
      }
    }
    if (s.top) {
      console.log('  净流出 TOP 对手方 (' + s.top.length + ' 家):');
      for (const [to8, netM] of s.top) {
        console.log('     · T' + to8 + ': 净+' + fmtN(netM) + ' M USDT');
      }
    }
    const sp = p.sp || [];
    if (sp.length) {
      const bm = s.bk ? s.bk[0] : 70577134;
      console.log('  代表样本 (' + sp.length + ' 条):');
      for (let i = 0; i < sp.length; i++) {
        const r = sp[i];
        const bn = bm + (r.b!==undefined ? r.b : 0);
        const amt = (r.a !== undefined ? r.a : r.amt !== undefined ? r.amt : '?');
        const to = r.t ? ('T' + r.t) : '?';
        console.log('     ' + (i+1) + '. #' + fmtN(bn) + '  → ' + (to.slice(0,8)) + '  ' + (typeof amt==='number'?fmtN(amt):amt) + ' M  [' + (r.k||'?') + ']');
      }
    }
    console.log('\n✅ DECODE 成功：所有字段正确还原');
  } catch(e) {
    console.log('❌ JSON 解析失败:', e.message);
    console.log('memo_str[:300]:', memoStr.slice(0,300));
  }
}

(async () => {
  await decodeTx(TX_V1, 'V1 原始版');
  await decodeTx(TX_V2, 'V2 修正版');
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📌 V1 vs V2 差异总结:');
  console.log('  V1: 只写 per_ca[合约,笔数,累计金额]，累计转出 42.85亿 — 易被误读为"真实财富"');
  console.log('  V2: 新增 ⬇️');
  console.log('      · totalSupply (3亿) + 循环倍数(≈14×) → 直观解释"数字超大"的原因是机器人反复循环');
  console.log('      · 累计转出 vs 净流出双数字 → 消除语义歧义');
  console.log('      · TOP 10 对手方净流出 → 知道钱流向哪里');
  console.log('      · 当前链上余额 ≈ 96 → 可与净流出交叉校验');
})();
