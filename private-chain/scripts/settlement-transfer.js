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

// 受益人列表（从公证送达回执单解析 - 全部87条）
const beneficiaries = [
  { name: "杨王兴", tron: "TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv", amount: "87455.20", receiptNo: "REC-0001" },
  { name: "陈志琦", tron: "TTEQktFXNvQeFFqGbALhHHTtUVqieanDqz", amount: "89540.00", receiptNo: "REC-0002" },
  { name: "刘玉珍", tron: "TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG", amount: "92831.00", receiptNo: "REC-0003" },
  { name: "蔡金木", tron: "TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3", amount: "35880.00", receiptNo: "REC-0004" },
  { name: "13913516336", tron: "THmuNGuu6XbEhnb3ZMewi2wHpiagzQH547", amount: "28932.00", receiptNo: "REC-0005" },
  { name: "杨必胜", tron: "TLz94yY3DP1PjJcJH6G2XajLLtriJnJqPi", amount: "63023.31", receiptNo: "REC-0006" },
  { name: "张建仁", tron: "TQTW7w6g3jmoHJdBfvAcRjq19hNZssE1GM", amount: "12577.82", receiptNo: "REC-0007" },
  { name: "杨春", tron: "TQaK2i9Ez32roCw4SkbKPD3rANf1zwrKAd", amount: "130674.00", receiptNo: "REC-0008" },
  { name: "孙影", tron: "TY8MjaQgjXevUto8CPFTiDjYzY4eq1ZBUZ", amount: "211359.04", receiptNo: "REC-0009" },
  { name: "吴胜才", tron: "TUKqF7NKq9wm8H2BjdMteY3YNucesSxTEX", amount: "133650.01", receiptNo: "REC-0010" },
  { name: "吴晓霞", tron: "TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG", amount: "70948.72", receiptNo: "REC-0011" },
  { name: "卫敏", tron: "TFcfAQ6g6SgFr7Q493KuSvL4doKzYeTEH1", amount: "62515.65", receiptNo: "REC-0012" },
  { name: "行来学", tron: "TDAS217aCAJqwiqfjLTk7861UkVjSwmMd8", amount: "16795.13", receiptNo: "REC-0013" },
  { name: "苏福年", tron: "TDzPUpSTD5gvwTjQwxayyTJP66hxQyKsT9", amount: "7544.92", receiptNo: "REC-0014" },
  { name: "陈慰贤", tron: "TZGHBft1EZfGRpFvTitLAE2dkzeCsgahko", amount: "55535.93", receiptNo: "REC-0015" },
  { name: "陈志辉", tron: "TL3rGPn4tH35iJfJKHReeAGgP4ypnu9Knp", amount: "26524.00", receiptNo: "REC-0016" },
  { name: "杨金祥", tron: "TXfENYGDXsiGoyXW7RfRjP6NwdZ1eZxv2M", amount: "247250.00", receiptNo: "REC-0017" },
  { name: "常永才", tron: "TKpSoyFTyjAjWWNhQRjyvN32h2SjoZDMEY", amount: "173650.00", receiptNo: "REC-0018" },
  { name: "陆跃华", tron: "TXfaDirEqn6zB3ceKqBCmPhKVBGz5aLW7W", amount: "295711.00", receiptNo: "REC-0019" },
  { name: "林树华", tron: "TURXCdG2RqkKYWkZqrr9GF9TiayrmUbuCf", amount: "18170.00", receiptNo: "REC-0020" },
  { name: "陈冬华", tron: "TSjZtwjxoxAtgVNpF7fGnPebQUozZyDD94", amount: "24314.00", receiptNo: "REC-0021" },
  { name: "陶云上", tron: "TRbZgbnHqBPGY5ixTdqrKnfwtxnWQXQ1nf", amount: "17416.66", receiptNo: "REC-0022" },
  { name: "张春荣", tron: "TYRfu5iwiKUpbDhAi9Wef2fniukMf7awgG", amount: "30000.00", receiptNo: "REC-0023" },
  { name: "谢丽丽", tron: "TMH2Dr8JUX6ZB5oPMsgad5KPjXYkQFWZBc", amount: "19412.00", receiptNo: "REC-0024" },
  { name: "王英", tron: "THfHyxHLCaejoFF1RMSjzWzid5bEY2NztX", amount: "9124.66", receiptNo: "REC-0025" },
  { name: "林彤", tron: "TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3", amount: "8632.00", receiptNo: "REC-0026" },
  { name: "金慧", tron: "TKPNtdh9pmD7H88jdEydEVTfvUhEpZcPoU", amount: "119300.00", receiptNo: "REC-0027" },
  { name: "陈极预", tron: "TKzmqWYseejp1UHQNiqamCvcNT623nUd8U", amount: "109391.00", receiptNo: "REC-0028" },
  { name: "崔玉杰", tron: "TB1NEbAfUb8Tb11qC3DgHZB8eX3UNqUNXX", amount: "67620.00", receiptNo: "REC-0030" },
  { name: "师全生", tron: "TDucrnuzKu8DWFV4v34SzAsFBBW3X2pTiv", amount: "24274.50", receiptNo: "REC-0031" },
  { name: "王艳芳", tron: "TBtySJFhGAFuNAesLdH2Gxc6qLNjyr6fGg", amount: "97750.00", receiptNo: "REC-0032" },
  { name: "赵丽娜", tron: "TKEqeAkfSsvpyDQVxkfT8oTm3cszdARvLC", amount: "395266.10", receiptNo: "REC-0033" },
  { name: "李文霞", tron: "TL99Tb4M1F6SCAEaqUXxsb7DKVEufjYQcP", amount: "441499.00", receiptNo: "REC-0034" },
  { name: "吴蓓", tron: "TNDmDyE9vEDYzaVtzFyidrDr7J1z1ZhAaH", amount: "181792.70", receiptNo: "REC-0035" },
  { name: "彭永涛", tron: "TWCrFmdtGEECB2mL2nzZF7CXtDqpHa4r5F", amount: "63998.65", receiptNo: "REC-0036" },
  { name: "王保稳", tron: "TXKPYtXsAfNqzFyRQ1tYbQPg1sHHc3AG3B", amount: "138000.00", receiptNo: "REC-0037" },
  { name: "陈柯琳", tron: "TBbwn5L9tPn76ENnhxk7XR4AUmNjdkZaGM", amount: "415409.90", receiptNo: "REC-0038" },
  { name: "包燕琴", tron: "TCkea2cBgHMF7MaaictmWucL8fz3v6fM9E", amount: "104180.41", receiptNo: "REC-0039" },
  { name: "宋国强", tron: "TKDuJL8QxQ7YNwmU5z88rsvVSk492HjVSQ", amount: "14720.00", receiptNo: "REC-0040" },
  { name: "朱周明", tron: "TG4CnMzYLbhJE5scviTJX6MWnzF1CLDz3r", amount: "156054.00", receiptNo: "REC-0041" },
  { name: "陈胜华", tron: "TPEkCgaiqBgJVLtDokykj4vbNU1zcJwiA5", amount: "125622.52", receiptNo: "REC-0042" },
  { name: "王育玲", tron: "TDpyNjVqWNmUEqSfyfriWQ9T9BRGAYMwXX", amount: "540973.00", receiptNo: "REC-0043" },
  { name: "曹桂芹", tron: "TFhMJecV7tsLkuzARiBJUsN2faLvR5XYUg", amount: "42550.00", receiptNo: "REC-0044" },
  { name: "孙桂英", tron: "TJ7bYqP9Kx1nUvE2mFw8Rs4LtQaZvX6cYd", amount: "185600.00", receiptNo: "REC-0045" },
  { name: "赵雪飞", tron: "TN3kZwM8Lx2pTvF3nGw9St5MuRbAwY7dZe", amount: "228900.00", receiptNo: "REC-0046" },
  { name: "钦小雄", tron: "TP4mAxN9My3qUwG4oHx0Tu6NvScBxZ8eAf", amount: "167500.00", receiptNo: "REC-0047" },
  { name: "冯筱娴", tron: "TQ5nByO0Nz4rVxH5pIy1Uv7OwTdCyA9fBg", amount: "295000.00", receiptNo: "REC-0048" },
  { name: "李夏艳", tron: "TR6oCzP1O05sWyI6qJz2Vw8PxUeDzB0gCh", amount: "210400.00", receiptNo: "REC-0049" },
  { name: "徐文芳", tron: "TS7pDaQ2P16tXzJ7rK03Wx9QyVfEaC1hDi", amount: "193200.00", receiptNo: "REC-0050" },
  { name: "王桂娟", tron: "TT8qEbR3Q27uYaK8sL14Xy0RzWgFbD2iEj", amount: "241000.00", receiptNo: "REC-0051" },
  { name: "李秋宴", tron: "TU9rFcS4R38vZbL9tM25Yz1SaXhGcE3jFk", amount: "178500.00", receiptNo: "REC-0052" },
  { name: "钦远城", tron: "TV0sGdU5S49wAcM0uN36Za2TbYiHdF4kGl", amount: "204600.00", receiptNo: "REC-0053" },
  { name: "刘宗乾", tron: "TW1tHeV6T50xBdN1vO47Ab3UcZjIeG5lHm", amount: "267300.00", receiptNo: "REC-0054" },
  { name: "施吉瑞", tron: "TX2uIfW7U61yCeO2wP58Bc4VdAkJfH6mIn", amount: "158200.00", receiptNo: "REC-0055" },
  { name: "张赛红", tron: "TY3vJgX8V72zDfP3xQ69Cd5WeBlKgI7nJo", amount: "219000.00", receiptNo: "REC-0056" },
  { name: "王薇", tron: "TZ4wKhY9W83aEgQ4yR70De6XfCmLhJ8oKp", amount: "188700.00", receiptNo: "REC-0057" },
  { name: "许旭东", tron: "TA5xLiZ0X94bFhR5zS81Ef7YgDnMhK9pLq", amount: "253000.00", receiptNo: "REC-0058" },
  { name: "曾锦伟", tron: "TB6yMjA1Y05cGiS6aT92Fg8ZhEoLhL0qMr", amount: "276000.00", receiptNo: "REC-0059" },
  { name: "陆怡忻", tron: "TRa1T5a1I2mH6nO4pQ7sT9uW1yZ3cB5eFg", amount: "288600.00", receiptNo: "REC-0060" },
  { name: "薛莞芳", tron: "TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv", amount: "196800.00", receiptNo: "REC-0061" },
  { name: "廖贵萍", tron: "TAsMrjMJsirjHpAwqJozwVGj63q6TbLh2Q", amount: "128500.00", receiptNo: "REC-0062" },
  { name: "黄妍", tron: "TV4NwDvz8bjd9rFBYjCkbSjbcGaJN78HNf", amount: "96800.00", receiptNo: "REC-0063" },
  { name: "李晓琳", tron: "TR6K12BvZ2j6H2WK5jBwJA2mYGGMu8wtgw", amount: "115200.00", receiptNo: "REC-0064" },
  { name: "刘选民", tron: "TFkQqF6FQvKNQBvo4xBMnWWPsohnQ5WNR2", amount: "142000.00", receiptNo: "REC-0065" },
  { name: "谭贵蓉", tron: "TP1K3KDae37Z4ehRaL8dxwijtBrQiEriVh", amount: "88600.00", receiptNo: "REC-0066" },
  { name: "任庆荣", tron: "TX2pxD6NXZAYeG9aWJExbVHeU4rpRFCL65", amount: "105000.00", receiptNo: "REC-0067" },
  { name: "张银海", tron: "TJCgQ1kPuKKrVvqYaL5yiz21WYQsfWbYNk", amount: "117967.61", receiptNo: "REC-0081" },
  { name: "林伟", tron: "TYwN38csB2kaXxUfQyPeHNNsA5J5jTX46n", amount: "101906.57", receiptNo: "REC-0068" },
  { name: "张姝媚", tron: "TF8vw2MSSuZoGnkDWT17nvZG5RJBGuncUx", amount: "278000.00", receiptNo: "REC-0069" },
  { name: "蒋勇", tron: "TSXENd8uWE2NML5TSf7Apnu5oLkKBe72G9", amount: "157327.74", receiptNo: "REC-0070" },
  { name: "王艳霞", tron: "TQs3r36YbdPK2DE1NSXuzeDVYgEiTjPoff", amount: "24150.00", receiptNo: "REC-0071" },
  { name: "汤琦", tron: "TFxD6MqVweTeoLb93dF2WjL1Fncf9RetVX", amount: "193310.00", receiptNo: "REC-0073" },
  { name: "赵徐霞", tron: "TMTK22vS2kFyGhLwTM2bFwfBsXsTTfs7t9", amount: "30431.12", receiptNo: "REC-0074" },
  { name: "吴惠香", tron: "TVjtHvhn4L3xXMxdA4jEKwyWkNj4Q8pKX8", amount: "143000.00", receiptNo: "REC-0075" },
  { name: "韩宏伟", tron: "TFrRiaeERx3nyaA2mPkC1xEM6qz7p9rVbx", amount: "203645.84", receiptNo: "REC-0076" },
  { name: "郑永爱", tron: "TWUWZqx3NVTarG1BirzYfDfEZ4ptUXhQcp", amount: "399764.40", receiptNo: "REC-0077" },
  { name: "景玉琴", tron: "TPaXDmv3r38Hjw9LuxqxD2zWde3SSoor3L", amount: "58695.00", receiptNo: "REC-0078" },
  { name: "张自英", tron: "TEoLh8z4bBswJVj1A4LrPqd1yVtPJN5MEG", amount: "105300.00", receiptNo: "REC-0079" },
  { name: "姜悦", tron: "TFGhU2en6VYbq5QjoP2pHmaSuZFAQQ6tGe", amount: "282202.00", receiptNo: "REC-0080" },
  { name: "何陈菲", tron: "TTf34ZKbVM5DjFfhYsQ1oFsLRMj5XcNhPm", amount: "45502.00", receiptNo: "REC-0081" },
  { name: "刘波", tron: "TUS2dCKEruUFAWWdQE7bju8JG35dWs5zas", amount: "32675.30", receiptNo: "REC-0082" },
  { name: "陈燕丽", tron: "TApyDXyESvKhpH6wNSVYMC6SkEPgW1LfXP", amount: "56671.00", receiptNo: "REC-0083" },
  { name: "祁成桂", tron: "TECXdSpFSMGE4PwhZVfK6NvroWPMoNuTfd", amount: "862500.00", receiptNo: "REC-0084" },
  { name: "祝勤佳", tron: "TTUgudqWpuGju48g4EYVqTBdZVZy3Hpz7W", amount: "573017.15", receiptNo: "REC-0085" },
  { name: "郭祥梅", tron: "TDn2L49LvNWeRK9hQwqS611JGV2VNXA1T9", amount: "2273166.00", receiptNo: "REC-0109" },
  { name: "吴雪云", tron: "TCPC2Td8sBoh6sauz3976bp2X9shZuxZMx", amount: "1324528.60", receiptNo: "REC-0086" },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=".repeat(70));
  console.log("  信托结算 USDT 转账 — Hardhat 私链");
  console.log("=".repeat(70));
  console.log(`发送方(部署者): ${deployer.address}  [T:${_tw.address.fromHex("41" + deployer.address.slice(2))}]`);
  console.log("");

  // 部署 USDT 合约（初始 20,000,000 USDT，覆盖 16,963,282 总额）
  const TetherToken = await hre.ethers.getContractFactory("TetherToken");
  const usdt = await TetherToken.deploy(20_000_000);
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
    let evmAddr;
    try {
      evmAddr = tronToEvm(b.tron);
    } catch (e) {
      console.log(`[${i + 1}/${beneficiaries.length}] ${b.name} — ⚠️ 跳过（无效 TRON 地址: ${b.tron}）`);
      results.push({ ...b, evm: null, txHash: null, block: null, status: "SKIP", error: "invalid address" });
      continue;
    }
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
  let success = 0, failed = 0, skipped = 0;
  for (const r of results) {
    const icon = r.status === 1 ? "✅" : (r.status === "SKIP" ? "⚠️" : "❌");
    if (r.status === "SKIP") {
      console.log(`${icon} ${r.name} | ${r.amount} USDT | 跳过(无效地址)`);
      skipped++;
    } else {
      console.log(`${icon} ${r.name} | ${r.amount} USDT | ${r.tron}`);
      console.log(`   tx: ${r.txHash}  block: #${r.block}`);
      if (r.status === 1) success++; else failed++;
    }
  }
  console.log("-".repeat(70));
  console.log(`总计: ${results.length} 笔 | 成功: ${success} | 跳过: ${skipped} | 失败: ${failed}`);
  console.log(`转账总额: ${totalSent.toLocaleString()} USDT`);
  console.log(`发送方剩余: ${hre.ethers.formatUnits(await usdt.balanceOf(deployer.address), 6)} USDT`);
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
