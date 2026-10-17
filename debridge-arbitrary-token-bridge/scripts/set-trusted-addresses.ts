import { ethers } from "ethers";
import TronWeb from "tronweb";
import * as fs from "fs";
import * as path from "path";

/**
 * 在两个合约之间建立信任关系：
 * 1. 在 Tron Receiver 上设置受信任的源链 Sender 地址
 * 2. 在 Polygon Sender 上设置受信任的目标链 Receiver 地址
 *
 * 用法: npx ts-node scripts/set-trusted-addresses.ts
 * 环境变量:
 *   PRIVATE_KEY        - Polygon 管理员私钥
 *   TRON_PRIVATE_KEY   - Tron 管理员私钥
 */

async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8")
  );

  const privateKey = process.env.PRIVATE_KEY;
  const tronPrivateKey = process.env.TRON_PRIVATE_KEY;

  if (!privateKey) throw new Error("PRIVATE_KEY 环境变量未设置");
  if (!tronPrivateKey) throw new Error("TRON_PRIVATE_KEY 环境变量未设置");
  if (!config.contracts.sender) throw new Error("请先部署 TokenSender");
  if (!config.contracts.receiver) throw new Error("请先部署 TokenReceiver");

  // ============ 步骤 1: 在 Tron Receiver 上设置信任的 Sender ============
  console.log("=== 步骤 1: 在 Tron Receiver 上设置信任的 Sender ===");

  const tronWeb = new TronWeb({
    fullHost: config.chains.tron.rpcUrl,
    privateKey: tronPrivateKey,
  });

  // Polygon 是 EVM 链，CallProxy.submissionNativeSender() 返回 20 字节地址
  const senderAddressBytes = ethers.getBytes(config.contracts.sender);
  console.log("Sender (Polygon):", config.contracts.sender);
  console.log("Sender bytes:", ethers.hexlify(senderAddressBytes));

  // 调用 TokenReceiver.setTrustedSender(bytes)
  const receiverContract = await tronWeb.contract().at(config.contracts.receiver);

  const setSenderTx = await receiverContract
    .setTrustedSender(ethers.hexlify(senderAddressBytes))
    .send({
      feeLimit: 100_000_000,
      callValue: 0,
    });

  console.log("✅ setTrustedSender 交易:", setSenderTx);

  // ============ 步骤 2: 在 Polygon Sender 上设置信任的 Receiver ============
  console.log("\n=== 步骤 2: 在 Polygon Sender 上设置信任的 Receiver ===");

  const provider = new ethers.JsonRpcProvider(config.chains.polygon.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const senderArtifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "contracts", "TokenSender.sol", "TokenSender.json"),
      "utf-8"
    )
  );

  const senderContract = new ethers.Contract(
    config.contracts.sender,
    senderArtifact.abi,
    wallet
  );

  // deBridge 的 send() 中 _receiver 需要目标链地址的原生字节表示。
  // TronWeb 的 toHex() 返回 21 字节（0x41 前缀 + 20 字节），作为 Tron 合约地址的字节表示。
  // 注意：此编码需与 deBridge 对 Tron 地址的期望格式一致，请在部署前对照官方文档确认。
  const receiverHex = TronWeb.address.toHex(config.contracts.receiver);
  const receiverBytes = ethers.getBytes(receiverHex);
  console.log("Receiver (Tron):", config.contracts.receiver);
  console.log("Receiver bytes:", ethers.hexlify(receiverBytes));

  const setReceiverTx = await senderContract.setTrustedReceiver(receiverBytes);
  await setReceiverTx.wait();

  console.log("✅ setTrustedReceiver 交易:", setReceiverTx.hash);
  console.log("区块浏览器:", `${config.chains.polygon.explorer}/tx/${setReceiverTx.hash}`);

  console.log("\n🎉 信任关系建立完成！");
  console.log("现在可以使用 bridge-to-tron.ts 发起跨链转账了");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
