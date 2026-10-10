// 从 Nile V2 锚定交易提取 memo，广播到主网
const { TronWeb } = require('tronweb');
const fs = require('fs');

// 主网钱包
const wallet = JSON.parse(fs.readFileSync('/tmp/mainnet-wallet.json', 'utf8'));
const PRIV = wallet.privateKey;
const FROM = wallet.address;

// Nile V2 锚定交易
const NILE_V2_TX = 'ce8bb24bd2dde5ff8869b7e9dd4d97307d377217bca7ecbb66ac2c68864fabe1';
// 燃烧地址
const BURN = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

(async () => {
  console.log('=== 主网锚定广播 ===');
  console.log('From:', FROM);
  console.log('Nile V2 tx:', NILE_V2_TX.slice(0, 20) + '...');

  // 1. 从 Nile 链上读取 V2 交易的 memo
  const twNile = new TronWeb({ fullHost: 'https://nile.trongrid.io' });
  const nileTx = await twNile.trx.getTransaction(NILE_V2_TX);
  if (!nileTx || !nileTx.raw_data) {
    console.error('❌ Nile V2 交易未找到');
    process.exit(1);
  }

  const memoHex = nileTx.raw_data.data;
  if (!memoHex) {
    console.error('❌ Nile V2 交易没有 memo');
    process.exit(1);
  }

  const memoStr = Buffer.from(memoHex, 'hex').toString('utf8');
  console.log('\n提取到的 V2 memo (' + Buffer.byteLength(memoStr, 'utf8') + ' bytes):');
  console.log(memoStr.slice(0, 200) + '...');

  // 2. 主网客户端
  const twMain = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: PRIV,
  });

  // 确认余额
  const acct = await twMain.trx.getAccount(FROM);
  const bal = (acct.balance || 0) / 1e6;
  console.log('\n主网余额:', bal.toFixed(2), 'TRX');

  // 3. 构造主网转账 (1 SUN = 0.000001 TRX 到燃烧地址)
  const unSignedTx = await twMain.transactionBuilder.sendTrx(BURN, 1, FROM);

  // 4. 注入相同的 V2 memo
  unSignedTx.raw_data.data = Buffer.from(memoStr, 'utf8').toString('hex');

  // 5. 重新序列化
  const txUtil = twMain.utils.transaction;
  const pb = txUtil.txJsonToPb(unSignedTx);
  unSignedTx.txID = txUtil.txPbToTxID(pb).replace(/^0x/, '');
  unSignedTx.raw_data_hex = txUtil.txPbToRawDataHex(pb).toLowerCase();

  console.log('\n主网 txID (预计算):', unSignedTx.txID);
  console.log('memo 大小:', Buffer.byteLength(memoStr, 'utf8'), 'bytes');

  // 6. 签名
  const signed = await twMain.trx.sign(unSignedTx);
  console.log('签名完成');

  // 7. 广播
  const result = await twMain.trx.sendRawTransaction(signed);
  console.log('\n广播结果:', result.result ? '✅ 成功' : '❌ 失败');

  if (result.result) {
    console.log('主网 txID:', signed.txID || unSignedTx.txID);
    console.log('\n⏳ 等待区块确认 (6秒)...');
    await new Promise(r => setTimeout(r, 6000));

    // 8. 验证
    const mainTxID = signed.txID || unSignedTx.txID;
    try {
      const info = await twMain.trx.getTransactionInfo(mainTxID);
      const bn = info.blockNumber;
      const fee = (info.fee || 0) / 1e6;
      console.log('\n=== 链上验证 ===');
      console.log('Block:', bn ? '#' + bn : 'pending');
      console.log('Fee:', fee.toFixed(6), 'TRX');

      // 解码 memo
      const mainTx = await twMain.trx.getTransaction(mainTxID);
      if (mainTx && mainTx.raw_data && mainTx.raw_data.data) {
        const decoded = Buffer.from(mainTx.raw_data.data, 'hex').toString('utf8');
        const json = JSON.parse(decoded);
        console.log('\n=== memo 解码 ===');
        console.log('类型:', json.ty || 'N/A');
        console.log('版本:', json.v || 1);
        console.log('源网络:', json.s || 'nile');
        console.log('地址:', json.a || 'N/A');
        console.log('总交易:', json.sum?.n || 'N/A');
        console.log('真实转账:', json.sum?.r || 'N/A');
        if (json.sum?.tok) {
          for (const [k, v] of Object.entries(json.sum.tok)) {
            console.log('合约 ' + k + ':', JSON.stringify(v));
          }
        }
      }

      // 余额
      const after = await twMain.trx.getAccount(FROM);
      console.log('\n剩余余额:', ((after.balance||0)/1e6).toFixed(2), 'TRX');

      console.log('\n🔗 Tronscan: https://tronscan.org/#/transaction/' + mainTxID);
    } catch(e) {
      console.log('验证失败 (可能需要更长等待):', e.message.slice(0,80));
      console.log('🔗 Tronscan: https://tronscan.org/#/transaction/' + (signed.txID || unSignedTx.txID));
    }
  } else {
    console.error('错误详情:', JSON.stringify(result));
  }
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
