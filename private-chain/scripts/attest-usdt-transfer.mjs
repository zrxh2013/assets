// 将指定 USDT 转账信息存证到私链
import { TronWeb } from 'tronweb';

const SENDER_PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
const RECEIVER = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

const tw = new TronWeb({
  fullNode: 'http://127.0.0.1:18090',
  solidityNode: 'http://127.0.0.1:18090',
  eventServer: 'http://127.0.0.1:18090',
  privateKey: SENDER_PRIV,
});

async function main() {
  const from = tw.address.fromPrivateKey(SENDER_PRIV);

  // 存证内容 —— 用户提供的 USDT 转账信息
  const memoObj = {
    title: 'USDT 转账凭证',
    data: {
      from: 'TBhVUCRm3pZDJ144V9dLP6SNjf8ZaRZGkF',
      to: 'TY2rZAHXd1zovaLAfSQSpQ57r1kLMKsADR',
      amount: '1675980 USDT',
      dataHash: '0x91c8c5e6da5fdfbfabf1a6efe058c40e26af450915496afa1aa2362913575c14',
    },
    ts: Math.floor(Date.now() / 1000),
  };
  const memoStr = JSON.stringify(memoObj);
  console.log('存证内容:', memoStr);
  console.log('存证长度:', memoStr.length, '字节');

  // 构建交易
  const tx = await tw.transactionBuilder.sendTrx(RECEIVER, 1, from);

  // 添加 memo
  const encoder = new TextEncoder();
  const bytes = encoder.encode(memoStr);
  let memoHex = '';
  for (const b of bytes) memoHex += b.toString(16).padStart(2, '0');
  let len = bytes.length;
  let lenVarint = '';
  while (len > 0) {
    let b = len & 0x7f;
    len >>= 7;
    if (len > 0) b |= 0x80;
    lenVarint += b.toString(16).padStart(2, '0');
  }
  tx.raw_data.data = memoHex;
  tx.raw_data_hex = tx.raw_data_hex + '52' + lenVarint + memoHex;

  const { txJsonToPb, txPbToTxID, txPbToRawDataHex } = tw.utils.transaction;
  const pb = txJsonToPb(tx);
  tx.txID = txPbToTxID(pb).replace(/^0x/, '');
  tx.raw_data_hex = txPbToRawDataHex(pb).toLowerCase();

  const signed = await tw.trx.sign(tx);
  const result = await tw.trx.sendRawTransaction(signed);

  if (result.result === true || (result.txid && !result.code)) {
    const txid = signed.txID || result.txid;
    console.log('\n✅ 存证成功！');
    console.log('存证 txID:', txid);
    console.log('\n存证数据:');
    console.log(JSON.stringify(memoObj.data, null, 2));
  } else {
    console.error('失败:', result);
  }
}

main().catch(e => console.error('失败:', e.message));
