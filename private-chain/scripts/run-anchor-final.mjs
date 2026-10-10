import { TronWeb } from 'tronweb';
import { Buffer } from 'buffer';
import fs from 'fs';
import crypto from 'crypto';

const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });
const SEND_HEX = '41853164f135d68b65b7492fe29009bf0dc08b6311';
const BURN_HEX = '410000000000000000000000000000000000000000';
const PRIV_KEY = '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309';

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
console.log('Memo:', memoStr.length, 'bytes');

async function main() {
  const resp = await fetch('https://api.trongrid.io/wallet/createtransaction', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({owner_address: SEND_HEX, to_address: BURN_HEX, amount: 1})
  });
  const ct = await resp.json();
  if (ct.Error) { console.error(ct.Error); return; }
  console.log('[1] Built tx');

  // Inject memo protobuf after timestamp field
  const memoBytes = Buffer.from(memoStr, 'utf-8');
  const memoProto = Buffer.concat([Buffer.from([0x62]), Buffer.from([memoBytes.length]), memoBytes]);
  const rawBuf = Buffer.from(ct.raw_data_hex, 'hex');
  let tsEnd = rawBuf.length;
  for (let i = rawBuf.length - 1; i >= 0; i--) {
    if (rawBuf[i] === 0x58) { let pos = i+1; while (pos<rawBuf.length && (rawBuf[pos]&0x80)) pos++; pos++; tsEnd=pos; break; }
  }
  const finalRaw = Buffer.concat([rawBuf.slice(0, tsEnd), memoProto, rawBuf.slice(tsEnd)]);
  const finalRawHex = finalRaw.toString('hex');
  const txID = crypto.createHash('sha256').update(finalRaw).digest('hex');
  console.log('[2] Memo injected. New txID:', txID);

  const tx = {
    raw_data: { ...ct.raw_data, memo: memoStr },
    raw_data_hex: finalRawHex,
    txID: txID,
    visible: false,
  };

  // Sign using TronWeb's signTransaction (bypasses txCheck)
  console.log('[3] Signing...');
  const { signTransaction } = tw.utils.crypto;
  const signed = signTransaction(PRIV_KEY, tx);
  console.log('    Signed OK');

  // Broadcast
  console.log('[4] Broadcasting...');
  const bcastResp = await fetch('https://api.trongrid.io/wallet/broadcasttransaction', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(signed)
  });
  const bcast = await bcastResp.json();
  
  if (bcast.result === true) {
    const txHash = bcast.txid || txID;
    console.log('\n' + '='.repeat(60));
    console.log('🎉  SUCCESS! txID:', txHash);
    console.log('='.repeat(60));
    console.log('Tronscan: https://tronscan.org/#/transaction/' + txHash);
    anchor.mainnetTxID = txHash;
    anchor.mainnetUrl = 'https://tronscan.org/#/transaction/' + txHash;
    anchor.version = 'v3-with-memo';
    fs.writeFileSync('./assets/anchor-result-v2.json', JSON.stringify(anchor, null, 2));
    console.log('✅ Saved anchor-result-v2.json');
  } else {
    console.error('❌ Failed:', JSON.stringify(bcast).substring(0, 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
