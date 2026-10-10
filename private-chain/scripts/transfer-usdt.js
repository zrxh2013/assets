// scripts/transfer-usdt.js
// 执行 USDT 转账交易上链

const hre = require("hardhat");

async function main() {
  const [deployer, sender, recipient] = await hre.ethers.getSigners();

  // 如果有环境变量合约地址就用环境变量，否则需要传入
  const contractAddress = process.env.USDT_CONTRACT;
  if (!contractAddress) {
    console.error("❌ 请先设置 USDT_CONTRACT 环境变量！");
    console.error("   export USDT_CONTRACT=<合约地址>");
    process.exit(1);
  }

  const amount = hre.ethers.parseUnits(process.env.AMOUNT || "1000", 6);
  const from = process.env.FROM ? await hre.ethers.getSigner(process.env.FROM) : deployer;
  const to = process.env.TO || (await recipient.getAddress());

  console.log("==================================================");
  console.log("USDT 转账交易");
  console.log("==================================================");
  console.log(`合约地址: ${contractAddress}`);
  console.log(`发送方:   ${from.address}`);
  console.log(`接收方:   ${to}`);
  console.log(`金额:     ${hre.ethers.formatUnits(amount, 6)} USDT`);
  console.log("");

  const USDT = await hre.ethers.getContractFactory("TetherToken");
  const usdt = USDT.attach(contractAddress);

  // 查看转账前余额
  const balanceBefore = await usdt.balanceOf(from.address);
  const toBalanceBefore = await usdt.balanceOf(to);
  console.log(`发送方余额(前): ${hre.ethers.formatUnits(balanceBefore, 6)} USDT`);
  console.log(`接收方余额(前): ${hre.ethers.formatUnits(toBalanceBefore, 6)} USDT`);
  console.log("");

  // 执行转账
  console.log("⏳ 正在发送交易...");
  const tx = await usdt.connect(from).transfer(to, amount);
  console.log(`交易哈希: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log("");
  console.log(`✅ 交易已上链！`);
  console.log(`   区块号:   ${receipt.blockNumber}`);
  console.log(`   Gas 消耗: ${receipt.gasUsed.toString()} units`);
  console.log(`   交易状态: ${receipt.status === 1 ? "成功" : "失败"}`);
  console.log("");

  // 查看转账后余额
  const balanceAfter = await usdt.balanceOf(from.address);
  const toBalanceAfter = await usdt.balanceOf(to);
  console.log(`发送方余额(后): ${hre.ethers.formatUnits(balanceAfter, 6)} USDT (Δ -${hre.ethers.formatUnits(amount, 6)})`);
  console.log(`接收方余额(后): ${hre.ethers.formatUnits(toBalanceAfter, 6)} USDT (Δ +${hre.ethers.formatUnits(amount, 6)})`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
