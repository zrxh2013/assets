import { TronWeb } from 'tronweb';
import { Buffer } from 'buffer';
import fs from 'fs';

const tw = new TronWeb({ 
  fullHost: 'https://api.trongrid.io', 
  privateKey: '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309' 
});

const SEND_ADDR = 'TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ';
const BURN_ADDR = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const sendHex = tw.address.toHex(SEND_ADDR);
const burnHex = tw.address.toHex(BURN_ADDR);
console.log('SEND hex:', sendHex);

// Memo
const anchor = JSON.parse(fs.readFileSync('./assets/anchor-result-v2.json'));
const anchorMap = anchor.anchorMap;
const memoObj = {
  a: 'usdt-1156-anchor', v: '2.0',
  n: 'TRON-MAINNET', s: 'TRON-NILE',
  c: 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq',
  m: anchor.merkleRoot,
  t: 1156, u: 2, r: 247,
  amt: '599999904.27',
  samples: [
    {i:0, ah:anchorMap[0].anchor_hash.slice(2,18)},
    {i:500, ah:anchorMap[499].anchor_hash.slice(2,18)},
    {i:1155, ah:anchorMap[anchorMap.length-1].anchor_hash.slice(2,18)},
  ],
  ts: Math.floor(Date.now()/1000),
};
const memoStr = JSON.stringify(memoObj);
console.log('Memo (' + memoStr.length + ' chars)');

async function main() {
  console.log('\n[1] Build tx...');
  const resp = await fetch('https://api.trongrid.io/wallet/createtransaction', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({owner_address: sendHex, to_address: burnHex, amount: 1})
  });
  const ct = await resp.json();
  if (ct.Error) { console.error('❌', ct.Error); return; }
  const rawHex = ct.raw_data_hex;
  console.log('    raw_data_hex:', rawHex.length, 'chars');

  console.log('\n[2] Inject memo protobuf...');
  const memoBytes = Buffer.from(memoStr, 'utf-8');
  const memoProto = Buffer.concat([Buffer.from([0x62]), Buffer.from([memoBytes.length]), memoBytes]);
  const rawBuf = Buffer.from(rawHex, 'hex');
  
  let tsEnd = rawBuf.length;
  for (let i = rawBuf.length - 1; i >= 0; i--) {
    if (rawBuf[i] === 0x58) {
      let pos = i + 1;
      while (pos < rawBuf.length && (rawBuf[pos] & 0x80)) pos++;
      pos++; tsEnd = pos; break;
    }
  }
  const newRawHex = Buffer.concat([rawBuf.slice(0, tsEnd), memoProto, rawBuf.slice(tsEnd)]).toString('hex');
  console.log('    New raw_data_hex:', newRawHex.length, 'chars');

  console.log('\n[3] Sign + Broadcast...');
  const tx = { raw_data_hex: newRawHex, raw_data: ct.raw_data, txID: '', visible: false };
  if (tx.raw_data) tx.raw_data.memo = memoStr;
  
  const signed = await tw.trx.sign(tx);
  const result = await tw.trx.sendRawTransaction(signed);
  
  if (result && result.result === true) {
    const txHash = result.transaction ? result.transaction.id : '';
    console.log('\n' + '='.repeat(60));
    console.log('🎉  SUCCESS! txID:', txHash);
    console.log('='.repeat(60));
    console.log('Tronscan: https://tronscan.org/#/transaction/' + txHash);
    anchor.mainnetTxID = txHash;
    anchor.mainnetUrl = 'https://tronscan.org/#/transaction/' + txHash;
    anchor.version = 'v3-with-memo';
    fs.writeFileSync('./assets/anchor-result-v2.json', JSON.stringify(anchor, null, 2));
    console.log('✅ Saved');
  } else {
    console.error('❌ Failed:', JSON.stringify(result).substring(0, 300));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
