import TronWeb from "tronweb";
import * as fs from "fs";
import * as path from "path";

/**
 * 部署目标链（Tron）的 TokenReceiver 合约
 *
 * 用法: npx ts-node scripts/deploy-receiver.ts
 * 环境变量:
 *   TRON_PRIVATE_KEY  - Tron 部署者私钥（hex 格式）
 */

async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8")
  );

  const tronPrivateKey = process.env.TRON_PRIVATE_KEY;
  if (!tronPrivateKey) throw new Error("TRON_PRIVATE_KEY 环境变量未设置");

  const tronWeb = new TronWeb({
    fullHost: config.chains.tron.rpcUrl,
    privateKey: tronPrivateKey,
  });

  const deployer = tronWeb.address.fromPrivateKey(tronPrivateKey);
  console.log("部署者地址:", deployer);
  console.log("网络: Tron (chainId =", config.chains.tron.chainId, ")");
  console.log("deBridgeGate:", config.chains.tron.deBridgeGate);
  console.log("源链: Polygon (chainId =", config.chains.polygon.chainId, ")");

  // 读取编译后的合约字节码
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "contracts", "TokenReceiver.sol", "TokenReceiver.json"),
      "utf-8"
    )
  );

  // 使用 tronWeb.contract().new() 部署，自动处理 ABI 与构造函数参数
  // constructor(address deBridgeGate_, uint256 sourceChainId_)
  console.log("\n⏳ 正在部署 TokenReceiver...");
  const instance = await tronWeb.contract().new({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    feeLimit: 1_000_000_000, // 1000 TRX
    callValue: 0,
    parameters: [config.chains.tron.deBridgeGate, config.chains.polygon.chainId],
  });

  const base58Address = instance.address;

  console.log("\n✅ TokenReceiver 部署成功！");
  console.log("合约地址 (Base58):", base58Address);
  console.log("区块浏览器:", `${config.chains.tron.explorer}/#/contract/${base58Address}`);

  // 更新 config.json
  config.contracts.receiver = base58Address;
  fs.writeFileSync(
    path.join(__dirname, "..", "config.json"),
    JSON.stringify(config, null, 2)
  );
  console.log("\n已更新 config.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
