// scripts/tron-generate-address.js
// 波场地址批量生成工具
// 用法：
//   node scripts/tron-generate-address.js [数量] [助记词]           # 用HD钱包派生（默认10个，助记词不填自动生成）
//   node scripts/tron-generate-address.js single                   # 生成单个随机地址
//   node scripts/tron-generate-address.js from-key <私钥>          # 从私钥反查地址
//   node scripts/tron-generate-address.js convert <地址>           # EVM ↔ Tron 地址互转
//   node scripts/tron-generate-address.js verify <地址>            # 校验地址有效性
//   node scripts/tron-generate-address.js export csv [数量] >a.csv # 导出CSV
//   node scripts/tron-generate-address.js export json [数量] >a.json

const fs = require("fs");
const {
  generateAddressesFromMnemonic,
  generateSingleAddress,
  fromPrivateKey,
  evmToTron,
  tronToEvm,
  isValidTronAddress,
  toCSV,
  toJSON,
} = require("../tron/address-generator");

async function main() {
  const [_n, _s, cmd, ...args] = process.argv;

  if (!cmd || !isNaN(Number(cmd))) {
    // 数字开头当作数量，直接走 HD 生成
    const count = parseInt(cmd) || 10;
    const mnemonic = args[0] || null;
    return cmdGenerate(count, mnemonic, "table");
  }

  switch (cmd.toLowerCase()) {
    case "single":    return cmdSingle();
    case "from-key":  return cmdFromKey(args[0]);
    case "convert":   return cmdConvert(args[0]);
    case "verify":    return cmdVerify(args[0]);
    case "export":    return cmdExport(args[0], parseInt(args[1]) || 10, args[2]);
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`
  波场地址批量生成工具
  ──────────────────────

  基础生成 (HD 钱包 BIP44/195)
    node scripts/tron-generate-address.js [数量] [助记词]
        例: node scripts/tron-generate-address.js 20
        例: node scripts/tron-generate-address.js 100 "word1 word2 ... word12"

  其他命令
    single                              生成单个随机地址（非 HD）
    from-key   <私钥>                   从私钥反查地址
    convert    <0x地址 / T地址>         EVM ↔ 波场 地址互转
    verify     <T地址>                  校验波场地址有效性

  批量导出
    export csv|json [数量] [助记词]     将结果输出为 CSV / JSON
        例: node scripts/tron-generate-address.js export csv 100 > tron-addresses.csv
        例: node scripts/tron-generate-address.js export json 50 > tron-addresses.json

  ⚠️ 安全提示
    • 助记词和私钥属于敏感信息，务必离线保存，禁止上传到公开仓库。
    • 导出 CSV/JSON 默认包含私钥，注意权限控制。
`);
}

function renderTable(data) {
  const rows = data.addresses;
  console.log(`\x1b[1m📝 助记词 (请妥善保存):\x1b[0m`);
  console.log(`   \x1b[33m${data.mnemonic}\x1b[0m`);
  console.log("");
  console.log(`已生成 ${rows.length} 个地址（BIP44: m/44'/195'/0'/0/i）：`);
  console.log("");
  const header =
    `${"#".padEnd(4)}` +
    `${"波场地址 (T...)".padEnd(36)}` +
    `${"EVM 地址 (0x...)".padEnd(44)}` +
    `私钥 (前12位…)`;
  console.log(header);
  console.log("─".repeat(header.length + 30));
  rows.forEach((r) => {
    console.log(
      `${String(r.index).padEnd(4)}` +
      `${r.tronAddress.padEnd(36)}` +
      `${r.evmAddress.padEnd(44)}` +
      `${r.privateKey.slice(0, 12)}…`
    );
  });
  console.log("");
  console.log(`\x1b[2m💡 完整私钥请使用 export csv/json 命令导出，或在代码中查看 data.addresses[i].privateKey\x1b[0m`);
}

async function cmdGenerate(count, mnemonic, format) {
  if (count <= 0 || count > 10000) {
    throw new Error("数量需在 1~10000 之间");
  }
  const data = generateAddressesFromMnemonic(mnemonic, count);
  renderTable(data);
  // 顺便校验一下第一个地址的有效性
  const first = data.addresses[0];
  const ok = isValidTronAddress(first.tronAddress);
  console.log(ok ? "✅ 波场地址校验通过" : "⚠️ 地址校验失败");
}

async function cmdSingle() {
  const r = generateSingleAddress();
  console.log("🆕 随机生成的独立地址：");
  console.log("");
  console.log(`  📜 助记词:     \x1b[33m${r.mnemonic || "(无)"}\x1b[0m`);
  console.log(`  🔑 私钥:       ${r.privateKey}`);
  console.log(`  📮 波场地址:   ${r.tronAddress}`);
  console.log(`  📮 EVM 地址:   ${r.evmAddress}`);
  console.log(`  🔍 地址有效性: ${isValidTronAddress(r.tronAddress) ? "✅ 有效" : "❌ 无效"}`);
}

async function cmdFromKey(privateKey) {
  if (!privateKey) {
    throw new Error("请提供私钥");
  }
  const r = fromPrivateKey(privateKey);
  console.log("🔍 从私钥反查地址：");
  console.log("");
  console.log(`  🔑 私钥:       ${r.privateKey}`);
  console.log(`  📮 波场地址:   ${r.tronAddress}`);
  console.log(`  📮 EVM 地址:   ${r.evmAddress}`);
  console.log(`  🔍 地址有效性: ${isValidTronAddress(r.tronAddress) ? "✅ 有效" : "❌ 无效"}`);
}

async function cmdConvert(addr) {
  if (!addr) throw new Error("请提供要转换的地址");
  if (addr.startsWith("0x") && addr.length === 42) {
    const tron = evmToTron(addr);
    console.log(`  EVM → 波场:`);
    console.log(`    输入:  ${addr}`);
    console.log(`    输出:  ${tron}  ${isValidTronAddress(tron) ? "✅" : "⚠️"}`);
  } else if (addr.startsWith("T") && addr.length === 34) {
    const evm = tronToEvm(addr);
    console.log(`  波场 → EVM:`);
    console.log(`    输入:  ${addr}  ${isValidTronAddress(addr) ? "✅" : "⚠️"}`);
    console.log(`    输出:  ${evm}`);
  } else {
    throw new Error("地址格式无法识别（期望 0x 开头 EVM 地址 或 T 开头波场地址）");
  }
}

async function cmdVerify(addr) {
  if (!addr) throw new Error("请提供要校验的波场地址");
  const valid = isValidTronAddress(addr);
  console.log(
    valid
      ? `✅ 地址 "${addr}" 是有效的波场地址`
      : `❌ 地址 "${addr}" 不是有效的波场地址`
  );
  // 如果有效，同时输出 EVM 地址
  if (valid) {
    const evm = tronToEvm(addr);
    console.log(`   对应 EVM 地址: ${evm}`);
  }
}

async function cmdExport(type, count, mnemonic) {
  const data = generateAddressesFromMnemonic(mnemonic, count);
  if (type === "csv") {
    process.stdout.write(toCSV(data, true) + "\n");
  } else if (type === "json") {
    process.stdout.write(toJSON(data) + "\n");
  } else {
    throw new Error("导出格式只支持 csv 或 json");
  }
}

main().catch((e) => {
  console.error("❌ 错误：", e.message);
  process.exitCode = 1;
});
