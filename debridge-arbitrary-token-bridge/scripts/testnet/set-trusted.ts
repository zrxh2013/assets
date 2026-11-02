import { ethers } from "ethers";
import {
  loadConfig,
  requireEnv,
  readArtifact,
  createTronWeb,
  installHttpTransport,
  tronToEvmAddress,
  waitTronTransaction,
  logStep,
} from "./lib/common";

/**
 * 建立双向信任关系：
 * 1. Amoy  TokenSender.setTrustedReceiver(Tron Receiver 的 20 字节地址)
 * 2. Nile  TokenReceiver.setTrustedSender(Amoy Sender 的 20 字节地址)
 *
 * 用法: npx ts-node scripts/testnet/set-trusted.ts
 */

async function main() {
  installHttpTransport();
  const config = loadConfig();
  const { amoy, nile } = config.contracts;

  for (const [k, v] of Object.entries({
    "Amoy TokenSender": amoy.sender,
    "Nile TokenReceiver": nile.receiver,
  })) {
    if (!v) throw new Error(`${k} 地址为空，请先完成两侧部署`);
  }

  // ============ 1. Amoy: setTrustedReceiver ============
  logStep("Amoy: TokenSender.setTrustedReceiver");
  const provider = new ethers.JsonRpcProvider(config.chains.amoy.rpcUrl);
  const wallet = new ethers.Wallet(requireEnv("PRIVATE_KEY"), provider);

  const tronWeb = createTronWeb(config.chains.nile.rpcUrl);
  // Tron 地址在跨链消息中统一用 20 字节 EVM 风格表示（去掉 0x41 前缀）
  const receiverBytes20 = tronToEvmAddress(tronWeb, nile.receiver);

  const senderContract = new ethers.Contract(
    amoy.sender,
    readArtifact("TokenSender").abi,
    wallet
  );
  const tx = await senderContract.setTrustedReceiver(receiverBytes20);
  await tx.wait();

  console.log("  Receiver (Tron)       :", nile.receiver);
  console.log("  Receiver bytes(20B)   :", receiverBytes20);
  console.log("  tx:", `${config.chains.amoy.explorer}/tx/${tx.hash}`);

  // ============ 2. Nile: setTrustedSender ============
  logStep("Nile: TokenReceiver.setTrustedSender");
  const tronWebSigner = createTronWeb(config.chains.nile.rpcUrl, requireEnv("TRON_PRIVATE_KEY"));
  const receiverContract = await tronWebSigner.contract().at(nile.receiver);

  const txid: string = await receiverContract
    .setTrustedSender(amoy.sender)
    .send({ feeLimit: 200_000_000, callValue: 0 });
  await waitTronTransaction(tronWebSigner, txid, "setTrustedSender");

  console.log("  Sender (Amoy)         :", amoy.sender);
  console.log("  tx:", `${config.chains.nile.explorer}/#/transaction/${txid}`);

  logStep("信任关系建立完成");
  console.log("下一步: npx ts-node scripts/testnet/e2e.ts");
}

main().catch((error) => {
  console.error("\n❌ 失败:", error.shortMessage || error.message || error);
  process.exit(1);
});
