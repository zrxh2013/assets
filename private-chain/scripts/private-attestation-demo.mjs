// 私链存证广播 —— 将转账详情写入 memo 上链
import { TronWeb } from 'tronweb';

const SENDER_PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
const RECEIVER = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'; // 黑洞地址
const AMOUNT_SUN = 1; // 1 SUN = 0.000001 TRX

const tw = new TronWeb({
  fullNode: 'http://127.0.0.1:18090',
  solidityNode: 'http://127.0.0.1:18090',
  eventServer: 'http://127.0.0.1:18090',
  privateKey: SENDER_PRIV,
});

async function main() {
  const from = tw.address.fromPrivateKey(SENDER_PRIV);
  console.log('发送方:', from);
  console.log('接收方:', RECEIVER);
  console.log('金额: 0.000001 TRX (1 SUN)');

  // 存证内容 —— 刚才那笔转账的详情
  const memoObj = {
    title: '转账详情存证',
    data: {
      txID: '81ff292bebad9b196b2ca19c8ecf34cc556e9dda0ba0602d6476a692a40a24bf',
      发送方: 'TFuRdgLbf87XbDVnoThfCzk4jkxnwsYg1t',
      接收方: 'TC2iAdkgG8ZwzQftnK1A9dd85ZtbYEtDJg',
      金额: '100 TRX',
      手续费: '0 TRX',
      时间: '2026/10/8 10:18:48',
    },
    ts: Math.floor(Date.now() / 1000),
  };
  const memoStr = JSON.stringify(memoObj);
  console.log('存证内容:', memoStr);
  console.log('存证长度:', memoStr.length, '字节');

  // 1. 创建 TRX 转账交易
  const tx = await tw.transactionBuilder.sendTrx(RECEIVER, AMOUNT_SUN, from);

  // 2. 添加 memo（手动 protobuf 编码）
  const encoder = new TextEncoder();
  const bytes = encoder.encode(memoStr);
  let memoHex = '';
  for (const b of bytes) memoHex += b.toString(16).padStart(2, '0');

  // protobuf: data 字段 tag=0x52 (field 10, wire type 2)
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

  // 重新计算 txID
  const { txJsonToPb, txPbToTxID, txPbToRawDataHex } = tw.utils.transaction;
  const pb = txJsonToPb(tx);
  tx.txID = txPbToTxID(pb).replace(/^0x/, '');
  tx.raw_data_hex = txPbToRawDataHex(pb).toLowerCase();

  // 3. 签名
  const signed = await tw.trx.sign(tx);

  // 4. 广播
  const result = await tw.trx.sendRawTransaction(signed);

  if (result.result === true || (result.txid && !result.code)) {
    const txid = signed.txID || result.txid;
    console.log('\n✅ 存证广播成功！');
    console.log('存证交易 txID:', txid);
    console.log('发送方:', from);
    console.log('接收方:', RECEIVER);
    console.log('转账金额: 0.000001 TRX');
    console.log('存证数据长度:', memoStr.length, '字节');
    console.log('\n存证交易已写入 TRON 私链，转账详情永久上链。');
    console.log('可用以下命令查询验证:');
    console.log(`  curl -X POST http://127.0.0.1:18090/wallet/gettransactionbyid -d '{"value":"${txid}"}'`);
  } else {
    let msg = result.message || JSON.stringify(result);
    if (msg && /^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
      try {
        const b = new Uint8Array(msg.match(/.{1,2}/g).map(h => parseInt(h, 16)));
        msg = new TextDecoder().decode(b);
      } catch(e) {}
    }
    console.error('广播失败:', result.code, msg);
  }
}

main().catch(e => console.error('失败:', e.message));
