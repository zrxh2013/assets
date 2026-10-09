// 单笔测试：私链 USDT transfer + memo
import { TronWeb } from 'tronweb';

const FULL_HOST = 'http://127.0.0.1:18090';
const SENDER_PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
const USDT_CONTRACT_HEX = '414538870cc2b4adda5a0a49f14b34bbfa66b5db35';

const tw = new TronWeb({
  fullNode: FULL_HOST,
  solidityNode: 'http://127.0.0.1:18091',
  eventServer: FULL_HOST,
  privateKey: SENDER_PRIV,
});
const USDT_CONTRACT = TronWeb.address.fromHex(USDT_CONTRACT_HEX);
const SENDER = tw.defaultAddress.base58;

const b = {
  name: '杨王兴',
  addr: 'TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv',
  amount: '87455.20',
  receipt: 'REC-0001',
};

async function main() {
  console.log('=== 单笔私链 USDT 存证测试 ===');
  console.log('合约(b58):', USDT_CONTRACT);
  console.log('发送方:', SENDER);

  // 余额查询
  const acct = await tw.trx.getAccount(SENDER);
  console.log('TRX 余额:', (acct.balance || 0) / 1e6);

  const balRes = await tw.transactionBuilder.triggerConstantContract(
    USDT_CONTRACT_HEX,
    'balanceOf(address)',
    {},
    [{ type: 'address', value: TronWeb.address.toHex(SENDER) }],
    TronWeb.address.toHex(SENDER)
  );
  const usdtBal = BigInt('0x' + balRes.constant_result[0]);
  console.log('USDT 余额:', Number(usdtBal) / 1e6);

  // 构造 memo
  const ts = Date.now();
  const memo = JSON.stringify({ t: b.name, a: b.amount, r: b.receipt, addr: b.addr, ts });
  console.log('memo:', memo);

  // amount 转最小单位
  const [whole, frac = ''] = String(b.amount).split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  const valueRaw = BigInt(whole) * 1000000n + BigInt(frac6);
  console.log('转账金额(最小单位):', valueRaw.toString(), '(', Number(valueRaw) / 1e6, 'USDT)');

  // trigger smart contract
  console.log('\n构造 USDT transfer 交易...');
  const tx = await tw.transactionBuilder.triggerSmartContract(
    USDT_CONTRACT_HEX,
    'transfer(address,uint256)',
    { feeLimit: 1000000000 },
    [
      { type: 'address', value: TronWeb.address.toHex(b.addr) },
      { type: 'uint256', value: valueRaw.toString() },
    ],
    TronWeb.address.toHex(SENDER)
  );
  console.log('trigger 返回 transaction:', !!tx.transaction);

  // 附加 memo
  console.log('附加 memo...');
  const withMemo = await tw.transactionBuilder.addUpdateData(tx.transaction, memo, 'utf8');
  console.log('附加后 raw_data.data 存在:', !!withMemo.raw_data.data);

  // 签名
  console.log('签名...');
  const signed = await tw.trx.sign(withMemo);
  console.log('签名完成');

  // 广播
  console.log('广播...');
  const result = await tw.trx.sendRawTransaction(signed);
  console.log('广播结果:', JSON.stringify(result));

  if (result.result === true || result.code === 'SUCCESS') {
    console.log('\n✅ 成功! txID:', result.txid);
    // 等待出块
    await new Promise((r) => setTimeout(r, 3000));
    // 查询交易
    const info = await tw.trx.getTransaction(result.txid);
    console.log('\n=== 交易详情 ===');
    console.log('txID:', info.txID);
    console.log('data(memo hex):', info.raw_data?.data);
    if (info.raw_data?.data) {
      try {
        console.log('memo 解码:', Buffer.from(info.raw_data.data, 'hex').toString('utf8'));
      } catch (e) {
        console.log('memo 解码失败:', e.message);
      }
    }
    // 查询接收方 USDT 余额
    const rBal = await tw.transactionBuilder.triggerConstantContract(
      USDT_CONTRACT_HEX,
      'balanceOf(address)',
      {},
      [{ type: 'address', value: TronWeb.address.toHex(b.addr) }],
      TronWeb.address.toHex(SENDER)
    );
    const rUsdt = BigInt('0x' + rBal.constant_result[0]);
    console.log(`接收方 ${b.addr} USDT 余额:`, Number(rUsdt) / 1e6);
  } else {
    console.log('\n❌ 失败');
    if (result.message) {
      try { console.log('message:', tw.toUtf8(result.message)); } catch { console.log('message:', result.message); }
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e.message || e);
  if (e.output) console.error('output:', JSON.stringify(e.output).slice(0, 300));
  process.exit(1);
});
