import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * 部署源链（Polygon）的 TokenSender 合约
 *
 * 用法: npx ts-node scripts/deploy-sender.ts
 * 环境变量:
 *   PRIVATE_KEY       - 部署者私钥
 *   SOURCE_TOKEN      - 源代币合约地址（用户在 Polygon 上的自定义 ERC-20）
 */

async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8")
  );

  const privateKey = process.env.PRIVATE_KEY;
  const sourceToken = process.env.SOURCE_TOKEN;

  if (!privateKey) throw new Error("PRIVATE_KEY 环境变量未设置");
  if (!sourceToken) throw new Error("SOURCE_TOKEN 环境变量未设置");

  const provider = new ethers.JsonRpcProvider(config.chains.polygon.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("部署者地址:", wallet.address);
  console.log("网络: Polygon (chainId =", config.chains.polygon.chainId, ")");
  console.log("deBridgeGate:", config.chains.polygon.deBridgeGate);
  console.log("源代币:", sourceToken);
  console.log("目标链: Tron (chainId =", config.chains.tron.chainId, ")");

  // 读取合约 ABI 和 Bytecode
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "contracts", "TokenSender.sol", "TokenSender.json"),
      "utf-8"
    )
  );

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );

  const contract = await factory.deploy(
    config.chains.polygon.deBridgeGate,
    sourceToken,
    config.chains.tron.chainId
  );

  await contract.waitForDeployment();
  const senderAddress = await contract.getAddress();

  console.log("\n✅ TokenSender 部署成功！");
  console.log("合约地址:", senderAddress);
  console.log("区块浏览器:", `${config.chains.polygon.explorer}/address/${senderAddress}`);

  // 更新 config.json
  config.contracts.sender = senderAddress;
  fs.writeFileSync(
    path.join(__dirname, "..", "config.json"),
    JSON.stringify(config, null, 2)
  );
  console.log("\n已更新 config.json");

  // 下一步提示
  console.log("\n📋 下一步:");
  console.log("1. 在 Tron 上部署 TokenReceiver 合约");
  console.log("2. 调用 setTrustedSender() 设置源链 Sender 地址");
  console.log("3. 调用 Sender.setTrustedReceiver() 设置目标链 Receiver 地址");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
