// scripts/deploy-official.js
// 部署 USDT 合约（TetherToken）到本地私链

const hre = require("hardhat");

async function main() {
  const [deployer, user1, user2] = await hre.ethers.getSigners();

  console.log("==================================================");
  console.log("部署 USDT 合约到本地私链");
  console.log("==================================================");
  console.log(`部署者地址: ${deployer.address}`);
  console.log(`部署者余额: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("");

  // 初始发行量：1,000,000 USDT
  const INITIAL_SUPPLY = 1_000_000;

  const TetherToken = await hre.ethers.getContractFactory("TetherToken");
  const usdt = await TetherToken.deploy(INITIAL_SUPPLY);
  await usdt.waitForDeployment();

  const usdtAddress = await usdt.getAddress();
  const txHash = usdt.deploymentTransaction().hash;

  console.log(`✅ USDT 合约部署成功！`);
  console.log(`   合约地址:   ${usdtAddress}`);
  console.log(`   交易哈希:   ${txHash}`);
  console.log(`   代币名称:   ${await usdt.name()}`);
  console.log(`   代币符号:   ${await usdt.symbol()}`);
  console.log(`   小数位数:   ${await usdt.decimals()}`);
  console.log(`   总供应量:   ${hre.ethers.formatUnits(await usdt.totalSupply(), 6)} USDT`);
  console.log(`   拥有者地址: ${await usdt.owner()}`);
  console.log(`   拥有者余额: ${hre.ethers.formatUnits(await usdt.balanceOf(deployer.address), 6)} USDT`);
  console.log("");

  // 给测试用户分配 USDT
  const distributeAmount = hre.ethers.parseUnits("100000", 6); // 10万 USDT
  await usdt.connect(deployer).transfer(user1.address, distributeAmount);
  await usdt.connect(deployer).transfer(user2.address, distributeAmount);

  console.log("📦 已为测试账户分配 USDT：");
  console.log(`   账户 ${user1.address}: ${hre.ethers.formatUnits(await usdt.balanceOf(user1.address), 6)} USDT`);
  console.log(`   账户 ${user2.address}: ${hre.ethers.formatUnits(await usdt.balanceOf(user2.address), 6)} USDT`);
  console.log("");
  console.log("💡 保存以下合约地址用于后续转账：");
  console.log(`   export USDT_CONTRACT=${usdtAddress}`);
  console.log(`   export DEPLOYER=${deployer.address}`);
  console.log(`   export USER1=${user1.address}`);
  console.log(`   export USER2=${user2.address}`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
