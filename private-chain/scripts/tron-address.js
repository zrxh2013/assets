// scripts/tron-address.js
// EVM 地址 ↔ 波场（Tron）地址 对照表

const { ethers } = require("ethers");

// Hardhat 默认的 10 个测试账户（相同助记词衍生）
const hardhatAccounts = [
  {
    index: 0,
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    label: "Deployer / Owner",
  },
  {
    index: 1,
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    label: "User 1",
  },
  {
    index: 2,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000001",
    label: "User 2",
  },
  {
    index: 3,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000002",
    label: "User 3",
  },
  {
    index: 4,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000003",
    label: "User 4",
  },
  {
    index: 5,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000004",
    label: "User 5",
  },
  {
    index: 6,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000005",
    label: "User 6",
  },
  {
    index: 7,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000006",
    label: "User 7",
  },
  {
    index: 8,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000007",
    label: "User 8",
  },
  {
    index: 9,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a10000000008",
    label: "User 9",
  },
];

/**
 * EVM 地址转波场地址（简化版 Base58Check 编码）
 * 波场地址格式：0x41 (主网前缀) + EVM 地址的后 20 字节 + 4 字节校验和
 */
function evmToTronAddress(evmAddress) {
  // 去掉 0x 前缀，取后 40 个 hex 字符（20 字节）
  const evmHex = evmAddress.toLowerCase().replace(/^0x/, "");
  if (evmHex.length !== 40) throw new Error("Invalid EVM address");

  // 波场前缀 0x41 + 20 字节公钥哈希
  const tronPayloadHex = "41" + evmHex;

  // 计算两次 SHA256 得到校验和
  const payloadBytes = Buffer.from(tronPayloadHex, "hex");
  const hash1 = cryptoSha256(payloadBytes);
  const hash2 = cryptoSha256(hash1);
  const checksum = hash2.slice(0, 4);

  // 拼接并 Base58 编码
  const fullBytes = Buffer.concat([payloadBytes, checksum]);
  return base58Encode(fullBytes);
}

// 简易 SHA256
function cryptoSha256(buffer) {
  return Buffer.from(
    ethers.sha256(buffer).replace(/^0x/, ""),
    "hex"
  );
}

// Base58 编码（Bitcoin 字母表）
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(buffer) {
  // 计算前导零的个数
  let zeroCount = 0;
  while (zeroCount < buffer.length && buffer[zeroCount] === 0) zeroCount++;

  // 转换为 Base58 数字
  let num = BigInt(0);
  for (let i = 0; i < buffer.length; i++) {
    num = num * 256n + BigInt(buffer[i]);
  }

  let result = "";
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result = BASE58_ALPHABET[remainder] + result;
  }

  // 补充前导零
  return "1".repeat(zeroCount) + result;
}

/**
 * 通过私钥计算 EVM 地址
 */
function privateKeyToEvmAddress(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.address;
}

// ===== 主流程 =====
console.log("==================================================");
console.log("   EVM ↔ 波场 (Tron) 地址对照表");
console.log("==================================================");
console.log("");

// Hardhat 启动时，第一个账户是基于固定助记词的
// 这里直接用第一个账户的私钥计算
const standardAccount0 = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const standardAccounts = [
  { label: "Account #0 (Deployer)",   key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  { label: "Account #1 (User 1)",     key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  { label: "Account #2 (User 2)",     key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  { label: "Account #3 (User 3)",     key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  { label: "Account #4 (User 4)",     key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
  { label: "Account #5 (User 5)",     key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
  { label: "Account #6 (User 6)",     key: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" },
  { label: "Account #7 (User 7)",     key: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" },
  { label: "Account #8 (User 8)",     key: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" },
  { label: "Account #9 (User 9)",     key: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" },
];

console.log("Hardhat 默认助记词账户：");
console.log("test test test test test test test test test test test junk");
console.log("");

console.log(
  `${"序号".padEnd(4)}${"角色".padEnd(22)}${"EVM 地址".padEnd(46)}${"Tron 地址"}`
);
console.log("─".repeat(130));

standardAccounts.forEach((acc, i) => {
  const wallet = new ethers.Wallet(acc.key);
  const evmAddr = wallet.address;
  const tronAddr = evmToTronAddress(evmAddr);
  console.log(
    `${String(i).padEnd(4)}${acc.label.padEnd(22)}${evmAddr.padEnd(46)}${tronAddr}`
  );
});

console.log("");
console.log("说明：");
console.log("  • EVM 地址：以太坊/BSC/Hardhat 链上使用的 0x 开头地址");
console.log("  • Tron 地址：波场链上使用的 T 开头 Base58 编码地址");
console.log("  • 两者底层公钥哈希相同，仅前缀和编码方式不同");
console.log("==================================================");
