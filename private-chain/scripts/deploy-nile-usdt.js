// 部署带 mint 的 USDT 合约到 Nile 测试网
const { TronWeb } = require('tronweb');
const fs = require('fs');

const PRIV = '63d9de16c88d7a840beb55175946f9f62f5a62d1d3dc9b6df7b0962512dd80e3';
const FROM = 'TF65UqeFNN5YN75GeDfs9Nfc7LekL8eik9';

const artifact = require('../artifacts/contracts/TetherToken.sol/TetherToken.json');

(async () => {
  console.log('=== 部署 USDT (带 mint) 到 Nile ===\n');

  const tw = new TronWeb({
    fullHost: 'https://nile.trongrid.io',
    privateKey: PRIV,
  });

  // 余额
  const acct = await tw.trx.getAccount(FROM);
  console.log('部署者:', FROM);
  console.log('余额:', ((acct.balance || 0) / 1e6).toFixed(2), 'TRX');

  // ABI + bytecode
  const abi = artifact.abi;
  const bytecode = artifact.bytecode;

  // 构造合约
  const contract = await tw.contract().new({
    abi,
    bytecode,
    feeLimit: 1000000000, // 1000 TRX
    parameters: [0], // initialSupply = 0 (后面用 issue 铸造)
  });

  const addr = contract.address;
  console.log('\n✅ 部署成功!');
  console.log('合约地址:', addr);
  console.log('Tronscan: https://nile.tronscan.org/#/contract/' + addr);

  // 读取基本信息
  const name = await contract.name().call();
  const symbol = await contract.symbol().call();
  const decimals = await contract.decimals().call();
  const totalSupply = await contract.totalSupply().call();
  const owner = await contract.owner().call();

  console.log('\n=== 合约信息 ===');
  console.log('name:', name);
  console.log('symbol:', symbol);
  console.log('decimals:', decimals);
  console.log('totalSupply:', totalSupply, '(' + (totalSupply / 1e6) + ' USDT)');
  console.log('owner:', owner);

  // 铸造 10 亿 USDT
  console.log('\n=== 铸造 10 亿 USDT ===');
  const issueTx = await contract.issue(1000000000).send({
    feeLimit: 100000000,
    from: FROM,
  });
  console.log('issue txID:', issueTx);
  console.log('Tronscan: https://nile.tronscan.org/#/transaction/' + issueTx);

  // 验证余额
  await new Promise(r => setTimeout(r, 3000));
  const bal = await contract.balanceOf(FROM).call();
  const ts = await contract.totalSupply().call();
  console.log('\n=== 铸造后 ===');
  console.log('balanceOf(owner):', bal, '(' + (bal / 1e6) + ' USDT)');
  console.log('totalSupply:', ts, '(' + (ts / 1e6) + ' USDT)');

  // 保存合约信息
  fs.writeFileSync('/tmp/nile-usdt-contract.json', JSON.stringify({
    address: addr,
    name, symbol, decimals: Number(decimals),
    owner, issueTxID: issueTx,
    deployer: FROM,
    createdAt: new Date().toISOString()
  }, null, 2));
  console.log('\n已保存到 /tmp/nile-usdt-contract.json');
})().catch(e => {
  console.error('Error:', e.message || e);
  if (e.output) console.error('  output:', JSON.stringify(e.output).slice(0, 200));
  process.exit(1);
});
