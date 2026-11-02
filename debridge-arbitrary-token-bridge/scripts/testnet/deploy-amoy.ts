import { ethers } from "ethers";
import {
  loadConfig,
  saveConfig,
  requireEnv,
  readArtifact,
  installHttpTransport,
  logStep,
} from "./lib/common";

/**
 * 在 Polygon Amoy 测试网部署源链一侧：
 * MockERC20（测试代币） → MockDeBridgeGate → MockCallProxy → TokenSender
 *
 * 用法: npx ts-node scripts/testnet/deploy-amoy.ts
 * 环境变量: PRIVATE_KEY（需持有 Amoy 测试 MATIC）
 */

const ZERO = "0x0000000000000000000000000000000000000000";

async function deploy(
  signer: ethers.Signer,
  contract: string,
  args: unknown[]
): Promise<string> {
  const { abi, bytecode } = readArtifact(contract);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const instance = await factory.deploy(...(args as any[]));
  await instance.waitForDeployment();
  const address = await instance.getAddress();
  const txHash = instance.deploymentTransaction()?.hash ?? "-";
  console.log(`  ${contract.padEnd(18)} ${address}`);
  console.log(`  ${"".padEnd(18)} tx: ${txHash}`);
  return address;
}

async function main() {
  installHttpTransport();

  const config = loadConfig();
  const privateKey = requireEnv("PRIVATE_KEY");

  logStep("连接 Polygon Amoy");
  const provider = new ethers.JsonRpcProvider(config.chains.amoy.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const chainId = (await provider.getNetwork()).chainId;
  const balance = await provider.getBalance(wallet.address);
  console.log("  RPC      :", config.chains.amoy.rpcUrl);
  console.log("  chainId  :", chainId.toString());
  console.log("  部署者   :", wallet.address);
  console.log("  余额     :", ethers.formatEther(balance), "MATIC");

  if (balance === 0n) {
    throw new Error(
      `部署者 ${wallet.address} 在 Amoy 上没有 MATIC，请先从 faucet 领取后再部署`
    );
  }
  if (chainId !== 80002n) {
    throw new Error(`RPC chainId 不是 Amoy(80002)，实际为 ${chainId}`);
  }

  logStep("部署测试代币 MockERC20");
  const token = await deploy(wallet, "MockERC20", ["Mock Bridged Token", "tMOCK"]);

  const mintAmount = ethers.parseEther("1000000");
  const tokenContract = new ethers.Contract(token, readArtifact("MockERC20").abi, wallet);
  const mintTx = await tokenContract.mint(wallet.address, mintAmount);
  await mintTx.wait();
  console.log(`  已 mint ${ethers.formatEther(mintAmount)} tMOCK 给部署者`);
  console.log(`  tx: ${mintTx.hash}`);

  logStep("部署 mock 跨链设施（gate + callProxy）");
  const gate = await deploy(wallet, "MockDeBridgeGate", [ZERO, 0]);
  const callProxy = await deploy(wallet, "MockCallProxy", [gate]);

  const gateContract = new ethers.Contract(gate, readArtifact("MockDeBridgeGate").abi, wallet);
  const setProxyTx = await gateContract.setCallProxy(callProxy);
  await setProxyTx.wait();
  console.log(`  gate.callProxy 已设置 -> ${callProxy}`);

  logStep("部署源链 TokenSender");
  console.log(`  目标链 chainId: ${config.chains.nile.chainId} (Tron Nile)`);
  const sender = await deploy(wallet, "TokenSender", [
    gate,
    token,
    config.chains.nile.chainId,
  ]);

  config.contracts.amoy = { token, gate, callProxy, sender };
  saveConfig(config);

  logStep("Amoy 部署完成");
  console.log("  config.testnet.json 已更新");
  console.log("\n下一步: npx ts-node scripts/testnet/deploy-nile.ts");
}

main().catch((error) => {
  console.error("\n❌ 部署失败:", error.shortMessage || error.message || error);
  process.exit(1);
});
