// 私链转账演示 —— 直接用 RPC 接口
import { TronWeb } from 'tronweb';

const SENDER_PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
const RECEIVER = 'TC2iAdkgG8ZwzQftnK1A9dd85ZtbYEtDJg';
const AMOUNT_SUN = 100 * 1_000_000; // 100 TRX

const tw = new TronWeb({
  fullNode: 'http://127.0.0.1:18090',
  solidityNode: 'http://127.0.0.1:18090',
  eventServer: 'http://127.0.0.1:18090',
  privateKey: SENDER_PRIV,
});

async function main() {
  const from = tw.address.fromPrivateKey(SENDER_PRIV);
  const fromHex = tw.address.toHex(from);
  const toHex = tw.address.toHex(RECEIVER);

  console.log('发送方:', from);
  console.log('接收方:', RECEIVER);
  console.log('金额: 100 TRX');

  // 1. 创建交易
  const createRes = await fetch('http://127.0.0.1:18090/wallet/createtransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to_address: toHex,
      owner_address: fromHex,
      amount: AMOUNT_SUN,
    }),
  }).then(r => r.json());

  if (createRes.Error) {
    console.error('创建交易失败:', createRes.Error);
    return;
  }

  // 2. 签名
  const signed = await tw.trx.sign(createRes);

  // 3. 广播
  const broadcastRes = await fetch('http://127.0.0.1:18090/wallet/broadcasttransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  }).then(r => r.json());

  if (!broadcastRes.result) {
    console.error('广播失败:', broadcastRes);
    return;
  }

  const txid = broadcastRes.txid || createRes.txID;
  console.log('\n✅ 转账成功！');
  console.log('txID:', txid);

  // 等待确认
  await new Promise(r => setTimeout(r, 3000));

  // 4. 查询交易详情
  const info = await fetch('http://127.0.0.1:18090/wallet/gettransactioninfobyid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: txid }),
  }).then(r => r.json());

  const blockNum = info.blockNumber;
  const fee = (info.fee || 0) / 1e6;
  const now = new Date();

  console.log('\n========== 转账详情 ==========');
  const detail = {
    txID: txid,
    发送方: from,
    接收方: RECEIVER,
    金额: '100 TRX',
    区块高度: blockNum,
    手续费: fee + ' TRX',
    时间: now.toLocaleString('zh-CN'),
  };
  console.log(JSON.stringify(detail, null, 2));

  // 输出紧凑 JSON 供存证使用
  console.log('\n========== 存证用 JSON ==========');
  console.log(JSON.stringify(detail));
}

main().catch(e => console.error('失败:', e.message));
