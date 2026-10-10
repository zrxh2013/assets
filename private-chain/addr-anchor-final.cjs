const { TronWeb } = require('tronweb');
const crypto = require('crypto');
const fs = require('fs');

const MAIN_PRIV = '54f1337ee3587d817cd231ab106dbc8c406afdd6106dd942b7024f30b933afa1';
const twMain = new TronWeb({ fullHost: 'https://api.trongrid.io', privateKey: MAIN_PRIV });

console.log('╔══════════════════════════════════════════════════╗');
console.log('║   主网地址余额锚定 · 最终广播                   ║');
console.log('╚══════════════════════════════════════════════════╝\n');

const NILE_DATA = {
  contract: "TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq",
  blockRange: "#70577134~#70585621",
  totalTxs: 1157,
  txMerkleRoot: "42c2d6fde018032cc20cb71954a03b1e3265d0cc27b3f7d2f209bf4bce28ac4c",
  totalUSDT: "4285054031460",
  addrs: [
    { a: "TYSfgUcvATDNhqkQ2aPC5eGNo4X2c89epx", b: 4285054031460 },
    { a: "TFrnsSckPje2PKxhzP1F5CV3M69xTj4Ep4", b: -4285054031460 }
  ]
};

let leaves = NILE_DATA.addrs.map(x => crypto.createHash('sha256').update(x.a + ':' + x.b).digest());
while (leaves.length > 1) {
  const nxt = [];
  for (let i = 0; i < leaves.length; i += 2) {
    nxt.push(crypto.createHash('sha256').update(Buffer.concat([leaves[i], leaves[i+1] || leaves[i]])).digest());
  }
  leaves = nxt;
}
const ADDR_ROOT = leaves[0].toString('hex');
const MINI = NILE_DATA.addrs.map(x => ({ p: x.a.slice(0,10), s: x.a.slice(-4), b: x.b }));

const memo = JSON.stringify({
  a: "nile-addr-balance-anchor", v: "1.0", chain: "TRON-MAINNET", srcChain: "TRON-NILE",
  src: { contract: NILE_DATA.contract, blockRange: NILE_DATA.blockRange, totalTRC20: NILE_DATA.totalTxs },
  merkle: { txRoot: NILE_DATA.txMerkleRoot, addrRoot: ADDR_ROOT },
  stats: { totalTxs: NILE_DATA.totalTxs, uniqueAddrs: NILE_DATA.addrs.length, totalUSDT: NILE_DATA.totalUSDT },
  addrs: MINI, ts: Date.now()
});

console.log('📝 Memo:', Buffer.from(memo).length, '字节 | txRoot:', NILE_DATA.txMerkleRoot.slice(0,32) + '...');

(async () => {
  const fromAddr = twMain.address.fromPrivateKey(MAIN_PRIV);
  const acc = twMain.utils.accounts.generateAccount();
  const assetAddr = twMain.address.fromPrivateKey(acc.privateKey);

  console.log('\n🚀 广播主网...');
  console.log('   From:', fromAddr);
  console.log('   To  :', assetAddr, '(资产持有人)');

  const unSignedTx = await twMain.transactionBuilder.sendTrx(assetAddr, 500000, fromAddr);
  unSignedTx.raw_data.data = Buffer.from(memo, 'utf8').toString('hex');
  const util = twMain.utils.transaction;
  const pb = util.txJsonToPb(unSignedTx);
  unSignedTx.txID = util.txPbToTxID(pb).replace(/^0x/, '');
  unSignedTx.raw_data_hex = util.txPbToRawDataHex(pb).toLowerCase();

  const signed = await twMain.trx.sign(unSignedTx, MAIN_PRIV);
  const result = await twMain.trx.sendRawTransaction(signed);

  if (result.result) {
    const txID = signed.txID;
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  🎉🎉🎉 主网地址余额锚定成功! 🎉🎉🎉            ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║ txID  : ' + txID);
    console.log('║ asset : ' + assetAddr);
    console.log('║ priv  : ' + acc.privateKey);
    console.log('║ Memo  : ' + Buffer.from(memo).length + ' B');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('\n🔗 https://tronscan.org/#/transaction/' + txID);
    
    fs.writeFileSync('/workspace/private-chain/addr-anchor-result.json', JSON.stringify({
      txID, assetAddr, assetPrivKey: acc.privateKey, memoSize: Buffer.from(memo).length, memo,
      addrRoot: ADDR_ROOT, txRoot: NILE_DATA.txMerkleRoot, nileTxs: NILE_DATA.totalTxs, addrs: NILE_DATA.addrs
    }, null, 2));
    console.log('\n✅ 已保存 addr-anchor-result.json');
  } else {
    console.log('❌ 广播失败:', JSON.stringify(result).slice(0,300));
  }
})();
