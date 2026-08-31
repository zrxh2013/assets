// Hardhat EVM 私链查询工具 - 同时显示 EVM (0x) 和 波场 (T...) 双地址
// 用法: node scripts/private-chain-query.js <命令> [参数]

const { ethers } = require("ethers");
const TronWeb = require("tronweb").TronWeb;

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const USDT_ADDRESS = process.env.USDT_CONTRACT || "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const USDT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// ---- 地址转换工具 ----
const _tw = new TronWeb({ fullHost: "https://api.trongrid.io" });
function evmToTron(evm) {
  if (!evm || !evm.startsWith("0x")) return evm;
  try { return _tw.address.fromHex("41" + evm.slice(2)); }
  catch { return evm; }
}
function shortTron(t) { return t && t.startsWith("T") ? t : evmToTron(t); }
function dual(evm, label = "") {
  const t = evmToTron(evm);
  return label ? `${evm}  [T:${t}]` : `${evm}  ↔  ${t}`;
}

// ---- Hardhat 默认账户 ----
const DEFAULT_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
];
const signerAddrs = DEFAULT_KEYS.map(k => new ethers.Wallet(k).address);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const chainId = (await provider.getNetwork()).chainId;
  const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);

  const hdr = () => {
    console.log(`Hardhat EVM 私链   RPC: ${RPC_URL}   chainId: ${chainId}`);
    console.log(`(所有 EVM 地址同时显示对应的 波场 T-Address)`);
    console.log("─".repeat(70));
  };

  const [_n, _s, cmd, ...args] = process.argv;
  try {
    switch ((cmd || "").toLowerCase()) {
      case "":
      case "help":
        console.log(`
  Hardhat EVM 私链查询工具 (同时显示 EVM + 波场 T 地址)
  ──────────────────────────────────────────────────────

  用法: node scripts/private-chain-query.js <命令> [参数]

  命令:
    current / block [高度|latest]  查询当前或指定区块
    balance  [地址]                 查询地址 ETH + USDT 余额
    usdt                           USDT 合约详情 + 前 5 个账户余额
    tx       [交易哈希]             查询交易详情 / 查看最近 3 个区块
    events   [起始区块] [结束区块]  查看 USDT Transfer 事件日志
    accounts                        列出前 5 个账户 (ETH/USDT + T 地址)
    all                            一键全景查询（推荐）
`);
        break;

      case "block":
      case "current":
        hdr();
        {
          const num = args[0] === "latest" || !args[0]
            ? await provider.getBlockNumber()
            : parseInt(args[0]);
          const block = await provider.getBlock(num);
          console.log(`🗂️ 区块高度:     ${block.number.toLocaleString()}`);
          console.log(`⏰ 时间戳:       ${new Date(block.timestamp * 1000).toISOString()}`);
          console.log(`🔗 父块 Hash:    ${block.parentHash}`);
          console.log(`📦 交易数量:     ${block.transactions.length}`);
          if (block.transactions.length) {
            console.log("   TX 列表:");
            block.transactions.forEach((txh, i) => console.log(`     [${i}] ${txh}`));
          }
        }
        break;

      case "balance":
      case "bal":
        hdr();
        {
          const addr = args[0] || signerAddrs[0];
          console.log(`📮 EVM 地址:  ${addr}`);
          console.log(`📮 波场地址:  ${evmToTron(addr)}`);
          console.log("");
          const ethBal = await provider.getBalance(addr);
          console.log(`💰 ETH 余额:  ${ethers.formatEther(ethBal)} ETH`);
          try {
            const b = await usdt.balanceOf(addr);
            const dec = await usdt.decimals();
            console.log(`💵 USDT 余额: ${ethers.formatUnits(b, dec)} USDT  (合约 ${USDT_ADDRESS.slice(0,12)}…  ↔  ${evmToTron(USDT_ADDRESS)})`);
          } catch (e) {
            console.log(`💵 USDT 余额: ⚠️ 查询失败 (${e.message.slice(0,40)})`);
          }
        }
        break;

      case "usdt":
        hdr();
        {
          console.log(`💵 USDT 合约信息`);
          console.log(`   EVM 地址:   ${USDT_ADDRESS}`);
          console.log(`   波场地址:   ${evmToTron(USDT_ADDRESS)}`);
          console.log(`   名称:       ${await usdt.name()}`);
          console.log(`   符号:       ${await usdt.symbol()}`);
          const dec = await usdt.decimals();
          const supply = await usdt.totalSupply();
          console.log(`   小数:       ${dec}`);
          console.log(`   总供给:     ${ethers.formatUnits(supply, dec)} USDT`);
          console.log("");
          console.log(`   各账户余额:`);
          for (let i = 0; i < signerAddrs.length; i++) {
            const b = await usdt.balanceOf(signerAddrs[i]);
            const tronA = evmToTron(signerAddrs[i]);
            console.log(`     #${i}  EVM:${signerAddrs[i].slice(0,12)}…`);
            console.log(`         TRX:${tronA}  →  ${ethers.formatUnits(b, dec)} USDT`);
          }
        }
        break;

      case "tx":
        hdr();
        {
          const txHash = args[0];
          if (!txHash) {
            const latest = await provider.getBlockNumber();
            console.log(`📋 最近 3 个区块的交易 (最新区块 #${latest})：`);
            for (let n = latest; n >= Math.max(0, latest - 2); n--) {
              const b = await provider.getBlock(n);
              const ts = new Date(b.timestamp*1000).toISOString().slice(5,19);
              console.log(`\n  🔷 区块 #${b.number}  (${ts})  交易数: ${b.transactions.length}`);
              if (b.transactions.length === 0) { console.log("     (空块)"); continue; }
              for (const txh of b.transactions) {
                const tx = await provider.getTransaction(txh);
                const rec = await provider.getTransactionReceipt(txh);
                const st = rec.status === 1 ? "✅" : "❌";
                const to = tx.to ? tx.to : "(创建合约)";
                const toT = tx.to ? evmToTron(tx.to) : "-";
                console.log(`     ${st}  ${txh.slice(0,20)}…  gasUsed=${rec.gasUsed.toString()}`);
                console.log(`         From EVM:${tx.from.slice(0,12)}…  (T:${evmToTron(tx.from).slice(0,8)}…)`);
                console.log(`         To   EVM:${typeof to === "string" ? to.slice(0,12)+"…" : to}  (T:${typeof toT === "string" ? toT.slice(0,8)+"…" : toT})`);
                console.log(`         Value: ${ethers.formatEther(tx.value)} ETH`);
              }
            }
            break;
          }
          const tx = await provider.getTransaction(txHash);
          const rec = await provider.getTransactionReceipt(txHash);
          if (!tx) { console.log("❌ 交易不存在"); break; }
          console.log(`🔍 交易: ${txHash}`);
          console.log(`   区块:       #${rec.blockNumber}`);
          console.log(`   状态:       ${rec.status === 1 ? "✅ 成功" : "❌ 失败"}`);
          console.log(`   发送方 EVM:  ${tx.from}`);
          console.log(`   发送方 TRX:  ${evmToTron(tx.from)}`);
          console.log(`   接收方 EVM:  ${tx.to || "(合约创建)"}`);
          console.log(`   接收方 TRX:  ${tx.to ? evmToTron(tx.to) : "-"}`);
          console.log(`   转账金额:   ${ethers.formatEther(tx.value)} ETH`);
          console.log(`   Gas 限制:   ${tx.gasLimit.toString()}`);
          console.log(`   Gas 消耗:   ${rec.gasUsed.toString()}`);
          console.log(`   Gas 价格:   ${ethers.formatUnits(tx.gasPrice, "gwei")} Gwei`);
          console.log(`   Nonce:      ${tx.nonce}`);
          try {
            const iface = new ethers.Interface(USDT_ABI);
            for (const log of rec.logs) {
              try {
                const parsed = iface.parseLog(log);
                if (parsed && parsed.name === "Transfer") {
                  const [from, to, val] = parsed.args;
                  const decimals = await usdt.decimals();
                  console.log(`\n   💵 USDT Transfer 事件:`);
                  console.log(`      From  EVM: ${from}`);
                  console.log(`      From  TRX: ${evmToTron(from)}`);
                  console.log(`      To    EVM: ${to}`);
                  console.log(`      To    TRX: ${evmToTron(to)}`);
                  console.log(`      金额:      ${ethers.formatUnits(val, decimals)} USDT`);
                }
              } catch {}
            }
          } catch {}
        }
        break;

      case "events":
      case "log":
        hdr();
        {
          const fromBlock = parseInt(args[0]) || 0;
          const toBlock = args[1] ? (args[1] === "latest" ? "latest" : parseInt(args[1])) : "latest";
          const endDisplay = toBlock === "latest" ? await provider.getBlockNumber() : toBlock;
          console.log(`📜 USDT Transfer 事件 (区块 ${fromBlock} ~ ${endDisplay})：`);
          const logs = await provider.getLogs({
            address: USDT_ADDRESS,
            topics: [ethers.id("Transfer(address,address,uint256)")],
            fromBlock,
            toBlock,
          });
          if (logs.length === 0) { console.log("  （暂无事件）"); break; }
          const decimals = await usdt.decimals();
          logs.forEach((e, i) => {
            const from = "0x" + e.topics[1].slice(26);
            const to   = "0x" + e.topics[2].slice(26);
            const val  = BigInt(e.data);
            const fromT = evmToTron(from);
            const toT = evmToTron(to);
            console.log(`  #${i+1} 区块#${e.blockNumber}  金额 ${ethers.formatUnits(val, decimals)} USDT`);
            console.log(`        From EVM:${from.slice(0,12)}…  TRX:${fromT.slice(0,10)}…`);
            console.log(`        To   EVM:${to.slice(0,12)}…  TRX:${toT.slice(0,10)}…`);
            console.log(`        tx: ${e.transactionHash}`);
          });
        }
        break;

      case "accounts":
        hdr();
        {
          const dec = await usdt.decimals();
          console.log(`👤 Hardhat 默认测试账户 (前 5 个, 每个预存 10000 ETH)：`);
          for (let i = 0; i < signerAddrs.length; i++) {
            const ethB = await provider.getBalance(signerAddrs[i]);
            const usdtB = await usdt.balanceOf(signerAddrs[i]);
            const tronA = evmToTron(signerAddrs[i]);
            console.log(`\n  #${i}`);
            console.log(`     EVM 地址:  ${signerAddrs[i]}`);
            console.log(`     TRX 地址:  ${tronA}`);
            console.log(`     ETH 余额:  ${ethers.formatEther(ethB)} ETH`);
            console.log(`     USDT余额:  ${ethers.formatUnits(usdtB, dec)} USDT`);
          }
        }
        break;

      case "all":
        console.log("=".repeat(78));
        console.log("  🔎 Hardhat 私链一键全景查询   (EVM 0x  ↔  波场 T 双地址显示)");
        console.log("=".repeat(78));
        console.log("");
        {
          const latest = await provider.getBlockNumber();
          const b = await provider.getBlock(latest);
          console.log(`🗂️ 当前区块高度:  #${b.number.toLocaleString()}`);
          console.log(`⏰ 出块时间:      ${new Date(b.timestamp*1000).toISOString()}`);
          console.log(`📦 最新区块交易:  ${b.transactions.length} 笔`);
        }
        console.log("");
        {
          const dec = await usdt.decimals();
          const supply = await usdt.totalSupply();
          console.log(`💵 USDT 合约`);
          console.log(`   EVM 地址:  ${USDT_ADDRESS}`);
          console.log(`   TRX 地址:  ${evmToTron(USDT_ADDRESS)}`);
          console.log(`   总供给:    ${ethers.formatUnits(supply, dec)} USDT`);
          console.log("");
          console.log(`   各账户余额 (EVM ↔ TRX 双地址):`);
          for (let i = 0; i < signerAddrs.length; i++) {
            const u = await usdt.balanceOf(signerAddrs[i]);
            const tronA = evmToTron(signerAddrs[i]);
            console.log(`     #${i}  EVM:${signerAddrs[i]}`);
            console.log(`           TRX:${tronA}  →  ${ethers.formatUnits(u, dec)} USDT`);
          }
        }
        console.log("");
        {
          const dec = await usdt.decimals();
          const logs = await provider.getLogs({
            address: USDT_ADDRESS,
            topics: [ethers.id("Transfer(address,address,uint256)")],
            fromBlock: 0, toBlock: "latest",
          });
          console.log(`📜 USDT 转账历史 (共 ${logs.length} 笔):`);
          if (logs.length === 0) console.log("  （暂无）");
          logs.forEach((e, i) => {
            const from = "0x" + e.topics[1].slice(26);
            const to   = "0x" + e.topics[2].slice(26);
            const val  = BigInt(e.data);
            console.log(`  #${i+1} 区块#${e.blockNumber}  金额 ${ethers.formatUnits(val, dec)} USDT`);
            console.log(`        ${evmToTron(from)} ← 0x…${from.slice(-6)}`);
            console.log(`        ${evmToTron(to)}   ← 0x…${to.slice(-6)}`);
            console.log(`        tx: ${e.transactionHash}`);
          });
        }
        break;

      default:
        console.error(`❌ 未知命令: ${cmd}`);
    }
  } catch (e) {
    console.error("❌ 错误:", e.message);
    console.error("   (提示：请确保 Hardhat 节点已在 127.0.0.1:8545 启动)");
  }
}

main();
