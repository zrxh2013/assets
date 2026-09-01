// tron/anchor.js
// Nile 测试网 txID → 波场主网锚定存证 模块
//
// 用途：
//   将测试网的交易（存证/转账等）作为锚定证据，在主网写入一条 memo 交易，
//   使得主网浏览器可直接查到“某个主网哈希”对应的原文（原文里包含 Nile txID + 交易摘要）。
//
// 思路：
//   - 每条 Nile 交易 → 1 条主网带 memo 的 TRX 转账（0 TRX 金额，付 1 TRX memo 费）
//   - memo JSON 结构：
//     {
//       "a": "nile-anchor",            // 锚定标记
//       "v": 1,                        // 版本
//       "n": {                         // 源交易（Nile）
//         "tx": "<nile txID>",
//         "bn": 区块高度,
//         "tm": 时间戳,
//         "fr": "发送方",
//         "to": "接收方",
//         "tp": "类型 TRX Transfer / Memo Store ...",
//         "da": "原文 memo（可空，用于还原内容）",
//         "h" : "原文 hash（可选）"
//       },
//       "c": "补充备注",
//       "s": "<发起方 T 地址签名>"   // 可选，暂留空
//     }

const TronWebLib = require("tronweb");
const TronWeb = TronWebLib.TronWeb;
const { createClient, config } = require("./client");

// ──────────────────────────────────────────────
// 1. 抓取 Nile 交易详情（含 memo 解码）
// ──────────────────────────────────────────────
async function fetchNileTx(txID) {
  const twNile = createClient("nile");

  // 并行抓 tx、txInfo、如失败抛出
  const [tx, info] = await Promise.all([
    twNile.trx.getTransaction(txID),
    twNile.trx.getTransactionInfo(txID),
  ]);
  if (!tx || !tx.txID) throw new Error("Nile txID 不存在: " + txID);

  const contract = tx.raw_data.contract && tx.raw_data.contract[0];
  const p = contract.parameter.value;
  const owner = contract.owner_address || p.owner_address;
  const ctype = contract.type;

  const result = {
    txID,
    blockNumber: info.blockNumber || 0,
    timestamp: (info.blockTimeStamp || tx.raw_data.timestamp || 0),
    status: tx.ret && tx.ret[0] ? tx.ret[0].contractRet : "UNKNOWN",
    contractType: ctype,
    from: owner ? twNile.address.fromHex(owner) : "",
    to: "",
    amount: 0,
    memo: "",
    memoDecoded: "",
  };

  // 2. 根据类型提取字段
  switch (ctype) {
    case "TransferContract":
      result.to = p.to_address ? twNile.address.fromHex(p.to_address) : "";
      result.amount = Number(p.amount || 0);
      break;
    case "TransferAssetContract":
      result.to = p.to_address ? twNile.address.fromHex(p.to_address) : "";
      result.amount = Number(p.amount || 0);
      result.assetName = p.asset_name;
      break;
    case "TriggerSmartContract":
      result.to = p.contract_address ? twNile.address.fromHex(p.contract_address) : "";
      result.callValue = p.call_value;
      result.data = p.data || "";
      break;
  }

  // 3. 解码 memo（Hex → UTF-8 / JSON）
  if (tx.raw_data.data) {
    result.memo = tx.raw_data.data;
    try {
      const buf = Buffer.from(tx.raw_data.data, "hex");
      result.memoDecoded = buf.toString("utf8");
      // 尝试 JSON 美化
      try {
        const obj = JSON.parse(result.memoDecoded);
        result.memoIsJson = true;
        result.memoJson = obj;
      } catch (_) {
        result.memoIsJson = false;
      }
    } catch (_) {}
  }

  return result;
}

