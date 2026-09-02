const { TronWeb } = require('tronweb');
const fs = require('fs');

const PRIV = '63d9de16c88d7a840beb55175946f9f62f5a62d1d3dc9b6df7b0962512dd80e3';

const TARGET = 'TYSfgUcvATDNhqkQ2aPC5eGNo4X2c89epx';
const SENDER = 'TF65UqeFNN5YN75GeDfs9Nfc7LekL8eik9';
const tw = new TronWeb({ fullHost: 'https://nile.trongrid.io' });

let initBal = 0;
let tries = 0;

function fmt(n, d) { return n.toFixed(d); }
function pad(s, n) { return String(s).padStart(n); }

async function poll() {
  tries++;
  try {
    const a = await tw.trx.getAccount(SENDER);
    const bal = (a.balance || 0) / 1e6;
    if (tries === 1) { initBal = bal; console.log('TB7m 初始余额: ' + fmt(bal,2) + ' TRX  (开始监控...)'); }
    const delta = bal - initBal;
    const sign = delta >= 0 ? '+' : '';
    console.log('  [' + pad(tries*6, 3) + 's] TB7m 余额: ' + fmt(bal,2) + ' TRX  delta ' + sign + fmt(delta,2));

    if (delta >= 999) {
      console.log('\n水龙头到账! +' + fmt(delta,2) + ' TRX -> TB7m 当前 ' + fmt(bal,2) + ' TRX');
      console.log('\n开始自动转账 1000 TRX -> ' + TARGET);

      const twSend = new TronWeb({ fullHost: 'https://nile.trongrid.io', privateKey: PRIV });
      const tx = await twSend.trx.sendTransaction(TARGET, 1000 * 1e6);

      if (tx.result) {
        const txID = tx.txid || tx.transaction?.txID;
        console.log('\n转账成功!');
        console.log('  txID: ' + txID);
        console.log('  From: ' + SENDER);
        console.log('  To:   ' + TARGET);
        console.log('  Amount: 1000 TRX');
        console.log('\n等待区块确认 (约 6 秒)...');

        await new Promise(r => setTimeout(r, 6000));

        const info = await twSend.trx.getTransactionInfo(txID);
        const bn = info.blockNumber;
        const fee = (info.fee || 0) / 1e6;
        console.log('\n链上验证:');
        console.log('  Block: #' + bn);
        console.log('  Fee: ' + fmt(fee,6) + ' TRX');
        console.log('  Receipt: ' + (info.receipt?.result || 'pending'));

        const tgtAcct = await tw.trx.getAccount(TARGET);
        const tgtBal = (tgtAcct.balance || 0) / 1e6;
        console.log('\nTYSfgUcv 最终余额: ' + fmt(tgtBal,2) + ' TRX');
        console.log('\nTronscan: https://nile.tronscan.org/#/transaction/' + txID);

        fs.writeFileSync('/tmp/transfer-result.json', JSON.stringify({
          txID, from: SENDER, to: TARGET, amount: 1000, block: bn, fee,
          targetBalance: tgtBal, timestamp: new Date().toISOString()
        }, null, 2));
      } else {
        console.error('转账失败:', JSON.stringify(tx));
      }
      process.exit(0);
    }
  } catch(e) {
    console.log('  [' + pad(tries*6, 3) + 's] 查询失败: ' + e.message.slice(0,80));
  }
  setTimeout(poll, 6000);
}

poll();
