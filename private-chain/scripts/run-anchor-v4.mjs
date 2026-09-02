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
  // 1. createtransaction
  const resp = await fetch('https://api.trongrid.io/wallet/createtransaction', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({owner_address: sendHex, to_address: burnHex, amount: 1})
  });
  const ct = await resp.json();
  if (ct.Error) { console.error(ct.Error); return; }
  console.log('[1] Built tx, raw_data_hex:', ct.raw_data_hex.length, 'chars');

  // 2. Inject memo protobuf
  const memoBytes = Buffer.from(memoStr, 'utf-8');
  const memoProto = Buffer.concat([Buffer.from([0x62]), Buffer.from([memoBytes.length]), memoBytes]);
  const rawBuf = Buffer.from(ct.raw_data_hex, 'hex');
  let tsEnd = rawBuf.length;
  for (let i = rawBuf.length - 1; i >= 0; i--) {
    if (rawBuf[i] === 0x58) {
      let pos = i + 1;
      while (pos < rawBuf.length && (rawBuf[pos] & 0x80)) pos++;
      pos++; tsEnd = pos; break;
    }
  }
  const newRawHex = Buffer.concat([rawBuf.slice(0, tsEnd), memoProto, rawBuf.slice(tsEnd)]).toString('hex');
  console.log('[2] Injected memo, new raw:', newRawHex.length, 'chars');

  // 3. Update raw_data JSON to match protobuf (add memo field)
  const rawJson = ct.raw_data;
  rawJson.memo = memoStr;  // TronWeb expects memo in raw_data
  
  // Also need to fix ref_block_bytes (should be hex string with 0x prefix)
  // TronGrid returns it without 0x sometimes
  
  const txForSign = {
    raw_data_hex: newRawHex,
    raw_data: rawJson,
    txID: ct.txID,  // Use original txID or empty
    visible: false,
  };

  console.log('[3] Signing...');
  // Use tw.trx.sign but override with our raw_data_hex
  const signed = await tw.trx.sign(txForSign);
  console.log('    Signed, txID:', signed.transaction?.id?.substring(0, 20) + '...');

  // 4. Broadcast
  console.log('[4] Broadcasting...');
  const bcastResp = await fetch('https://api.trongrid.io/wallet/broadcasttransaction', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(signed)
  });
  const bcast = await bcastResp.json();
  console.log('    Result:', JSON.stringify(bcast).substring(0, 200));
  
  if (bcast.result === true) {
    const txHash = bcast.txid || bcast.transaction?.id || '';
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
    console.error('❌ Failed:', bcast.message || bcast.Error);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