// ──────────────────────────────────────────────
// 2. 构造锚定 memo 并广播到主网
// ──────────────────────────────────────────────
async function anchorNileTx({
  privateKey,
  nileTxID,
  comment = "",
  includeMemo = true,
  amount = 0, // 可选：给接收方转 TRX；默认 0（只写 memo）
}) {
  if (!privateKey) throw new Error("必须提供主网私钥 TRON_PRIVATE_KEY");

  const twMain = new TronWeb({
    fullHost: config.mainnet.fullNode,
    privateKey,
  });
  const fromAddr = twMain.defaultAddress.base58;

  // 1. 抓取 Nile 交易
  const nile = await fetchNileTx(nileTxID);

  // 2. 构造锚定 memo（JSON → hex，注意不能太长）
  const payload = {
    a: "nile-anchor",
    v: 1,
    n: {
      tx: nileTxID,
      bn: nile.blockNumber,
      ts: nile.timestamp,
      st: nile.status,
      fr: nile.from,
      to: nile.to,
      tp: nile.contractType,
      am: nile.amount,
    },
  };
  if (comment) payload.c = comment;
  if (includeMemo && nile.memoDecoded) {
    // 截断过长的 memo，避免超过 200 字节
    const md = nile.memoDecoded;
    const max = 120;
    payload.n.da = md.length > max ? md.slice(0, max) + "…" : md;
    if (nile.memoIsJson && nile.memoJson && nile.memoJson.t) {
      payload.n.h = nile.memoJson.h;
    }
  }

  let memoStr;
  try {
    memoStr = JSON.stringify(payload);
    if (Buffer.from(memoStr, "utf8").length > 200) {
      // 再去掉 da（内容原文）
      delete payload.n.da;
      memoStr = JSON.stringify(payload);
    }
  } catch (e) {
    throw new Error("锚定 JSON 序列化失败: " + e.message);
  }

  // 3. 广播（TRX 转账，默认 amount=0，使用 memo 模式）
  const toAddr = fromAddr; // 自转账，零金额避免亏损
  const amountSUN = amount * 1e6; // 可选转额
  const unSignedTx = await twMain.transactionBuilder.sendTrx(
    toAddr,
    amountSUN,
    fromAddr
  );
  // 添加 memo
  unSignedTx.raw_data.data = Buffer.from(memoStr, "utf8").toString("hex");
  // 重新计算 txID
  const signed = await twMain.trx.sign(unSignedTx);
  const result = await twMain.trx.sendRawTransaction(signed);

  if (!result.result) {
    throw new Error("主网广播失败: " + JSON.stringify(result));
  }

  return {
    ok: true,
    nile,
    anchor: {
      network: "mainnet",
      txID: signed.txID,
      from: fromAddr,
      to: toAddr,
      memo: payload,
      memoStr,
      fee: "≈ 1.0~1.4 TRX (memo fee 1 TRX + bandwidth)",
      explorer: "https://tronscan.org/#/transaction/" + signed.txID,
      nileExplorer: "https://nile.tronscan.org/#/transaction/" + nileTxID,
    },
  };
}

// ──────────────────────────────────────────────
// 3. 解码主网锚定交易
// ──────────────────────────────────────────────
async function decodeAnchorTx(txID) {
  const twMain = createClient("mainnet");
  let tx;
  try {
    tx = await twMain.trx.getTransaction(txID);
  } catch (e) {
    // 如果主网查不到，可能是 Nile 的，让 caller 处理
    return { ok: false, reason: "tx_not_found_on_mainnet", message: e.message };
  }
  if (!tx || !tx.raw_data) return { ok: false, reason: "tx_not_found" };

  const data = tx.raw_data.data;
  let memoUtf8 = "";
  if (data) {
    try {
      memoUtf8 = Buffer.from(data, "hex").toString("utf8");
    } catch (_) {}
  }

  // 检查是否锚定
  let anchorData = null;
  if (memoUtf8) {
    try {
      const obj = JSON.parse(memoUtf8);
      if (obj && obj.a === "nile-anchor") {
        anchorData = obj;
      }
    } catch (_) {}
  }

  // 抓 tx info 补齐块高/时间
  let info = null;
  try {
    info = await twMain.trx.getTransactionInfo(txID);
  } catch (_) {}

  return {
    ok: true,
    blockNumber: info ? info.blockNumber : null,
    timestamp: info ? info.blockTimeStamp : tx.raw_data.timestamp,
    status: tx.ret && tx.ret[0] ? tx.ret[0].contractRet : "UNKNOWN",
    fee: info ? info.fee : null,
    rawMemo: memoUtf8,
    isAnchor: !!anchorData,
    anchor: anchorData,
  };
}

// ──────────────────────────────────────────────
// 4. 智能查询：输入任意 txID，自动判断来源
//    优先级：锚定解码(主网) → 主网普通交易 → Nile 交易
// ──────────────────────────────────────────────
async function resolveAnyTxID(txID) {
  const twMain = createClient("mainnet");
  const twNile = createClient("nile");

  // 1. 尝试主网（解码锚定）
  try {
    const decoded = await decodeAnchorTx(txID);
    if (decoded.ok) {
      return {
        foundOn: "mainnet",
        ...decoded,
      };
    }
  } catch (_) {}

  // 2. 尝试 Nile
  try {
    const nile = await fetchNileTx(txID);
    return { foundOn: "nile", nile };
  } catch (_) {}

  return { foundOn: "none", message: "txID 在主网和 Nile 均未找到" };
}

module.exports = {
  fetchNileTx,
  anchorNileTx,
  decodeAnchorTx,
  resolveAnyTxID,
};
