import axios from "axios";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

export const ROOT = path.join(__dirname, "..", "..", "..");
export const CONFIG_PATH = path.join(ROOT, "config.testnet.json");

export interface ChainCfg {
  chainId: number;
  rpcUrl: string;
  explorer: string;
}

export interface TestnetConfig {
  chains: { amoy: ChainCfg; nile: ChainCfg };
  contracts: {
    amoy: { token: string; gate: string; callProxy: string; sender: string };
    nile: { gate: string; callProxy: string; receiver: string };
  };
  e2e: { submissionId: string; recipient: string; amount: string };
}

/**
 * 让 ethers 的 HTTP 请求走 axios。
 * 原因：ethers v6 内部用 fetch，在受限网络（必须经 HTTP 代理出网）的环境里会超时；
 * 而 axios 会读取 HTTPS_PROXY。这是 ethers 官方支持的扩展点（registerGetUrl）。
 */
let httpInstalled = false;
export function installHttpTransport(): void {
  if (httpInstalled) return;
  httpInstalled = true;

  ethers.FetchRequest.registerGetUrl(async (req: any) => {
    const res = await axios({
      url: req.url,
      method: req.method,
      data: req.body ?? undefined,
      headers: req.headers,
      timeout: 30_000,
      validateStatus: () => true,
      responseType: "arraybuffer",
    });

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers || {})) {
      headers[k.toLowerCase()] = String(v);
    }

    return {
      statusCode: res.status,
      statusMessage: String(res.status),
      headers,
      body: Buffer.from(res.data as ArrayBuffer),
    };
  });
}

export function loadConfig(): TestnetConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as TestnetConfig;
}

export function saveConfig(cfg: TestnetConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`环境变量 ${name} 未设置，请先填写 .env`);
  }
  return v;
}

/** 读取 hardhat 编译产物：artifacts/contracts/<dir>/<file>.sol/<Contract>.json */
export function readArtifact(contract: string, file?: string): { abi: any[]; bytecode: string } {
  const candidates = [
    path.join(ROOT, "artifacts", "contracts", `${file ?? contract}.sol`, `${contract}.json`),
    path.join(ROOT, "artifacts", "contracts", "mocks", `${file ?? contract}.sol`, `${contract}.json`),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`找不到编译产物 ${contract}，请先执行 npx hardhat compile`);
  }
  const artifact = JSON.parse(fs.readFileSync(found, "utf-8"));
  if (!artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`${contract} 没有 bytecode`);
  }
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

/**
 * 创建 TronWeb 实例，并把底层 HTTP 请求切到 axios。
 * 原因：TronWeb 内置的 HTTP 客户端在代理环境下会把明文请求发到 443 端口，
 * 这里复用 axios（它会读取 HTTPS_PROXY），行为与官方节点一致。
 */
export function createTronWeb(fullHost: string, privateKey?: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TronWebModule = require("tronweb");
  const TronWebClass = TronWebModule.TronWeb || TronWebModule.default || TronWebModule;

  const tronWeb = new TronWebClass({
    fullHost,
    privateKey,
  });

  const patch = (provider: any) => {
    if (!provider) return;
    provider.request = (apiPath: string, payload: any = {}) =>
      axios({
        method: "post",
        url: `${String(provider.host).replace(/\/$/, "")}/${apiPath}`,
        data: payload,
        timeout: 30_000,
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true,
      }).then((r) => r.data);
  };

  patch(tronWeb.fullNode);
  patch(tronWeb.solidityNode);
  patch(tronWeb.eventServer);

  return tronWeb;
}

/** 把 Tron Base58 地址转成 20 字节 EVM 风格地址（去掉 0x41 前缀） */
export function tronToEvmAddress(tronWeb: any, base58: string): string {
  const hex = tronWeb.address.toHex(base58); // 41 + 20 bytes
  return "0x" + hex.slice(2 + 2);
}

/** 判断地址是否为零地址（EVM 或 Tron Base58） */
export function isZeroAddress(addr: string): boolean {
  if (!addr) return true;
  if (addr === "0x0000000000000000000000000000000000000000") return true;
  if (addr.toLowerCase() === "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb".toLowerCase()) return true;
  return false;
}

/** 轮询等待 Tron 交易回执，失败则抛错 */
export async function waitTronTransaction(
  tronWeb: any,
  txid: string,
  label = "transaction"
): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const info = await tronWeb.trx.getTransactionInfo(txid).catch(() => null);
    if (info && info.id) {
      const receiptResult = info.receipt && info.receipt.result;
      const ok = receiptResult === "SUCCESS" || info.result === "SUCCESS";
      if (!ok) {
        const msg =
          info.resMessage
            ? Buffer.from(info.resMessage, "hex").toString("utf-8")
            : JSON.stringify({ result: info.result, receipt: receiptResult });
        throw new Error(`${label} 执行失败: ${msg} (txid=${txid})`);
      }
      return info;
    }
    await sleep(3000);
  }
  throw new Error(`${label} 等待回执超时 (txid=${txid})`);
}

export function logStep(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
