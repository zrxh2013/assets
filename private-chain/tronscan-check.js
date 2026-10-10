const https = require('https');
const fs = require('fs');

const TX_V1 = '6b908ecab00ef6a6f4c7e2dd3b0a0bdaea45290d1709793aa6b84bf8683942fa';
const TX_V2 = 'ce8bb24bd2dde5ff8869b7e9dd4d97307d377217bca7ecbb66ac2c68864fabe1';
const TX_SAMPLE = '4de63deb65aacd521f7a78e96c9dde9183c0bf50fb03b5de475b2a54f43abaaa'; // 单笔转账样例

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', ...(headers||{}) },
      timeout: 20000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('timeout', () => { req.destroy(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}

async function checkTx(txid, label, isNile=true) {
  const host = isNile ? 'nileapi.tronscan.org' : 'apilist.tronscanapi.com';
  const scanUrl = isNile ? `https://nile.tronscan.org/#/transaction/${txid}` : `https://tronscan.org/#/transaction/${txid}`;
  const net = isNile ? 'NILE' : 'MAIN';
  console.log('');
  console.log('═'.repeat(78));
  console.log(`🔍 [${net}] ${label}`);
  console.log(`   txID:    ${txid}`);
  console.log(`   浏览器:  ${scanUrl}`);
  console.log('─'.repeat(78));

  // 方式A: Tronscan REST API transaction-info
  let results = [];
  for (const [endpoint, path, tag] of [
    [host, `/api/transaction-info?hash=${txid}`, 'A. Tronscan /api/transaction-info'],
    [host, `/api/contract/transaction?hash=${txid}`, 'B. Tronscan /api/contract/transaction'],
  ]) {
    try {
      const r = await get(`https://${endpoint}${path}`);
      let parsed = null;
      try { parsed = JSON.parse(r.body || '{}'); } catch {}
      const size = (r.body||'').length;
      let status = `HTTP ${r.status}  size=${size}B`;
      if (parsed && typeof parsed === 'object') {
        const bn = parsed.blockNumber;
        if (bn !== undefined && bn !== null) {
          status += `  block=#{bn}`.replace('{bn}', (bn).toLocaleString());
          if (parsed.receipt?.result) status += `  receipt=${parsed.receipt.result}`;
          if (parsed.net_fee !== undefined) status += `  fee=${(parsed.net_fee/1e6).toFixed(4)}TRX`;
          if (parsed.contractData?.amount !== undefined) status += `  amount=${(parsed.contractData.amount/1e6).toFixed(2)}TRX`;
          if (parsed.transfers?.[0]?.amount_str) status += `  TRC20=${parsed.transfers[0].amount_str/1e6}(${parsed.transfers[0].contractType})`;
          // try memo
          if (parsed.raw_data?.data) {
            try {
              const memo = Buffer.from(parsed.raw_data.data, 'hex').toString('utf8');
              status += `  memo=${memo.length}B` + (memo.startsWith('{')?'[JSON]':'');
            } catch {}
          }
          if (parsed.data) {
            try {
              const memo = Buffer.from(parsed.data, 'hex').toString('utf8');
              status += `  memo=${memo.length}B` + (memo.startsWith('{')?'[JSON]':'');
            } catch {}
          }
        }
      }
      console.log(`   ${tag.padEnd(46,' ')} → ${status}`);
      results.push({tag, ok: r.status===200 && parsed && parsed.blockNumber!==undefined, parsed});
    } catch(e) {
      console.log(`   ${tag.padEnd(46,' ')} → ❌ ${e.message}`);
    }
  }

  // 方式C: TronWeb fullNode RPC (getTransaction + getTransactionInfo)
  try {
    const TronWeb = require('tronweb').TronWeb;
    const fullHost = isNile ? 'https://api.nileex.io' : 'https://api.trongrid.io';
    const tw = new TronWeb({ fullHost, privateKey:'0'.repeat(64) });
    const [tx, info] = await Promise.all([tw.trx.getTransaction(txid), tw.trx.getTransactionInfo(txid)]);
    let line = `C. fullNode ${isNile?'nileex.io':'trongrid.io'}  `.padEnd(46,' ') + ` → txID ${tx.txID?'✅':'❌'}`;
    const bn = info.blockNumber || tx.blockNumber;
    if (bn !== undefined) {
      line += `  block=#{bn}`.replace('{bn}', bn.toLocaleString());
      if (info.receipt?.result) line += `  receipt=${info.receipt.result}`;
      line += `  fee=${((info.fee||info.net_fee||0)/1e6).toFixed(4)}TRX`;
      // memo
      const dataHex = (tx.raw_data && tx.raw_data.data) || (info.raw_data && info.raw_data.data);
      if (dataHex) {
        try { const memo = Buffer.from(dataHex,'hex').toString('utf8'); line += `  memo=${memo.length}B`+(memo.startsWith('{')?'[JSON]':''); } catch{}
      }
      // amount (TX 类型: transferContract = contractType 1)
      const ctype = (tx.raw_data && tx.raw_data.contract && tx.raw_data.contract[0] && tx.raw_data.contract[0].type) || '';
      const param = tx.raw_data?.contract?.[0]?.parameter?.value || {};
      if (param.amount !== undefined) line += `  TRX=${(param.amount/1e6).toFixed(2)}`;
      console.log(line);
      results.push({tag:'C.fullNode', ok:true, parsed:{tx,info}});
    } else {
      line += '  ⏳ pending';
      console.log(line);
    }
  } catch(e) {
    console.log(`   C. fullNode ${isNile?'nileex.io':'trongrid.io'}  `.padEnd(46,' ') + ` → ❌ ${e.message}`);
  }

  // 汇总
  const anyOk = results.some(r => r.ok);
  console.log(`   ╰→ Tronscan 可查: ${anyOk ? '✅ 是' : (results.some(r=>r.parsed && r.parsed.txID!==undefined)? '⏳ pending 中' : '❌ 暂不可查 (404/节点未同步)')}`);
  return anyOk;
}

(async () => {
  console.log('🧭 三重独立路径验证锚定哈希在 Tronscan 的可查性：');
  console.log('   A. nileapi.tronscan.org /api/transaction-info  (Tronscan 官方 index API)');
  console.log('   B. nileapi.tronscan.org /api/contract/transaction  (备用路由)');
  console.log('   C. api.nileex.io fullNode RPC  getTransactionInfo  (TRON 全节点)');
  await checkTx(TX_V1, 'V1 批量锚定 (原始版 / 仅累计金额)');
  await checkTx(TX_V2, 'V2 批量锚定 (修正版 / totalSupply+净流出+TOP10)');
  await checkTx(TX_SAMPLE, '单笔真实 USDT 转账 (第1笔 / 81,885.45 USDT)');
  console.log('');
  console.log('═══ 最终报告 ═══');
  console.log('只要上表中任一 ✅ 成立 → Tronscan 上输入该哈希即可查到完整交易。');
  console.log('如需我演示：打开 tronscan.org 的具体页面截图/抓取 HTML，回复「演示打开 V2」我继续。');
})();
