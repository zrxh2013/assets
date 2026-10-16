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
      path.join(__dirname, "..", "artifacts", "TokenReceiver.json"),
      "utf-8"
    )
  );

  // 编码构造函数参数
  // constructor(address deBridgeGate_, uint256 sourceChainId_)
  const constructorParams = [
    { type: "address", value: config.chains.tron.deBridgeGate },
    { type: "uint256", value: config.chains.polygon.chainId },
  ];

  const parameter = tronWeb.utils.abi.encodeParams(
    constructorParams.map((p) => p.type),
    constructorParams.map((p) => p.value)
  );

  const bytecodeWithParams = artifact.bytecode + parameter.replace("0x", "");

  // 部署合约
  const transaction = await tronWeb.transactionBuilder.createSmartContract(
    {
      bytecode: bytecodeWithParams,
      feeLimit: 1000_000_000, // 1000 TRX
      callValue: 0,
    },
    deployer
  );

  const signedTx = await tronWeb.trx.sign(transaction, tronPrivateKey);
  const result = await tronWeb.trx.sendRawTransaction(signedTx);

  if (!result.result) {
    throw new Error("合约部署失败: " + JSON.stringify(result));
  }

  console.log("\n✅ TokenReceiver 部署中...");
  console.log("交易哈希:", result.txid);
  console.log("区块浏览器:", `${config.chains.tron.explorer}/#/transaction/${result.txid}`);

  // 等待合约部署确认
  let contractAddress = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const txInfo = await tronWeb.trx.getTransactionInfo(result.txid);
    if (txInfo.contractAddress) {
      contractAddress = txInfo.contractAddress;
      break;
    }
  }

  if (!contractAddress) {
    throw new Error("合约部署超时，请手动检查交易");
  }

  // Tron 合约地址转换为 Base58
  const base58Address = tronWeb.address.fromHex(contractAddress);

  console.log("\n✅ TokenReceiver 部署成功！");
  console.log("合约地址 (hex):", contractAddress);
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
