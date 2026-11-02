import { ethers } from "hardhat";

/**
 * 本地全流程验证（不依赖任何测试网、私钥、测试币）
 *
 * 在同一个 hardhat 节点上模拟两条链：
 *   源链设施: MockERC20 + MockDeBridgeGate(src) + MockCallProxy(src) + TokenSender
 *   目标链设施: MockDeBridgeGate(dst) + MockCallProxy(dst) + TokenReceiver
 *
 * 用法: npx hardhat run scripts/testnet/local-e2e.ts
 */

const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const [deployer, user] = await ethers.getSigners();
  const results: [string, boolean][] = [];
  const check = (name: string, ok: boolean) => {
    results.push([name, ok]);
    console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${name}`);
  };

  console.log("部署者:", deployer.address);
  console.log("用户  :", user.address);

  // ============ 源链设施 ============
  console.log("\n[1] 部署源链设施");
  const token: any = await (await ethers.getContractFactory("MockERC20")).deploy("Mock", "MOCK");
  await token.waitForDeployment();

  const gateSrc: any = await (await ethers.getContractFactory("MockDeBridgeGate")).deploy(ZERO, 0);
  await gateSrc.waitForDeployment();
  const cpSrc: any = await (await ethers.getContractFactory("MockCallProxy")).deploy(
    await gateSrc.getAddress()
  );
  await cpSrc.waitForDeployment();
  await (await gateSrc.setCallProxy(await cpSrc.getAddress())).wait();

  const chainId = (await ethers.provider.getNetwork()).chainId;

  const sender: any = await (
    await ethers.getContractFactory("TokenSender")
  ).deploy(await gateSrc.getAddress(), await token.getAddress(), chainId);
  await sender.waitForDeployment();

  // ============ 目标链设施 ============
  console.log("\n[2] 部署目标链设施");
  const gateDst: any = await (await ethers.getContractFactory("MockDeBridgeGate")).deploy(ZERO, 0);
  await gateDst.waitForDeployment();
  const cpDst: any = await (await ethers.getContractFactory("MockCallProxy")).deploy(
    await gateDst.getAddress()
  );
  await cpDst.waitForDeployment();
  await (await gateDst.setCallProxy(await cpDst.getAddress())).wait();

  const receiver: any = await (
    await ethers.getContractFactory("TokenReceiver")
  ).deploy(await gateDst.getAddress(), chainId);
  await receiver.waitForDeployment();

  console.log("  TokenSender  :", await sender.getAddress());
  console.log("  TokenReceiver:", await receiver.getAddress());

  // ============ 建立信任 ============
  console.log("\n[3] 设置信任关系");
  // 源链 sender 的 _receiver 必须是目标链 TokenReceiver 合约地址
  await (await sender.setTrustedReceiver(await receiver.getAddress())).wait();
  await (await receiver.setTrustedSender(await sender.getAddress())).wait();
  check(
    "sender.trustedReceiver 已设置",
    (await sender.trustedReceiver()).toLowerCase() ===
      (await receiver.getAddress()).toLowerCase()
  );

  // ============ 发起跨链 ============
  console.log("\n[4] 用户发起跨链转账");
  const amount = ethers.parseEther("500");
  await (await token.mint(user.address, ethers.parseEther("1000"))).wait();
  await (await token.connect(user).approve(await sender.getAddress(), amount)).wait();

  const bridgeTx = await sender.connect(user).bridgeToken(amount, user.address, { value: 0 });
  const receipt = await bridgeTx.wait();

  let submissionId = "";
  for (const log of receipt!.logs) {
    try {
      const parsed = sender.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "CrossChainTransfer") submissionId = parsed.args.submissionId;
    } catch {
      /* ignore */
    }
  }
  check("产生 CrossChainTransfer 事件", submissionId !== "");
  check("源代币已被锁定", (await token.balanceOf(await sender.getAddress())) === amount);

  const submission = await gateSrc.getSubmission(submissionId);
  check("chainIdFrom 正确", submission.chainIdFrom === chainId);
  check("nativeSender = TokenSender", submission.nativeSender === (await sender.getAddress()).toLowerCase());
  check("autoParams.data 是完整 calldata", submission.data.startsWith("0x") && submission.data.length > 10);

  // ============ 目标链执行 ============
  console.log("\n[5] 目标链执行跨链消息");
  await (
    await gateDst.executeSubmission(
      submissionId,
      submission.chainIdFrom,
      submission.nativeSender,
      submission.receiver,
      submission.flags,
      submission.data
    )
  ).wait();

  check("目标链余额已铸造", (await receiver.balanceOf(user.address)) === amount);
  check("totalSupply 已增加", (await receiver.totalSupply()) === amount);

  // ============ 负向用例 ============
  console.log("\n[6] 负向用例（安全校验）");
  let reverted = false;
  try {
    // 非 CallProxy 直接调用应失败
    await (await receiver.receiveCrossChainMessage(user.address, 1)).wait();
  } catch {
    reverted = true;
  }
  check("非 CallProxy 直接调用被拒绝", reverted);

  reverted = false;
  try {
    await (
      await gateDst.executeSubmission(
        submissionId,
        submission.chainIdFrom,
        submission.nativeSender,
        submission.receiver,
        submission.flags,
        submission.data
      )
    ).wait();
  } catch {
    reverted = true;
  }
  check("重复执行被拒绝", reverted);

  reverted = false;
  try {
    // 伪造来源：nativeSender 不是受信任的 Sender
    await (
      await gateDst.executeSubmission(
        ethers.keccak256("0x1234"),
        submission.chainIdFrom,
        user.address,
        submission.receiver,
        submission.flags,
        submission.data
      )
    ).wait();
  } catch {
    reverted = true;
  }
  check("不可信 nativeSender 被拒绝", reverted);

  // ============ 汇总 ============
  const failed = results.filter(([, ok]) => !ok);
  console.log("\n────────────────────────────────────────────");
  console.log(`共 ${results.length} 项断言，通过 ${results.length - failed.length} 项`);
  if (failed.length > 0) {
    for (const [name] of failed) console.log("  失败:", name);
    process.exitCode = 1;
    throw new Error("本地全流程验证未通过");
  }
  console.log("本地全流程验证通过");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
