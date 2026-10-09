// 检查发起方钱包主网余额
import { TronWeb } from 'tronweb';

const SENDER_PRIV = '54f1337ee3587d817cd231ab106dbc8c406afdd6106dd942b7024f30b933afa1';
const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });

const addr = tw.address.fromPrivateKey(SENDER_PRIV);
console.log('=== 发起方钱包 ===');
console.log('地址:', addr);
console.log('私钥:', SENDER_PRIV.slice(0, 8) + '...' + SENDER_PRIV.slice(-4));

// 查 TRX 余额
try {
  const trxSun = await tw.trx.getBalance(addr);
  console.log('TRX 余额:', (trxSun / 1e6).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}), 'TRX');
} catch (e) {
  console.log('TRX 查询失败:', e.message);
}

// 查 USDT 余额
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
try {
  const contract = await tw.contract(USDT);
  const bal = await contract.balanceOf(addr).call();
  const usdtBal = Number(bal.toString()) / 1e6;
  console.log('USDT 余额:', usdtBal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}), 'USDT');
} catch (e) {
  console.log('USDT 查询失败:', e.message);
}

// 查账户资源
try {
  const account = await tw.trx.getAccountResources(addr);
  console.log('');
  console.log('=== 账户资源 ===');
  console.log('带宽:', account.freeNetUsed || 0, '/', account.freeNetLimit || 0);
  console.log('能量:', account.EnergyUsed || 0, '/', account.EnergyLimit || 0);
} catch (e) {}

// 查账户是否激活
try {
  const acc = await tw.trx.getAccount(addr);
  console.log('');
  console.log('=== 账户激活状态 ===');
  console.log('已激活:', !!acc.address || acc.balance !== undefined);
  if (acc.trc20 && acc.trc20.length > 0) {
    console.log('持有的 TRC20 代币数:', acc.trc20.length);
  }
} catch (e) {
  console.log('账户可能未激活:', e.message);
}

console.log('');
console.log('=== 存证需求 ===');
const TOTAL_USDT = 13144529.16;
const ESTIMATED_TRX_FEE = 71 * 25;
console.log('需要 USDT:', TOTAL_USDT.toLocaleString('en-US'), 'USDT');
console.log('预估 TRX 能量费: ~', ESTIMATED_TRX_FEE, 'TRX（71 笔，每笔约 25 TRX）');
