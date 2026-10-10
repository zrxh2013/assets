// scripts/tron-store.js
// 波场链数据存证 CLI 工具
//
// 用法：
//   node scripts/tron-store.js store "文本或 JSON 内容"     # 上链存证
//   node scripts/tron-store.js file <文件路径>              # 把文件内容上链
//   node scripts/tron-store.js file-hash <文件路径>        # 把文件的 SHA-256 上链（推荐大文件）
//   node scripts/tron-store.js get <交易哈希>               # 查询并解码链上存证
//   node scripts/tron-store.js list [地址] [数量]           # 列出该地址所有存证记录
//   node scripts/tron-store.js balance <地址>               # 查询 TRX 余额（确认有 memo 费用）
//
// 环境变量：
//   TRON_NETWORK    mainnet（默认）或 nile
//   TRON_PRIVATE_KEY 发送方私钥（store / file / file-hash 命令必需）
//   TRON_TO_ADDRESS  可选，转账目标地址（默认转给自己）

const fs = require("fs");
const crypto = require("crypto");
const { storeData, retrieveData, listStoredRecords } = require("../tron/store");
const { createClient } = require("../tron/client");
const config = require("../tron/config");

const NETWORK = process.env.TRON_NETWORK || "mainnet";

function printHeader(title) {
  console.log("\n" + "═".repeat(70));
  console.log("  " + title);
  console.log("  网络: " + NETWORK + "    " + new Date().toISOString());
  console.log("═".repeat(70));
}

async function checkBalance(privateKey) {
  const tronWeb = createClient(NETWORK, privateKey);
  const addr = tronWeb.defaultAddress.base58;
  const balSun = await tronWeb.trx.getBalance(addr);
  const balTrx = balSun / config.sun;
  console.log(`📊 地址: ${addr}`);
  console.log(`💰 TRX 余额: ${balTrx} TRX  (${balSun} SUN)`);
  if (balTrx < 1.5) {
    console.warn(`⚠️  警告：余额不足 1.5 TRX（memo 费 1 TRX + 转账 + 带宽）`);
    if (NETWORK === "nile") {
      console.warn(`   可去 Nile 水龙头领取测试 TRX：https://nileex.io/join/getJoinIn`);
    }
    return false;
  }
  return true;
}

