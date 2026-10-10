import { TronWeb } from 'tronweb';
import { keccak256 } from 'ethereumjs-util';
import { Buffer } from 'buffer';
import fs from 'fs';

const MAINNET_RPC = 'https://api.trongrid.io';
const SEND_ADDR   = 'TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ';
const SEND_KEY    = '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309';
const BURN_ADDR   = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const NILE_CONTRACT = 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq';

const tronWeb = new TronWeb({ fullHost: MAINNET_RPC, privateKey: SEND_KEY });

function keccak(hexStr) {
  const buf = Buffer.from(hexStr.replace('0x',''), 'hex');
  return '0x' + keccak256(buf).toString('hex');
}
function buildTree(hashes) {
  let level = [...hashes];
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length-1]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(keccak(level[i] + level[i+1].replace('0x','')));
    }
    level = next;
  }
  return level[0] || '0x0';
}

async function main() {
  console.log('='.repeat(60));
  console.log('1156 Nile USDT -> Mainnet Anchor (v2)');
  console.log('='.repeat(60));

  const txs = JSON.parse(fs.readFileSync('./assets/all-1156-txs.json'));
  console.log('Txs:', txs.length);

  const leaves = txs.map(t => keccak('0x' + Buffer.from(t.txID + '|' + t.amount_usdt + '|' + t.from + '|' + t.to).toString('hex')));
  const merkleRoot = buildTree(leaves);
  console.log('Merkle Root:', merkleRoot);

  const anchorMap = txs.map((t, i) => ({
    index: i, txID: t.txID,
    anchor_hash: keccak('0x' + Buffer.from(merkleRoot + '|' + i + '|' + t.txID).toString('hex')),
    from: t.from, to: t.to, amount: t.amount_usdt,
  }));

  const totalAmount = txs.reduce((s, t) => s + parseFloat(t.amount_usdt || 0), 0);
  const fromAddrs = new Set(txs.map(t => t.from));
  const toAddrs = new Set(txs.map(t => t.to));

  const memoObj = {
    a: 'usdt-1156-anchor', v: '2.0',
    n: 'TRON-MAINNET', s: 'TRON-NILE',
    c: NILE_CONTRACT, m: merkleRoot,
    t: txs.length, u: fromAddrs.size, r: toAddrs.size,
    amt: totalAmount.toFixed(2),
    samples: [0,100,300,500,700,900,1000,1100,1128,1155].filter(i=>i<txs.length).map(i=>({i,ah:anchorMap[i].anchor_hash.slice(2,18)})),
    ts: Math.floor(Date.now()/1000),
  };
  const memoStr = JSON.stringify(memoObj);
  const memoBytes = Buffer.from(memoStr, 'utf-8');
  console.log('Memo size:', memoBytes.length, 'bytes');
  console.log('Memo:', memoStr.substring(0, 200) + '...');

  // Build transfer tx using TronWeb low-level
  console.log('\nBuilding transfer tx...');
  const tx = await tronWeb.trx.buildTransferTransaction(BURN_ADDR, 1, SEND_ADDR);
  const rawBuf = Buffer.from(tx.raw_data_hex, 'hex');
  console.log('Original raw_data_hex length:', rawBuf.length, 'bytes');

  // Find timestamp field (tag 0x58) and insert memo after it
  // memo protobuf: tag 12 field, wire type 2 = 0x62
  const TIMESTAMP_TAG = 0x58;  // field 11, wire 0 (varint)
  const MEMO_TAG_BYTE = 0x62;  // field 12, wire 2 (length-delimited)
  
  let tsEnd = rawBuf.length;
  for (let i = rawBuf.length - 1; i >= 0; i--) {
    if (rawBuf[i] === TIMESTAMP_TAG) {
      let pos = i + 1;
      while (pos < rawBuf.length && (rawBuf[pos] & 0x80)) pos++;
      pos++;
      tsEnd = pos;
      console.log('Found timestamp at offset', i, 'value ends at', pos);
      break;
    }
  }

  // Build memo protobuf: tag + length (varint) + value
  const memoLenBytes = memoBytes.length < 128 
    ? Buffer.from([memoBytes.length])
    : (() => { let v = memoBytes.length; const b = []; while (v >= 0x80) { b.push((v & 0x7F) | 0x80); v >>= 7; } b.push(v); return Buffer.from(b); })();
  
  const memoProtobuf = Buffer.concat([Buffer.from([MEMO_TAG_BYTE]), memoLenBytes, memoBytes]);
  console.log('Memo protobuf size:', memoProtobuf.length, 'bytes');

  // Insert memo after timestamp
  const newRaw = Buffer.concat([rawBuf.slice(0, tsEnd), memoProtobuf, rawBuf.slice(tsEnd)]);
  const newRawHex = newRaw.toString('hex');
  console.log('New raw_data_hex length:', newRaw.length, 'bytes');

  tx.raw_data_hex = newRawHex;
  tx.raw_data = null;

  console.log('\nSigning...');
  const signed = await tronWeb.trx.sign(tx);

  console.log('Broadcasting...');
  const result = await tronWeb.trx.sendRawTransaction(signed);

  if (result && result.result === true) {
    const txHash = result.transaction ? result.transaction.id : (result.txID || '');
    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS!');
    console.log('='.repeat(60));
    console.log('Mainnet txID:', txHash);
    console.log('Tronscan:', 'https://tronscan.org/#/transaction/' + txHash);
    console.log('Merkle Root:', merkleRoot);
    console.log('Txs:', txs.length);
    console.log('Amount:', totalAmount.toFixed(2), 'USDT');

    const finalResult = {
      timestamp: new Date().toISOString(),
      version: 'v2',
      mainnetTxID: txHash,
      mainnetUrl: 'https://tronscan.org/#/transaction/' + txHash,
      merkleRoot,
      stats: {
        totalTxs: txs.length,
        totalAmountDisplay: totalAmount.toFixed(2),
        uniqueFrom: fromAddrs.size,
        uniqueTo: toAddrs.size,
      },
      anchorMap,
      memoSize: memoBytes.length,
    };
    fs.writeFileSync('./assets/anchor-result-v2.json', JSON.stringify(finalResult, null, 2));
    console.log('\nSaved to assets/anchor-result-v2.json');
  } else {
    console.log('FAILED:', JSON.stringify(result));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
