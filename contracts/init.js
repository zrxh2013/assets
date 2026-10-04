// 初始化脚本：部署 USDTPoints 合约，并向发行者发行 10 亿积分
// 用法: PRIVATE_KEY=你的私钥 node init.js
//
// 注意：部署合约需要约 100~300 TRX 手续费，请确保地址有足够 TRX。

const { TronWeb } = require('tronweb');
const fs = require('fs');

if (!process.env.PRIVATE_KEY) {
  console.error('请设置环境变量 PRIVATE_KEY');
  process.exit(1);
}

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',   // 主网
  privateKey: process.env.PRIVATE_KEY,
});

const USDT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // Tron USDT
const TOKEN_NAME = 'PT结USDT';
const TOKEN_SYMBOL = 'PTUSDT';
const MINT_AMOUNT = 1_000_000_000; // 10 亿积分（精度 6，实际链上值 = 10亿 * 1e6）

function toTokenUnits(n) {
  // 精度 6，转换为链上最小单位
  return (BigInt(n) * 10n ** 6n).toString();
}

async function main() {
  const owner = tronWeb.defaultAddress.base58;
  console.log('发行者地址:', owner);

  // 1. 检查 TRX 余额
  const trxBalance = await tronWeb.trx.getBalance(owner);
  const trxNum = trxBalance / 1e6;
  console.log('TRX 余额:', trxNum.toFixed(6), 'TRX');
  if (trxNum < 200) {
    console.error(`⚠️  TRX 不足（需要约 200 TRX 部署合约），当前只有 ${trxNum.toFixed(6)} TRX`);
    console.error('   请先向地址转入足够 TRX 后再运行此脚本。');
    process.exit(1);
  }

  // 2. 部署合约
  console.log('\n正在部署合约...');
  const bytecode = fs.readFileSync('USDTPoints.bin', 'utf8');
  const abi = JSON.parse(fs.readFileSync('USDTPoints.abi', 'utf8'));

  const contract = await tronWeb.contract().new({
    abi,
    bytecode,
    parameters: [TOKEN_NAME, TOKEN_SYMBOL, USDT_ADDRESS],
    feeLimit: 1_000_000_000, // 1000 TRX 上限
  });

  const contractAddr = contract.address;
  console.log('✅ 合约部署成功:', contractAddr);

  // 3. 向发行者 mint 10 亿积分
  const mintAmount = toTokenUnits(MINT_AMOUNT);
  console.log(`\n正在向发行者发行 ${MINT_AMOUNT.toLocaleString()} 积分...`);
  const mintTx = await contract.ownerMint(owner, mintAmount).send({
    feeLimit: 100_000_000, // 100 TRX 上限
  });
  console.log('✅ 发行交易:', mintTx);

  // 4. 验证余额
  const bal = await contract.balanceOf(owner).call();
  console.log(`\n发行者积分余额: ${(BigInt(bal.toString()) / 10n ** 6n).toLocaleString()}`);
  const totalSupply = await contract.totalSupply().call();
  console.log(`总供应量: ${(BigInt(totalSupply.toString()) / 10n ** 6n).toLocaleString()}`);

  console.log('\n🎉 初始化完成！');
  console.log('合约地址:', contractAddr);
  console.log('可在 TronScan 查看: https://tronscan.io/#/contract/' + contractAddr);
}

main().catch((e) => {
  console.error('执行失败:', e.message);
  process.exit(1);
});
