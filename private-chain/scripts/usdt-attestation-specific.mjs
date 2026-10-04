// 特定转账存证示例
// 向 TC2iAdkgG8ZwzQftnK1A9dd85ZtbYEtDJg 转账 1,896,520 USDT
// 同时在 memo 中携带存证数据，链上看起来就是这笔 USDT 转账
import { TronWeb } from 'tronweb';

// ============ 配置 ============
const SENDER_PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
const USDT_ADDR = '419a6e591feb47e5c48c6f50ce1c6e775a82c1fb25'; // 私链 USDT 合约

const tw = new TronWeb({
  fullNode: 'http://127.0.0.1:18090',
  solidityNode: 'http://127.0.0.1:18091',
  eventServer: 'http://127.0.0.1:18090',
  privateKey: SENDER_PRIV,
});

// ============ 转账参数 ============
const TARGET = 'TC2iAdkgG8ZwzQftnK1A9dd85ZtbYEtDJg';
const AMOUNT_USDT = 1896520; // 转账金额
const RECEIPT = 'REC-1896520'; // 回执单号

// ============ 构造存证 memo ============
const memoData = {
  t: '确权受益人',           // 类型
  a: AMOUNT_USDT.toString(), // 确权金额（与转账金额一致）
  r: RECEIPT,                // 回执单号
  addr: TARGET,              // 受益人地址
  ts: Math.floor(Date.now() / 1000), // 时间戳
};
const memoHex = Buffer.from(JSON.stringify(memoData)).toString('hex');

console.log('=== USDT 转账存证 ===');
console.log('接收方:', TARGET);
console.log('转账金额:', AMOUNT_USDT.toLocaleString(), 'USDT');
console.log('存证 memo:', JSON.stringify(memoData));
console.log('');

// ============ 执行转账存证 ============
async function attestationTransfer() {
  const sender = tw.defaultAddress.base58;
  const amountSun = Math.floor(AMOUNT_USDT * 1e6);

  try {
    // 1. 检查余额
    const contract = await tw.contract().at(USDT_ADDR);
    const usdtBal = Number((await contract.balanceOf(sender).call()).toString()) / 1e6;
    console.log(`发送方 USDT 余额: ${usdtBal.toLocaleString()} USDT`);

    if (usdtBal < AMOUNT_USDT) {
      console.error(`❌ USDT 余额不足，需要 ${AMOUNT_USDT.toLocaleString()} USDT`);
      return;
    }

    // 2. 构造 USDT 转账交易
    const result = await tw.transactionBuilder.triggerSmartContract(
      USDT_ADDR,
      'transfer(address,uint256)',
      { feeLimit: 100000000 },
      [
        { type: 'address', value: TARGET },
        { type: 'uint256', value: amountSun },
      ],
      sender
    );

    const tx = result.transaction;

    // 3. 添加 memo 并重新计算 txID 和 raw_data_hex（关键步骤）
    tx.raw_data.data = memoHex;
    const { txJsonToPb, txPbToTxID, txPbToRawDataHex } = tw.utils.transaction;
    const pb = txJsonToPb(tx);
    tx.txID = txPbToTxID(pb).replace(/^0x/, '');
    tx.raw_data_hex = txPbToRawDataHex(pb).toLowerCase();

    // 4. 签名并广播
    const signed = await tw.trx.sign(tx, SENDER_PRIV);
    const sent = await tw.trx.sendRawTransaction(signed);

    console.log('');
    console.log('✅ 存证转账广播成功');
    console.log('   txID:', sent.txid);
    console.log('');

    // 5. 等待确认
    console.log('等待交易确认...');
    await new Promise((r) => setTimeout(r, 5000));

    // 6. 验证链上数据
    const confirmed = await tw.trx.getTransaction(sent.txid);
    const raw = confirmed.raw_data;
    const memo = raw.data ? Buffer.from(raw.data, 'hex').toString('utf8') : '(无)';
    const callData = raw.contract[0].parameter.value.data;
    const toAddr = '41' + callData.slice(32, 72);
    const amt = parseInt(callData.slice(72, 136), 16) / 1e6;

    console.log('');
    console.log('=== 链上交易详情 ===');
    console.log('交易类型:', raw.contract[0].type, '(USDT 转账)');
    console.log('接收方:', tw.address.fromHex(toAddr));
    console.log('转账金额:', amt.toLocaleString(), 'USDT');
    console.log('存证 memo:', memo);
    console.log('');
    console.log('✅ 链上显示为一笔 ' + AMOUNT_USDT.toLocaleString() + ' USDT 的普通转账，memo 中携带存证数据');
  } catch (e) {
    console.error('❌ 转账存证失败:', e.message);
  }
}

attestationTransfer();
