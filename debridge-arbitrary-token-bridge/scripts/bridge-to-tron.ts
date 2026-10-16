import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * 发起跨链转账：将 Polygon 上的自定义代币桥接到 Tron
 *
 * 用法: npx ts-node scripts/bridge-to-tron.ts
 * 环境变量:
 *   PRIVATE_KEY        - 用户私钥
 *   AMOUNT             - 转账数量（以最小单位计，如 18 位精度的代币传 1000000000000000000）
 *   TRON_RECEIVER      - Tron 接收者地址（Base58 格式，如 TXXX...）
 */

async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8")
  );

  const privateKey = process.env.PRIVATE_KEY;
  const amount = process.env.AMOUNT;
  const tronReceiver = process.env.TRON_RECEIVER;

  if (!privateKey) throw new Error("PRIVATE_KEY 环境变量未设置");
  if (!amount) throw new Error("AMOUNT 环境变量未设置");
  if (!tronReceiver) throw new Error("TRON_RECEIVER 环境变量未设置");

  if (!config.contracts.sender) throw new Error("请先部署 TokenSender 合约");

  const provider = new ethers.JsonRpcProvider(config.chains.polygon.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("用户地址:", wallet.address);
  console.log("转账数量:", amount);
  console.log("Tron 接收者:", tronReceiver);

  // 读取合约 ABI
  const senderArtifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "TokenSender.json"),
      "utf-8"
    )
  );

  const senderContract = new ethers.Contract(
    config.contracts.sender,
    senderArtifact.abi,
    wallet
  );

  // 1. 读取源代币地址
  const sourceToken = await senderContract.sourceToken();
  console.log("源代币:", sourceToken);

  // 2. 获取协议费用
  const deBridgeGate = new ethers.Contract(
    config.chains.polygon.deBridgeGate,
    ["function globalFixedNativeFee() view returns (uint256)"],
    provider
  );
  const protocolFee = await deBridgeGate.globalFixedNativeFee();
  console.log("协议费用:", ethers.formatEther(protocolFee), "MATIC");

  // 3. 检查并 approve 代币
  const erc20 = new ethers.Contract(
    sourceToken,
    ["function approve(address, uint256) returns (bool)", "function allowance(address, address) view returns (uint256)"],
    wallet
  );

  const allowance = await erc20.allowance(wallet.address, config.contracts.sender);
  if (allowance < BigInt(amount)) {
    console.log("\n正在 approve 代币...");
    const approveTx = await erc20.approve(config.contracts.sender, amount);
    await approveTx.wait();
    console.log("✅ Approve 成功:", approveTx.hash);
  }

  // 4. 将 Tron 地址转换为 bytes（Base58 字符串的 UTF-8 编码）
  //    Tron 地址是 34 字符的 Base58 字符串
  const receiverBytes = ethers.toUtf8Bytes(tronReceiver);
  console.log("Receiver bytes:", ethers.hexlify(receiverBytes));

  // 5. 发起跨链转账
  console.log("\n正在发起跨链转账...");
  const tx = await senderContract.bridgeToken(amount, receiverBytes, {
    value: protocolFee,
  });

  console.log("交易哈希:", tx.hash);
  console.log("区块浏览器:", `${config.chains.polygon.explorer}/tx/${tx.hash}`);

  const receipt = await tx.wait();
  console.log("✅ 跨链转账已在 Polygon 上确认");

  // 6. 提取 submissionId
  const eventTopic = ethers.id("CrossChainTransfer(address,uint256,bytes32)");
  const log = receipt?.logs.find((l) => l.topics[0] === eventTopic);
  if (log) {
    const parsed = senderContract.interface.parseLog(log);
    if (parsed) {
      const submissionId = parsed.args.submissionId;
      console.log("\n📋 Submission ID:", submissionId);
      console.log("查询状态: node scripts/check-status.ts", submissionId);
    }
  }

  console.log("\n⏳ 等待 deBridge 验证者签名并在 Tron 上执行...");
  console.log("预计时间: 1-5 分钟");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
