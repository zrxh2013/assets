import {
  loadConfig,
  saveConfig,
  requireEnv,
  readArtifact,
  createTronWeb,
  waitTronTransaction,
  logStep,
} from "./lib/common";

/**
 * 在 Tron Nile 测试网部署目标链一侧：
 * MockDeBridgeGate → MockCallProxy → TokenReceiver
 *
 * 用法: npx ts-node scripts/testnet/deploy-nile.ts
 * 环境变量: TRON_PRIVATE_KEY（需持有 Nile 测试 TRX）
 */

async function deploy(
  tronWeb: any,
  contract: string,
  parameters: unknown[]
): Promise<string> {
  const { abi, bytecode } = readArtifact(contract);
  const instance = await tronWeb.contract().new({
    abi,
    bytecode: bytecode.replace(/^0x/, ""),
    feeLimit: 3_000_000_000, // 3000 TRX 上限
    callValue: 0,
    parameters,
  });
  const address: string = instance.address;
  console.log(`  ${contract.padEnd(18)} ${address}`);
  return address;
}

async function main() {
  const config = loadConfig();
  const privateKey = requireEnv("TRON_PRIVATE_KEY");

  logStep("连接 Tron Nile");
  const tronWeb = createTronWeb(config.chains.nile.rpcUrl, privateKey);
  const deployer = tronWeb.address.fromPrivateKey(privateKey);
  const balanceSun: number = await tronWeb.trx.getBalance(deployer);

  console.log("  RPC      :", config.chains.nile.rpcUrl);
  console.log("  部署者   :", deployer);
  console.log("  余额     :", balanceSun / 1e6, "TRX");

  if (balanceSun / 1e6 < 200) {
    throw new Error(
      `部署者 ${deployer} 的 TRX 不足以部署 3 个合约（建议至少 200 TRX），请先领水`
    );
  }

  const zeroAddress = tronWeb.address.fromHex(
    "410000000000000000000000000000000000000000"
  );

  logStep("部署 mock 跨链设施（gate + callProxy）");
  const gate = await deploy(tronWeb, "MockDeBridgeGate", [zeroAddress, 0]);
  const callProxy = await deploy(tronWeb, "MockCallProxy", [gate]);

  const gateContract = await tronWeb.contract().at(gate);
  const setProxyTxid: string = await gateContract.setCallProxy(callProxy).send({
    feeLimit: 200_000_000,
    callValue: 0,
  });
  await waitTronTransaction(tronWeb, setProxyTxid, "setCallProxy");
  console.log(`  gate.callProxy 已设置 -> ${callProxy}`);

  logStep("部署目标链 TokenReceiver");
  console.log(`  源链 chainId: ${config.chains.amoy.chainId} (Polygon Amoy)`);
  const receiver = await deploy(tronWeb, "TokenReceiver", [
    gate,
    config.chains.amoy.chainId,
  ]);

  config.contracts.nile = { gate, callProxy, receiver };
  saveConfig(config);

  logStep("Nile 部署完成");
  console.log("  config.testnet.json 已更新");
  console.log(`  TokenReceiver: ${config.chains.nile.explorer}/#/contract/${receiver}`);
  console.log("\n下一步: npx ts-node scripts/testnet/set-trusted.ts");
}

main().catch((error) => {
  console.error("\n❌ 部署失败:", error.message || error);
  process.exit(1);
});
