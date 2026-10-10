// tron/store.js
// 波场链数据存证模块（上链存储 + 链上读取）
//
// 原理：
//   波场 TRX 转账交易支持附加 memo（写入 raw_data.data 字段，hex 编码）。
//   把任意文本/JSON 编码后写入 memo，整笔交易即成为一条链上存证记录。
//   任何人都可通过 txID 在 tronscan.org / tronweb 查询并解码出原文。
//
// 成本：
//   - 转账金额（可设为 1 SUN = 0.000001 TRX，几乎为零）
//   - memo 费用：1 TRX（波场对带 memo 的交易固定收取）
//   - 带宽/能量：账户有免费额度可用
//
// 容量：
//   - memo 字段 hex 编码，UTF-8 文本建议 ≤ 200 字节（中文约 60 字以内）
//   - 超长内容建议先哈希再上链（存储 SHA-256 即可证明原文）

const TronWebLib = require("tronweb");
const TronWeb = TronWebLib.TronWeb;
const crypto = require("crypto");
const config = require("./config");

// Hardhat 默认 5 个账户的 T 地址（波场链上同私钥等价表示）
// 当用户未指定接收方、或接收方=发送方时，自动选其中不冲突的地址作为接收方
const FALLBACK_RECEIVE_ADDRS = [
  "TLEaY8XoqpBmndLsjcfThgdKLN1ssNuUcF", // Hardhat User 1
  "TFTsyAaajS3DTEbekme2wm9fNcypguDHp4", // Hardhat User 2
  "TPBivseBCFmG8AEL38DJ4hxrFMQteENxDz", // Hardhat User 3
  "TBxcJtrCeCFkHp47jshFMBWGB1n7igSHm2", // Hardhat User 4
];

/**
 * 创建 TronWeb 客户端（带签名能力）
 * @param {"mainnet"|"nile"} network
 * @param {string} privateKey 发送方私钥
 */
function createClient(network = "mainnet", privateKey) {
  const cfg = config[network];
  if (!cfg) throw new Error(`未知网络: ${network}（可选: mainnet / nile）`);
  if (!privateKey) throw new Error("缺少 privateKey，无法签名交易");
  return new TronWeb({
    fullHost: cfg.fullNode,
    privateKey: privateKey,
  });
}

/**
 * 把任意文本/JSON 上链存证
 * @param {string} privateKey  发送方私钥
 * @param {string} content    要存证的内容（文本或 JSON 字符串）
 * @param {object} opts       { network, toAddress, amountSun }
 * @returns {Promise<object>} 存证结果
 */
async function storeData(privateKey, content, opts = {}) {
  const network = opts.network || "mainnet";
  const tronWeb = createClient(network, privateKey);

  const fromAddress = tronWeb.defaultAddress.base58;
  // 接收方：
  // - 如果用户指定且与发送方不同，使用用户指定
  // - 否则从 Hardhat 默认账户中自动挑选一个不冲突的地址
  //   (波场不允许向同一账户转账 TRX)
  let toAddress = opts.toAddress;
  if (!toAddress || toAddress === fromAddress) {
    toAddress = FALLBACK_RECEIVE_ADDRS.find((a) => a !== fromAddress) || FALLBACK_RECEIVE_ADDRS[0];
  }
  // 默认 1 SUN（最小单位，几乎为零）
  const amountSun = opts.amountSun || 1;

  // 1. 创建未签名 TRX 转账交易
  const unsignTx = await tronWeb.transactionBuilder.sendTrx(
    toAddress,
    amountSun,
    fromAddress
  );
  if (!unsignTx || unsignTx.Error) {
    throw new Error(`创建交易失败: ${unsignTx && unsignTx.Error}`);
  }

  // 2. 附加 memo（data 字段）—— 内容以 UTF-8 → hex 编码
  //    tronWeb.addUpdateData 第二参数是字符串，会自动转 hex 写入 raw_data.data
  const txWithData = await tronWeb.transactionBuilder.addUpdateData(
    unsignTx,
    content
  );

  // 3. 签名
  //    不传 privateKey 参数，让 tronWeb 用创建客户端时设置的 defaultPrivateKey
  //    （传带 0x 前缀的私钥会触发 tronweb v6 内部 hexStr2byteArray 的 bug）
  const signedTx = await tronWeb.trx.sign(txWithData);

  // 4. 广播（tronweb v6 使用 sendRawTransaction）
  const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
  const txID = signedTx.txID;

  // 5. 等待上链（轮询 getTransactionInfo）
  let confirmed = false;
  let receipt = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      receipt = await tronWeb.trx.getTransactionInfo(txID);
      if (receipt && receipt.id) {
        confirmed = true;
        break;
      }
    } catch (e) {
      // 还没上链，继续等
    }
  }

  return {
    network,
    txID,
    fromAddress,
    toAddress,
    amountSun,
    amountTrx: amountSun / config.sun,
    memoBytes: Buffer.byteLength(content, "utf8"),
    contentPreview: content.length > 80 ? content.slice(0, 80) + "…" : content,
    contentSha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
    broadcastResult: broadcast,
    confirmed,
    blockNumber: confirmed ? receipt.blockNumber : null,
    blockTimestamp: confirmed && receipt.blockTimeStamp
      ? new Date(receipt.blockTimeStamp).toISOString()
      : null,
    explorer: network === "mainnet"
      ? `https://tronscan.org/#/transaction/${txID}`
      : `https://nile.tronscan.org/#/transaction/${txID}`,
  };
}

