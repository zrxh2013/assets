// scripts/settlement-transfer.js
// 在 Hardhat 私链上向所有受益人转账 USDT 并存证
const hre = require("hardhat");
const TronWeb = require("tronweb").TronWeb;

const _tw = new TronWeb({ fullHost: "https://api.trongrid.io" });

// TRON 地址转 EVM 地址
function tronToEvm(tronAddr) {
  const hex = _tw.address.toHex(tronAddr); // 41 + 20bytes
  return "0x" + hex.slice(2); // 去掉 41 前缀
}

// 受益人列表（从公证送达回执单解析）
const beneficiaries = [
  { name: "杨王兴", tron: "TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv", amount: "87455.20", contractNo: "PTAH-TR-2026-295205", receiptNo: "PTAH-NOTARY-REC-202609-0001" },
  { name: "受益人-0002", tron: "TTEQktFXNvQeFFqGbALhHHTtUVqieanDqz", amount: "89540.00", contractNo: "PTAH-TR-2026-UNKNOWN-0002", receiptNo: "PTAH-NOTARY-REC-202609-0002" },
  { name: "刘玉珍", tron: "TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG", amount: "92831.00", contractNo: "PTAH-TR-2026-206422", receiptNo: "PTAH-NOTARY-REC-202609-0003" },
  { name: "蔡金木", tron: "TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3", amount: "35880.00", contractNo: "PTAH-TR-2026-669733", receiptNo: "PTAH-NOTARY-REC-202609-0004" },
  { name: "受益人-13913516336", tron: "THmuNGuu6XbEhnb3ZMewi2wHpiagzQH547", amount: "28932.00", contractNo: "PTAH-TR-2026-353464", receiptNo: "PTAH-NOTARY-REC-202609-0005" },
  { name: "杨必胜", tron: "TLz94yY3DP1PjJcJH6G2XajLLtriJnJqPi", amount: "63023.31", contractNo: "PTAH-TR-2026-459420", receiptNo: "PTAH-NOTARY-REC-202609-0006" },
  { name: "张建仁", tron: "TQTW7w6g3jmoHJdBfvAcRjq19hNZssE1GM", amount: "12577.82", contractNo: "PTAH-TR-2026-398313", receiptNo: "PTAH-NOTARY-REC-202609-0007" },
  { name: "杨春", tron: "TQaK2i9Ez32roCw4SkbKPD3rANf1zwrKAd", amount: "130674.00", contractNo: "PTAH-TR-2026-768463", receiptNo: "PTAH-NOTARY-REC-202609-0008" },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=".repeat(70));
  console.log("  信托结算 USDT 转账 — Hardhat 私链");
  console.log("=".repeat(70));
  console.log(`发送方(部署者): ${deployer.address}  [T:${_tw.address.fromHex("41" + deployer.address.slice(2))}]`);
  console.log("");

  // 部署 USDT 合约（初始 1,000,000 USDT）
  const TetherToken = await hre.ethers.getContractFactory("TetherToken");
  const usdt = await TetherToken.deploy(1_000_000);
  await usdt.waitForDeployment();
  const usdtAddr = await usdt.getAddress();
  console.log(`USDT 合约已部署: ${usdtAddr}`);
  console.log(`USDT 合约 TRON: ${_tw.address.fromHex("41" + usdtAddr.slice(2))}`);
  console.log(`发送方 USDT 余额: ${hre.ethers.formatUnits(await usdt.balanceOf(deployer.address), 6)} USDT`);
  console.log("");

  let totalSent = 0;
  const results = [];

  for (let i = 0; i < beneficiaries.length; i++) {
    const b = beneficiaries[i];
    const evmAddr = tronToEvm(b.tron);
    const amount = hre.ethers.parseUnits(b.amount, 6);

    console.log(`[${i + 1}/${beneficiaries.length}] ${b.name}`);
    console.log(`  TRON: ${b.tron}`);
    console.log(`  EVM:  ${evmAddr}`);
    console.log(`  金额: ${b.amount} USDT`);

    // 转账前余额
    const balBefore = await usdt.balanceOf(evmAddr);

    // 执行转账
    const tx = await usdt.connect(deployer).transfer(evmAddr, amount);
    const receipt = await tx.wait();

    // 转账后余额
    const balAfter = await usdt.balanceOf(evmAddr);

    console.log(`  tx: ${tx.hash}`);
    console.log(`  区块: #${receipt.blockNumber}  gasUsed: ${receipt.gasUsed.toString()}`);
    console.log(`  状态: ${receipt.status === 1 ? "✅ 成功" : "❌ 失败"}`);
    console.log(`  余额变化: ${hre.ethers.formatUnits(balBefore, 6)} → ${hre.ethers.formatUnits(balAfter, 6)} USDT`);
    console.log("");

    totalSent += parseFloat(b.amount);
    results.push({ ...b, evm: evmAddr, txHash: tx.hash, block: receipt.blockNumber, status: receipt.status });
  }

  // 汇总
  console.log("=".repeat(70));
  console.log("转账汇总");
  console.log("-".repeat(70));
  let success = 0, failed = 0;
  for (const r of results) {
    const icon = r.status === 1 ? "✅" : "❌";
    console.log(`${icon} ${r.name} | ${r.amount} USDT | ${r.tron}`);
    console.log(`   tx: ${r.txHash}  block: #${r.block}`);
    if (r.status === 1) success++; else failed++;
  }
  console.log("-".repeat(70));
  console.log(`总计: ${results.length} 笔 | 成功: ${success} | 失败: ${failed}`);
  console.log(`转账总额: ${totalSent.toLocaleString()} USDT`);
  console.log(`发送方剩余: ${hre.ethers.formatUnits(await usdt.balanceOf(deployer.address), 6)} USDT`);
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
