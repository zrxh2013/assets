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
// 2. 构造锚定 memo 并广播到目标网络（默认主网，可切到 Nile 用于演示闭环）
// ──────────────────────────────────────────────
async function anchorNileTx({
  privateKey,
  nileTxID,
  targetNetwork = "mainnet",     // "mainnet" | "nile"
  sourceNetwork = "nile",        // 源网络（目前只支持 nile，留扩展位）
  comment = "",
  includeMemo = true,
  amount = 0, // 可选：给接收方转 TRX；默认 0（只写 memo）
}) {
  if (!privateKey) throw new Error("必须提供 TRON_PRIVATE_KEY");
  if (!config[targetNetwork]) throw new Error("未知目标网络: " + targetNetwork);

  const twTgt = new TronWeb({
    fullHost: config[targetNetwork].fullNode,
    privateKey,
  });
  const fromAddr = twTgt.defaultAddress.base58;

  // 1. 抓取源交易
  const src = sourceNetwork === "nile" ? await fetchNileTx(nileTxID) : null;
  if (!src) throw new Error("源交易抓取失败");

  // 2. 构造锚定 memo（JSON → hex，注意不能太长）
  const payload = {
    a: "nile-anchor",
    v: 1,
    src: sourceNetwork,
    tgt: targetNetwork,
    n: {
      tx: nileTxID,
      bn: src.blockNumber,
      ts: src.timestamp,
      st: src.status,
      fr: src.from,
      to: src.to,
      tp: src.contractType,
      am: src.amount,
    },
  };
  if (comment) payload.c = comment;
  if (includeMemo && src.memoDecoded) {
    const md = src.memoDecoded;
    const max = 120;
    payload.n.da = md.length > max ? md.slice(0, max) + "…" : md;
    if (src.memoIsJson && src.memoJson && src.memoJson.h) {
      payload.n.h = src.memoJson.h;
    }
  }

  let memoStr;
  try {
    memoStr = JSON.stringify(payload);
    // Tron raw_data.data 支持 ~1KB，这里用 900 作为安全上限，
    // 超过才截断 memo 内容（先缩短 da，再删 da）。
    const HARD = 900, SOFT = 600;
    const len = () => Buffer.from(memoStr, "utf8").length;
    if (len() > SOFT && payload.n && payload.n.da) {
      const half = Math.floor(Math.max(40, SOFT - (len() - payload.n.da.length))) ;
      payload.n.da = payload.n.da.length > half
        ? payload.n.da.slice(0, half) + "…" : payload.n.da;
      memoStr = JSON.stringify(payload);
    }
    if (len() > HARD && payload.n && payload.n.da) {
      delete payload.n.da;
      memoStr = JSON.stringify(payload);
    }
  } catch (e) {
    throw new Error("锚定 JSON 序列化失败: " + e.message);
  }

  // 3. 广播：给「Tron 官方 Burn 地址」转 1 SUN（0.000001 TRX），
  //    memo 存锚定数据。
  //    ⚠️ 必须在 sendTrx 后修改 raw_data.data 并通过 utils.transaction
  //       重新序列化（txJsonToPb → 重算 txID + raw_data_hex），否则
  //       raw_data_hex 未包含 data 字段，导致签名不匹配 / "Invalid transaction"。
  const toAddr = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"; // Tron 官方 burn 地址
  const amountSUN = Math.max(1, amount * 1e6); // 默认 1 SUN

  const unSignedTx = await twTgt.transactionBuilder.sendTrx(
    toAddr, amountSUN, fromAddr
  );
  // 注入 memo（raw_data.data 必须是 hex 编码的 UTF-8 字符串）
  unSignedTx.raw_data.data = Buffer.from(memoStr, "utf8").toString("hex");
  // 重新序列化：保证 txID、raw_data_hex 与修改后的 raw_data 一致
  const txUtil = twTgt.utils.transaction;
  const pb = txUtil.txJsonToPb(unSignedTx);
  unSignedTx.txID = txUtil.txPbToTxID(pb).replace(/^0x/, "");
  unSignedTx.raw_data_hex = txUtil.txPbToRawDataHex(pb).toLowerCase();
  // 签名 + 广播
  const signed = await twTgt.trx.sign(unSignedTx);
  const result = await twTgt.trx.sendRawTransaction(signed);

  if (!result.result) {
    throw new Error(`${targetNetwork} 广播失败: ` + JSON.stringify(result));
  }

  const explorerBase = targetNetwork === "nile"
    ? "https://nile.tronscan.org/#/transaction/"
    : "https://tronscan.org/#/transaction/";

  return {
    ok: true,
    src,
    anchor: {
      network: targetNetwork,
      txID: signed.txID,
      from: fromAddr,
      to: toAddr,
      memo: payload,
      memoStr,
      fee: (targetNetwork === "nile" ? "≈ 1.0~1.4 TRX (Nile testnet, memo fee)" : "≈ 1.0~1.4 TRX (memo fee 1 TRX + bandwidth)"),
      explorer: explorerBase + signed.txID,
      nileExplorer: "https://nile.tronscan.org/#/transaction/" + nileTxID,
    },
  };
}

// ──────────────────────────────────────────────
// 3. 解码锚定交易（自动：主网 → Nile 兜底，任何一个找到都返回）
// ──────────────────────────────────────────────
async function decodeAnchorTx(txID) {
  const twMain = createClient("mainnet");
  const twNile = createClient("nile");

  // 并行查 2 个网络
  let found = null; // { network, tx, info }
  for (const [net, tw] of [["mainnet", twMain], ["nile", twNile]]) {
    try {
      const tx = await tw.trx.getTransaction(txID);
      if (tx && tx.raw_data) {
        let info = null;
        try { info = await tw.trx.getTransactionInfo(txID); } catch (_) {}
        found = { network: net, tx, info };
        break;
      }
    } catch (_) {}
  }

  if (!found) return { ok: false, reason: "tx_not_found_on_both_networks" };

  const { network, tx, info } = found;
  const data = tx.raw_data.data;
  let memoUtf8 = "";
  if (data) {
    try { memoUtf8 = Buffer.from(data, "hex").toString("utf8"); } catch (_) {}
  }

  let anchorData = null;
  if (memoUtf8) {
    try {
      const obj = JSON.parse(memoUtf8);
      if (obj && obj.a === "nile-anchor") anchorData = obj;
    } catch (_) {}
  }

  return {
    ok: true,
    network,
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
//    优先级：锚定解码(主网→Nile) → Nile 源交易
// ──────────────────────────────────────────────
async function resolveAnyTxID(txID) {
  // 1. 解码锚定（自动查主网+Nile）
  const decoded = await decodeAnchorTx(txID);
  if (decoded.ok) {
    return {
      foundOn: decoded.network,
      ...decoded,
    };
  }

  // 2. 尝试 Nile（普通交易，非锚定）
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