/**
 * 从交易哈希读取链上存证内容（解码 memo data）
 * @param {string} txID
 * @param {"mainnet"|"nile"} network
 */
async function retrieveData(txID, network = "mainnet") {
  const cfg = config[network];
  if (!cfg) throw new Error(`未知网络: ${network}`);
  const tronWeb = new TronWeb({ fullHost: cfg.fullNode });

  // 先取交易详情（拿到 raw_data.data）
  const tx = await tronWeb.trx.getTransaction(txID);
  if (!tx || tx.Error) {
    throw new Error(`查询交易失败: ${txID} - ${tx && tx.Error}`);
  }

  // raw_data.data 是 hex 字符串
  let memoHex = null;
  let memoText = null;
  try {
    memoHex = tx.raw_data && tx.raw_data.data;
    if (memoHex) {
      memoText = Buffer.from(memoHex, "hex").toString("utf8");
    }
  } catch (e) {
    // 解码失败
  }

  // 取交易回执（拿区块号、消耗等）
  let receipt = null;
  try {
    receipt = await tronWeb.trx.getTransactionInfo(txID);
  } catch (e) {}

  // 状态字段：tx.ret[0].contractRet = "SUCCESS" / "FAILED"
  const ret = Array.isArray(tx.ret) && tx.ret[0] ? tx.ret[0] : {};
  const statusText = ret.contractRet === "SUCCESS"
    ? "✅ 成功"
    : ret.contractRet === "FAILED"
      ? "❌ 失败"
      : "未知";

  const contract = (tx.raw_data && tx.raw_data.contract && tx.raw_data.contract[0]) || {};
  const value = contract.parameter && contract.parameter.value;

  return {
    txID: tx.txID,
    network,
    blockNumber: receipt ? receipt.blockNumber : (tx.blockNumber || null),
    blockTimestamp: receipt && receipt.blockTimeStamp
      ? new Date(receipt.blockTimeStamp).toISOString()
      : null,
    status: statusText,
    feeTrx: receipt && receipt.fee ? receipt.fee / config.sun : null,
    contractType: contract.type,
    from: value ? tronWeb.address.fromHex(value.owner_address) : null,
    to: value && value.to_address ? tronWeb.address.fromHex(value.to_address) : null,
    amountSun: value ? value.amount : null,
    amountTrx: value && value.amount ? value.amount / config.sun : null,
    memoHex,
    memoText,
    memoBytes: memoHex ? memoHex.length / 2 : 0,
    explorer: network === "mainnet"
      ? `https://tronscan.org/#/transaction/${txID}`
      : `https://nile.tronscan.org/#/transaction/${txID}`,
  };
}

/**
 * 列出某地址最近的所有带 memo 的交易（存证记录）
 * 使用 TronGrid v1 transactions API（getTransactionsRelated 已废弃）
 * @param {string} address
 * @param {"mainnet"|"nile"} network
 * @param {number} limit  最多 200
 */
async function listStoredRecords(address, network = "mainnet", limit = 20) {
  const cfg = config[network];
  if (!cfg) throw new Error(`未知网络: ${network}`);

  // TronGrid v1 API: /v1/accounts/{addr}/transactions?limit={N}&only_to=true|false
  const apiUrl = `${cfg.fullNode}/v1/accounts/${address}/transactions?limit=${Math.min(limit, 200)}&order_by=block_timestamp,desc`;
  const resp = await fetch(apiUrl);
  if (!resp.ok) {
    throw new Error(`TronGrid API 错误: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  const txs = data.data || [];

  const records = [];
  for (const tx of txs) {
    const rawData = tx.raw_data || {};
    const memoHex = rawData.data;
    if (!memoHex) continue; // 只保留带 memo 的交易
    let memoText = null;
    try {
      memoText = Buffer.from(memoHex, "hex").toString("utf8");
    } catch {}
    records.push({
      txID: tx.txID,
      blockNumber: tx.blockNumber || null,
      timestamp: tx.block_timestamp
        ? new Date(tx.block_timestamp).toISOString()
        : null,
      memoText,
      memoBytes: memoHex.length / 2,
      explorer: network === "mainnet"
        ? `https://tronscan.org/#/transaction/${tx.txID}`
        : `https://nile.tronscan.org/#/transaction/${tx.txID}`,
    });
  }
  return records;
}

module.exports = {
  createClient,
  storeData,
  retrieveData,
  listStoredRecords,
};
