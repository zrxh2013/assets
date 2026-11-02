import { ethers } from "ethers";
import { loadConfig, createTronWeb, installHttpTransport, logStep } from "./lib/common";

/**
 * 部署前检查：RPC 连通性 + 私钥是否配置 + 测试币余额
 *
 * 用法: npx ts-node scripts/testnet/preflight.ts
 */

async function main() {
  installHttpTransport();
  const config = loadConfig();
  let fatal = false;

  logStep("Polygon Amoy");
  try {
    const provider = new ethers.JsonRpcProvider(config.chains.amoy.rpcUrl);
    const network = await provider.getNetwork();
    console.log("  RPC     :", config.chains.amoy.rpcUrl);
    console.log("  chainId :", network.chainId.toString(), network.chainId === 80002n ? "✅" : "❌ 非 Amoy");
    if (network.chainId !== 80002n) fatal = true;

    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      console.log("  私钥    : ❌ 未设置 PRIVATE_KEY");
      fatal = true;
    } else {
      const address = new ethers.Wallet(pk).address;
      const balance = await provider.getBalance(address);
      console.log("  地址    :", address);
      console.log("  余额    :", ethers.formatEther(balance), "MATIC", balance > 0n ? "✅" : "❌ 需领水");
      if (balance === 0n) fatal = true;
    }
  } catch (e: any) {
    console.log("  ❌ RPC 失败:", e.shortMessage || e.message);
    fatal = true;
  }

  logStep("Tron Nile");
  try {
    const tronWeb = createTronWeb(config.chains.nile.rpcUrl);
    const block = await tronWeb.trx.getCurrentBlock();
    console.log("  RPC     :", config.chains.nile.rpcUrl);
    console.log("  最新区块:", block.block_header.raw_data.number, "✅");

    const pk = process.env.TRON_PRIVATE_KEY;
    if (!pk) {
      console.log("  私钥    : ❌ 未设置 TRON_PRIVATE_KEY");
      fatal = true;
    } else {
      const address = tronWeb.address.fromPrivateKey(pk);
      const sun = await tronWeb.trx.getBalance(address);
      console.log("  地址    :", address);
      console.log("  余额    :", sun / 1e6, "TRX", sun / 1e6 >= 200 ? "✅" : "❌ 建议至少 200 TRX");
      if (sun / 1e6 < 200) fatal = true;
    }
  } catch (e: any) {
    console.log("  ❌ RPC 失败:", e.message);
    fatal = true;
  }

  if (fatal) {
    console.log("\n⚠️  存在阻塞项，补齐 .env 并领取测试币后再部署");
    process.exitCode = 1;
  } else {
    console.log("\n✅ 前置检查通过，可以开始部署");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
