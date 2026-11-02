import { ethers } from "ethers";
import {
  loadConfig,
  saveConfig,
  requireEnv,
  readArtifact,
  createTronWeb,
  installHttpTransport,
  tronToEvmAddress,
  waitTronTransaction,
  logStep,
} from "./lib/common";

/**
 * 端到端验证：Amoy 锁定 → 跨链消息 → Nile 铸造
 *
 * 真实 deBridge 的跨链消息由验证者签名后 claim；这里用 MockDeBridgeGate.executeSubmission
 * 扮演中继者，把 Amoy 上的 submission 数据搬运到 Nile 执行，从而在测试网跑通全流程。
 *
 * 用法: npx ts-node scripts/testnet/e2e.ts
 * 可选环境变量: BRIDGE_AMOUNT（默认 100 tMOCK）
 */

async function main() {
  installHttpTransport();
  const config = loadConfig();
  const { amoy, nile } = config.contracts;

  if (!amoy.sender || !nile.receiver) throw new Error("请先完成部署并设置信任关系");

  const amount = ethers.parseEther(process.env.BRIDGE_AMOUNT || "100");

  // ============ 步骤 1: Amoy 发起跨链 ============
  logStep("步骤 1/4  Amoy: approve + bridgeToken");
  const provider = new ethers.JsonRpcProvider(config.chains.amoy.rpcUrl);
  const wallet = new ethers.Wallet(requireEnv("PRIVATE_KEY"), provider);

  // 接收者使用 Tron 部署者账户（其 20 字节 EVM 风格地址）
  const tronWeb = createTronWeb(config.chains.nile.rpcUrl);
  const tronPrivateKey = requireEnv("TRON_PRIVATE_KEY");
  const recipientBase58: string = tronWeb.address.fromPrivateKey(tronPrivateKey);
  const recipientBytes20 = tronToEvmAddress(tronWeb, recipientBase58);

  const tokenAbi = readArtifact("MockERC20").abi;
  const token = new ethers.Contract(amoy.token, tokenAbi, wallet);
  const sender = new ethers.Contract(amoy.sender, readArtifact("TokenSender").abi, wallet);
  const gate = new ethers.Contract(amoy.gate, readArtifact("MockDeBridgeGate").abi, wallet);

  const tokenBalance = await token.balanceOf(wallet.address);
  console.log("  发起者        :", wallet.address);
  console.log("  代币余额      :", ethers.formatEther(tokenBalance), "tMOCK");
  console.log("  跨链数量      :", ethers.formatEther(amount), "tMOCK");
  console.log("  接收者(Tron)  :", recipientBase58);
  if (tokenBalance < amount) throw new Error("tMOCK 余额不足");

  const approveTx = await token.approve(amoy.sender, amount);
  await approveTx.wait();
  console.log("  approve tx    :", approveTx.hash);

  const fee = await gate.globalFixedNativeFee();
  const bridgeTx = await sender.bridgeToken(amount, recipientBytes20, { value: fee });
  const receipt = await bridgeTx.wait();
  console.log("  bridgeToken tx:", bridgeTx.hash);
  console.log("  gas used      :", receipt.gasUsed.toString());

  // 解析 submissionId
  let submissionId = "";
  for (const log of receipt.logs) {
    try {
      const parsed = sender.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "CrossChainTransfer") {
        submissionId = parsed.args.submissionId;
      }
    } catch {
      /* 不是本合约的事件，忽略 */
    }
  }
  if (!submissionId) throw new Error("未在回执中找到 CrossChainTransfer 事件");

  const submission = await gate.getSubmission(submissionId);
  console.log("  submissionId  :", submissionId);
  console.log("  chainIdFrom   :", submission.chainIdFrom.toString());
  console.log("  chainIdTo     :", submission.chainIdTo.toString());
  console.log("  nativeSender  :", submission.nativeSender);
  console.log("  receiver      :", submission.receiver);
  console.log("  flags         :", submission.flags.toString());

  // ============ 步骤 2: 读取 Nile 执行前余额 ============
  logStep("步骤 2/4  Nile: 读取执行前状态");
  const tronWebSigner = createTronWeb(config.chains.nile.rpcUrl, tronPrivateKey);
  const receiverContract = await tronWebSigner.contract().at(nile.receiver);
  const gateNile = await tronWebSigner.contract().at(nile.gate);

  const balanceBefore = BigInt(await receiverContract.balanceOf(recipientBase58).call());
  const supplyBefore = BigInt(await receiverContract.totalSupply().call());
  console.log("  balanceOf     :", balanceBefore.toString());
  console.log("  totalSupply   :", supplyBefore.toString());

  // ============ 步骤 3: Nile 执行跨链消息 ============
  logStep("步骤 3/4  Nile: executeSubmission（模拟 deBridge claim）");
  const execTxid: string = await gateNile
    .executeSubmission(
      submissionId,
      submission.chainIdFrom,
      submission.nativeSender,
      submission.receiver,
      submission.flags,
      submission.data
    )
    .send({ feeLimit: 500_000_000, callValue: 0 });

  const info = await waitTronTransaction(tronWebSigner, execTxid, "executeSubmission");
  console.log("  tx            :", execTxid);
  console.log("  receipt       :", info.receipt?.result ?? info.result);

  // ============ 步骤 4: 断言目标链铸造结果 ============
  logStep("步骤 4/4  Nile: 校验铸造结果");
  const balanceAfter = BigInt(await receiverContract.balanceOf(recipientBase58).call());
  const supplyAfter = BigInt(await receiverContract.totalSupply().call());

  console.log("  balanceOf     :", balanceBefore.toString(), "->", balanceAfter.toString());
  console.log("  totalSupply   :", supplyBefore.toString(), "->", supplyAfter.toString());

  const delta = balanceAfter - balanceBefore;
  const assertions: [string, boolean][] = [
    ["目标链余额增加 = 跨链数量", delta === amount],
    ["总供应量增加 = 跨链数量", supplyAfter - supplyBefore === amount],
    ["提交未被重复执行", (await gateNile.executed(submissionId).call()) === true],
  ];

  console.log("");
  let allPass = true;
  for (const [name, ok] of assertions) {
    console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${name}`);
    if (!ok) allPass = false;
  }

  config.e2e = {
    submissionId,
    recipient: recipientBase58,
    amount: ethers.formatEther(amount),
  };
  saveConfig(config);

  console.log("\n  浏览器:");
  console.log(`  Amoy sender  : ${config.chains.amoy.explorer}/address/${amoy.sender}`);
  console.log(`  Nile receiver: ${config.chains.nile.explorer}/#/contract/${nile.receiver}`);
  console.log(`  Nile claim tx: ${config.chains.nile.explorer}/#/transaction/${execTxid}`);

  if (!allPass) throw new Error("端到端验证未通过");
  logStep("端到端验证通过");
}

main().catch((error) => {
  console.error("\n❌ 验证失败:", error.shortMessage || error.message || error);
  process.exit(1);
});