async function main() {
  const [_n, _s, cmd, ...args] = process.argv;

  switch ((cmd || "").toLowerCase()) {
    case "":
    case "help":
      console.log(`
  波场链数据存证工具
  ─────────────────────────────────────────────────────────

  用法: node scripts/tron-store.js <命令> [参数]

  命令:
    store "<文本>"               把文本/JSON 上链存证
    file <文件路径>              把文件内容上链（≤ 200 字节）
    file-hash <文件路径>         把文件 SHA-256 上链（推荐大文件，仅存哈希）
    get <交易哈希>               查询并解码链上存证内容
    list [地址] [数量]            列出该地址所有带 memo 的交易
    balance [地址]               查询地址 TRX 余额（store 前先检查）
    help                         显示本帮助

  环境变量:
    TRON_NETWORK=mainnet|nile              默认 mainnet
    TRON_PRIVATE_KEY=<hex私钥>            store/file/file-hash 必需
    TRON_TO_ADDRESS=<T地址>               可选，转账目标（默认转给自己）

  示例:
    # 主网存证（需 1+ TRX）
    TRON_PRIVATE_KEY=xxx node scripts/tron-store.js store 'Hello Tron!'

    # Nile 测试网存证（免费）
    TRON_NETWORK=nile TRON_PRIVATE_KEY=xxx node scripts/tron-store.js store '{"id":1,"msg":"hi"}'

    # 文件 SHA-256 存证
    TRON_PRIVATE_KEY=xxx node scripts/tron-store.js file-hash ./document.pdf

    # 查询存证
    node scripts/tron-store.js get <txID>
    TRON_NETWORK=nile node scripts/tron-store.js get <txID>

    # 列出某地址所有存证
    node scripts/tron-store.js list TXX... 20
`);
      break;

    case "balance":
      printHeader("查询 TRX 余额");
      {
        const pk = process.env.TRON_PRIVATE_KEY;
        if (!pk) {
          console.log("⚠️ 请设置 TRON_PRIVATE_KEY 环境变量");
          return;
        }
        await checkBalance(pk);
      }
      break;

    case "store":
      printHeader("文本/JSON 上链存证");
      {
        const content = args.join(" ");
        if (!content) {
          console.log("❌ 请提供要存证的内容：");
          console.log('   node scripts/tron-store.js store "Hello Tron!"');
          return;
        }
        const pk = process.env.TRON_PRIVATE_KEY;
        if (!pk) {
          console.log("❌ 请设置 TRON_PRIVATE_KEY 环境变量");
          return;
        }
        await checkBalance(pk);
        console.log("");
        console.log(`📝 待存证内容 (${Buffer.byteLength(content, "utf8")} 字节):`);
        console.log("    " + (content.length > 200 ? content.slice(0, 200) + "…" : content));
        console.log(`🔐 SHA-256: ${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`);
        console.log("");
        console.log("⏳ 正在签名并广播到 " + NETWORK + "...");
        const result = await storeData(pk, content, {
          network: NETWORK,
          toAddress: process.env.TRON_TO_ADDRESS,
        });
        console.log("");
        console.log(`✅ 存证${result.confirmed ? "已上链" : "已广播（确认中）"}：`);
        console.log(`   🆔 交易哈希:  ${result.txID}`);
        console.log(`   📦 区块高度:  ${result.blockNumber || "（确认中）"}`);
        console.log(`   ⏰ 上链时间:  ${result.blockTimestamp || "—"}`);
        console.log(`   📤 发送方:    ${result.fromAddress}`);
        console.log(`   📥 接收方:    ${result.toAddress}`);
        console.log(`   💵 转账金额:  ${result.amountTrx} TRX`);
        console.log(`   📏 memo 长度: ${result.memoBytes} 字节`);
        console.log(`   🔐 内容哈希:  ${result.contentSha256}`);
        console.log(`   🔗 浏览器:    ${result.explorer}`);
        console.log("");
        console.log("   💡 后续查询命令：");
        console.log(`      node scripts/tron-store.js get ${result.txID}`);
      }
      break;

    case "file":
      printHeader("文件内容上链存证");
      {
        const filePath = args[0];
        if (!filePath) {
          console.log("❌ 请提供文件路径：node scripts/tron-store.js file ./file.txt");
          return;
        }
        if (!fs.existsSync(filePath)) {
          console.log(`❌ 文件不存在: ${filePath}`);
          return;
        }
        const content = fs.readFileSync(filePath, "utf8");
        if (Buffer.byteLength(content, "utf8") > 200) {
          console.log(`⚠️ 文件过大 (${Buffer.byteLength(content, "utf8")} 字节)，建议改用 file-hash：`);
          console.log(`   node scripts/tron-store.js file-hash ${filePath}`);
          return;
        }
        const pk = process.env.TRON_PRIVATE_KEY;
        if (!pk) {
          console.log("❌ 请设置 TRON_PRIVATE_KEY 环境变量");
          return;
        }
        await checkBalance(pk);
        console.log("");
        console.log(`📄 文件: ${filePath} (${Buffer.byteLength(content, "utf8")} 字节)`);
        console.log(`🔐 SHA-256: ${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`);
        console.log("⏳ 正在广播到 " + NETWORK + "...");
        const result = await storeData(pk, content, {
          network: NETWORK,
          toAddress: process.env.TRON_TO_ADDRESS,
        });
        console.log("");
        console.log(`✅ 已上链：`);
        console.log(`   🆔 txID: ${result.txID}`);
        console.log(`   📦 区块: ${result.blockNumber || "（确认中）"}`);
        console.log(`   🔗 浏览器: ${result.explorer}`);
        console.log("");
        console.log("   💡 后续查询：");
        console.log(`      node scripts/tron-store.js get ${result.txID}`);
      }
      break;

    case "file-hash":
      printHeader("文件 SHA-256 上链存证");
      {
        const filePath = args[0];
        if (!filePath) {
          console.log("❌ 请提供文件路径：node scripts/tron-store.js file-hash ./file.bin");
          return;
        }
        if (!fs.existsSync(filePath)) {
          console.log(`❌ 文件不存在: ${filePath}`);
          return;
        }
        const fileBuf = fs.readFileSync(filePath);
        const hashHex = crypto.createHash("sha256").update(fileBuf).digest("hex");
        // 存证内容：JSON 格式，包含文件名、大小、SHA-256
        const content = JSON.stringify({
          type: "file-hash",
          file: filePath.split("/").pop(),
          size: fileBuf.length,
          sha256: hashHex,
          ts: new Date().toISOString(),
        });
        const pk = process.env.TRON_PRIVATE_KEY;
        if (!pk) {
          console.log("❌ 请设置 TRON_PRIVATE_KEY 环境变量");
          return;
        }
        await checkBalance(pk);
        console.log("");
        console.log(`📄 文件: ${filePath} (${fileBuf.length} 字节)`);
        console.log(`🔐 SHA-256: ${hashHex}`);
        console.log(`📝 存证 JSON (${Buffer.byteLength(content, "utf8")} 字节):`);
        console.log("    " + content);
        console.log("⏳ 正在广播到 " + NETWORK + "...");
        const result = await storeData(pk, content, {
          network: NETWORK,
          toAddress: process.env.TRON_TO_ADDRESS,
        });
        console.log("");
        console.log(`✅ 文件哈希已上链：`);
        console.log(`   🆔 txID: ${result.txID}`);
        console.log(`   📦 区块: ${result.blockNumber || "（确认中）"}`);
        console.log(`   🔗 浏览器: ${result.explorer}`);
        console.log("");
        console.log("   💡 后续验证文件完整性：");
        console.log("      shasum -a 256 <文件路径>");
        console.log(`      node scripts/tron-store.js get ${result.txID}`);
      }
      break;

    case "get":
      printHeader("查询链上存证");
      {
        const txID = args[0];
        if (!txID) {
          console.log("❌ 请提供交易哈希：node scripts/tron-store.js get <txID>");
          return;
        }
        console.log(`🔍 查询交易 ${txID} 在 ${NETWORK} ...`);
        const result = await retrieveData(txID, NETWORK);
        console.log("");
        console.log(`🆔 交易哈希:   ${result.txID}`);
        console.log(`📦 区块高度:   ${result.blockNumber || "（未上链或不存在）"}`);
        console.log(`⏰ 上链时间:   ${result.blockTimestamp || "—"}`);
        console.log(`✅ 状态:       ${result.status}`);
        console.log(`💸 手续费:     ${result.feeTrx !== null ? result.feeTrx + " TRX" : "—"}`);
        console.log(`📤 发送方:     ${result.from || "—"}`);
        console.log(`📥 接收方:     ${result.to || "—"}`);
        console.log(`💵 转账金额:   ${result.amountTrx !== null ? result.amountTrx + " TRX" : "—"}`);
        console.log(`📝 memo 字节:  ${result.memoBytes}`);
        if (result.memoHex) {
          console.log(`   memo hex:  ${result.memoHex}`);
        }
        if (result.memoText) {
          console.log("");
          console.log("📜 解码出的存证内容：");
          console.log("─".repeat(70));
          console.log(result.memoText);
          console.log("─".repeat(70));
          // 尝试 JSON 美化
          try {
            const obj = JSON.parse(result.memoText);
            console.log("\n📑 解析为 JSON：");
            console.log(JSON.stringify(obj, null, 2));
          } catch {}
          // 计算 SHA-256
          const sha = crypto.createHash("sha256").update(result.memoText, "utf8").digest("hex");
          console.log(`\n🔐 内容 SHA-256: ${sha}`);
        } else {
          console.log("⚠️ 该交易没有 memo（不是存证交易）");
        }
        console.log("");
        console.log(`🔗 浏览器: ${result.explorer}`);
      }
      break;

    case "list":
      printHeader("列出地址存证记录");
      {
        const address = args[0];
        const limit = parseInt(args[1]) || 20;
        if (!address) {
          console.log("❌ 请提供地址：node scripts/tron-store.js list TXXX... 20");
          return;
        }
        console.log(`📋 查询 ${address} 在 ${NETWORK} 的存证记录（最多 ${limit} 条）...`);
        const records = await listStoredRecords(address, NETWORK, limit);
        if (records.length === 0) {
          console.log("（暂无带 memo 的交易）");
          return;
        }
        console.log("");
        console.log(`共找到 ${records.length} 条存证记录：`);
        records.forEach((r, i) => {
          console.log("");
          console.log(`#${i + 1}  📦 区块 #${r.blockNumber || "?"}  ⏰ ${r.timestamp || "?"}`);
          console.log(`     🆔 ${r.txID}`);
          console.log(`     📝 memo (${r.memoBytes} 字节): ${(r.memoText || "").slice(0, 80)}${r.memoText && r.memoText.length > 80 ? "…" : ""}`);
          console.log(`     🔗 ${r.explorer}`);
        });
      }
      break;

    default:
      console.error(`❌ 未知命令: ${cmd}`);
      console.error("运行 node scripts/tron-store.js help 查看用法");
  }
}

main().catch((e) => {
  console.error("\n❌ 执行出错:", e.message);
  if (process.env.DEBUG) console.error(e.stack);
});
