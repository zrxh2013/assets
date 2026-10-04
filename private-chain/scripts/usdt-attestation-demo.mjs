// USDT 转账存证示例
// 通过调用 USDT 合约的 transfer 方法向受益人转账真实金额，
// 同时在 memo 中携带存证数据，链上看起来就是一笔普通的 USDT 转账
import { TronWeb } from 'tronweb';

// ============ 配置 ============
const SENDER_PRIV = '你的发送方私钥';
const USDT_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // 波场主网 USDT 合约

const tw = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: SENDER_PRIV,
});

// ============ 存证受益人数据 ============
const beneficiary = {
  name: '杨王兴',
  addr: 'TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv',
  amount: '87455.20',
  receipt: 'REC-0001',
};

// ============ 构造 memo ============
const memoData = {
  t: beneficiary.name,       // 姓名
  a: beneficiary.amount,     // 确权金额
  r: beneficiary.receipt,    // 回执单号
  addr: beneficiary.addr,    // TRON 地址
  ts: Math.floor(Date.now() / 1000), // 时间戳
};
const memoHex = Buffer.from(JSON.stringify(memoData)).toString('hex');
console.log('存证 memo:', JSON.stringify(memoData));
console.log('转账金额:', Number(beneficiary.amount).toLocaleString(), 'USDT');
console.log('');

// ============ 执行 USDT 转账存证 ============
async function usdtAttestation() {
  const sender = tw.defaultAddress.base58;
  const amountUsdt = parseFloat(beneficiary.amount);
  const amountSun = Math.floor(amountUsdt * 1e6); // USDT 6 位小数

  try {
    // 1. 获取 USDT 合约实例
    const contract = await tw.contract().at(USDT_ADDR);

    // 2. 检查发送方 USDT 余额
    const usdtBal = await contract.balanceOf(sender).call();
    const usdtBalNum = Number(usdtBal.toString()) / 1e6;
    console.log(`发送方 USDT 余额: ${usdtBalNum.toLocaleString()} USDT`);

    if (usdtBalNum < amountUsdt) {
      console.error(`❌ USDT 余额不足，需要 ${amountUsdt} USDT`);
      return;
    }

    // 3. 检查 TRX 余额（支付能量费）
    const trxBal = ((await tw.trx.getAccount()).balance || 0) / 1e6;
    console.log(`发送方 TRX 余额: ${trxBal.toFixed(6)} TRX`);
    console.log('');

    // 4. 构造 USDT 转账交易
    const result = await tw.transactionBuilder.triggerSmartContract(
      USDT_ADDR,
      'transfer(address,uint256)',
      { feeLimit: 100000000 },
      [
        { type: 'address', value: beneficiary.addr },
        { type: 'uint256', value: amountSun },
      ],
      sender
    );

    const tx = result.transaction;

    // 5. 添加 memo 并重新计算 txID 和 raw_data_hex
    //    （必须重新计算，否则签名校验失败）
    tx.raw_data.data = memoHex;
    const { txJsonToPb, txPbToTxID, txPbToRawDataHex } = tw.utils.transaction;
    const pb = txJsonToPb(tx);
    tx.txID = txPbToTxID(pb).replace(/^0x/, '');
    tx.raw_data_hex = txPbToRawDataHex(pb).toLowerCase();

    // 6. 签名
    const signed = await tw.trx.sign(tx, SENDER_PRIV);

    // 7. 广播
    const sent = await tw.trx.sendRawTransaction(signed);
    console.log(`✅ 存证交易广播成功`);
    console.log(`   txID: ${sent.txid}`);
    console.log(`   查看: https://tronscan.org/#/transaction/${sent.txid}`);

    // 8. 等待确认
    console.log('\n等待交易确认...');
    await new Promise((r) => setTimeout(r, 10000));

    const info = await tw.trx.getTransactionInfo(sent.txid);
    console.log(`\n=== 交易确认信息 ===`);
    console.log(`状态: ${info.receipt ? info.receipt.result : '待确认'}`);
    console.log(`区块号: ${info.blockNumber}`);
    console.log(`消耗能量: ${info.energy_usage_total || 0}`);
    console.log(`消耗带宽: ${info.net_usage || 0} bytes`);
    console.log(`手续费: ${(info.fee || 0) / 1e6} TRX`);

    // 9. 验证链上数据
    const confirmed = await tw.trx.getTransaction(sent.txid);
    const raw = confirmed.raw_data;
    const memo = raw.data ? Buffer.from(raw.data, 'hex').toString('utf8') : '(无)';
    console.log(`\n=== 链上存证数据 ===`);
    console.log(`交易类型: ${raw.contract[0].type} (USDT 转账)`);
    console.log(`memo: ${memo}`);
    console.log(`\n查看: https://tronscan.org/#/transaction/${sent.txid}`);
  } catch (e) {
    console.error('❌ 存证失败:', e.message);
  }
}

usdtAttestation();
