// tron/address-generator.js
// 波场地址批量生成器
// 支持：HD 钱包助记词派生、私钥生成、EVM↔Tron 双地址导出、CSV/JSON 保存

const TronWebLib = require("tronweb");
const TronWeb = TronWebLib.TronWeb;
const bip39 = require("bip39");
const { ethers } = require("ethers");

// 延迟初始化一个 tronWeb 实例（仅用于地址编码校验，不需要 RPC）
function _tronWeb() {
  return new TronWeb({ fullHost: "https://api.trongrid.io" });
}

/**
 * BIP44 路径：波场链 coin_type = 195
 * m / 44' / 195' / account' / change / address_index
 */
const TRON_BIP44_PATH = "m/44'/195'/0'/0/";

/**
 * 从助记词生成 HD 钱包并派生子地址
 * @param {string} mnemonic - BIP39 助记词（为空则自动生成）
 * @param {number} count - 生成地址数量
 * @param {number} startIndex - 起始索引
 */
function generateAddressesFromMnemonic(mnemonic = null, count = 10, startIndex = 0) {
  // 如未提供助记词，生成新的 12 词助记词（128 位熵）
  if (!mnemonic) {
    mnemonic = bip39.generateMnemonic(128);
  }
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error("无效的助记词");
  }

  const results = [];

  for (let i = startIndex; i < startIndex + count; i++) {
    const path = TRON_BIP44_PATH + i;
    // ethers v6: 直接通过 fromPhrase 指定期望的完整派生路径
    const node = ethers.HDNodeWallet.fromPhrase(mnemonic, "", path);
    const privateKey = node.privateKey; // 0x 开头的 64 hex
    const evmAddress = node.address;    // 0x 开头 EVM 地址

    // EVM 地址转波场地址（前缀 0x41 + Base58Check）
    const validTronAddr = _tronWeb().address.fromHex("41" + evmAddress.replace(/^0x/i, ""));

    results.push({
      index: i,
      path,
      mnemonic: mnemonic, // 同根助记词（可选按需导出）
      privateKey: privateKey.replace(/^0x/, ""), // tronweb 需要不带 0x
      evmAddress,
      tronAddress: validTronAddr,
      tronHex: "41" + evmAddress.replace(/^0x/i, ""),
    });
  }

  return {
    mnemonic,
    count,
    addresses: results,
  };
}

/**
 * 随机生成单个独立地址（非 HD，独立私钥）
 */
function generateSingleAddress() {
  const wallet = ethers.Wallet.createRandom();
  const evmAddress = wallet.address;
  const tronAddress = _tronWeb().address.fromHex("41" + evmAddress.replace(/^0x/i, ""));
  return {
    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
    privateKey: wallet.privateKey.replace(/^0x/, ""),
    evmAddress,
    tronAddress,
    tronHex: "41" + evmAddress.replace(/^0x/i, ""),
  };
}

/**
 * 根据私钥反查地址
 */
function fromPrivateKey(privateKey) {
  const wallet = new ethers.Wallet(privateKey.startsWith("0x") ? privateKey : "0x" + privateKey);
  const evmAddress = wallet.address;
  const tronAddress = _tronWeb().address.fromHex("41" + evmAddress.replace(/^0x/i, ""));
  return {
    privateKey: wallet.privateKey.replace(/^0x/, ""),
    evmAddress,
    tronAddress,
    tronHex: "41" + evmAddress.replace(/^0x/i, ""),
  };
}

/**
 * EVM 地址 → 波场地址（内置实现，也用于兜底）
 */
function evmToTron(evmAddress) {
  return _tronWeb().address.fromHex("41" + evmAddress.replace(/^0x/i, ""));
}

/**
 * 波场地址 → EVM 地址
 */
function tronToEvm(tronAddress) {
  const hex = _tronWeb().address.toHex(tronAddress);
  // 去掉前缀 41，加上 0x
  return "0x" + hex.slice(2);
}

/**
 * 校验波场地址是否有效
 */
function isValidTronAddress(addr) {
  try {
    return !!_tronWeb().address.toHex(addr);
  } catch {
    return false;
  }
}

/**
 * 将结果导出为 CSV 字符串
 */
function toCSV(data, includePrivateKey = true) {
  const headers = includePrivateKey
    ? ["Index", "BIP44 Path", "Tron Address", "EVM Address", "Private Key", "Mnemonic"]
    : ["Index", "BIP44 Path", "Tron Address", "EVM Address"];

  const lines = [headers.join(",")];
  data.addresses.forEach((row) => {
    const values = [
      row.index,
      row.path || "-",
      row.tronAddress,
      row.evmAddress,
    ];
    if (includePrivateKey) {
      values.push(row.privateKey);
      values.push(data.mnemonic || "");
    }
    // 处理 CSV 转义
    lines.push(values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  });
  return lines.join("\n");
}

/**
 * 输出为 JSON 字符串
 */
function toJSON(data, pretty = true) {
  return JSON.stringify(data, null, pretty ? 2 : 0);
}

module.exports = {
  generateAddressesFromMnemonic,
  generateSingleAddress,
  fromPrivateKey,
  evmToTron,
  tronToEvm,
  isValidTronAddress,
  toCSV,
  toJSON,
  TRON_BIP44_PATH,
};
