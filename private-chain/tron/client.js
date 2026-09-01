// tron/client.js
// 波场链主网连接客户端 + 链上查询 API

const crypto = require("crypto");
const TronWebLib = require("tronweb");
const TronWeb = TronWebLib.TronWeb;
const config = require("./config");

/**
 * 创建 TronWeb 客户端
 * @param {"mainnet"|"nile"} network - 网络类型
 * @param {string} [privateKey] - 可选，用于签名交易的私钥；不传则自动生成临时私钥（仅用于只读合约调用）
 */
function createClient(network = "mainnet", privateKey = null) {
  const cfg = config[network];
  if (!cfg) throw new Error(`未知网络: ${network}`);
  // TronWeb v6 的合约只读调用（如 balanceOf）也需要 owner_address，
  // 无私钥时生成临时私钥以保证只读调用正常工作（该私钥无余额，无法签名广播）
  const key = privateKey || crypto.randomBytes(32).toString("hex");
  return new TronWeb({
    fullHost: cfg.fullNode,
    privateKey: key,
  });
}

/**
 * 查询地址的 TRX 余额
 */
async function getTrxBalance(tronWeb, address) {
  const sun = await tronWeb.trx.getBalance(address);
  return {
    sun: sun,
    trx: sun / config.sun,
  };
}

/**
 * 查询地址的 USDT 余额（调用 USDT 合约 balanceOf）
 */
async function getUsdtBalance(tronWeb, address, network = "mainnet") {
  const contractAddr = config.usdtContract[network];
  const contract = await tronWeb.contract().at(contractAddr);
  const rawBalance = await contract.balanceOf(address).call();
  const balance = Number(rawBalance.toString()) / 10 ** config.usdtDecimals;
  return {
    raw: rawBalance.toString(),
    usdt: balance,
  };
}

/**
 * 查询账户资源信息（带宽、能量、冻结金额）
 */
async function getAccountResource(tronWeb, address) {
  try {
    const resource = await tronWeb.trx.getAccountResources(address);
    return {
      // 带宽（用于转账、智能合约）
      netLimit: resource.NetLimit || 0,
      netUsed:  resource.NetUsed  || 0,
      netAvailable: Math.max(0, (resource.NetLimit || 0) - (resource.NetUsed || 0)),
      // 能量（用于智能合约执行）
      energyLimit: resource.EnergyLimit || 0,
      energyUsed:  resource.EnergyUsed  || 0,
      energyAvailable: Math.max(0, (resource.EnergyLimit || 0) - (resource.EnergyUsed || 0)),
      // 冻结获得的 TRX（stake）
      frozenBalance: resource.TotalNetWeight
        ? Number(resource.TotalNetWeight) / config.sun
        : 0,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 查询账户基本信息（地址是否激活、交易数量等）
 */
async function getAccountInfo(tronWeb, address) {
  try {
    const info = await tronWeb.trx.getAccount(address);
    return {
      activated: !!info.address,
      address: info.address ? tronWeb.address.fromHex(info.address) : address,
      balance: info.balance ? info.balance / config.sun : 0,
      createTime: info.create_time ? new Date(info.create_time).toISOString() : null,
      latestOpTime: info.latest_op_time ? new Date(info.latest_op_time).toISOString() : null,
      txCount: info.trx_count || 0,
      assetIssuedCount: info.asset_issued_count || 0,
      permissions: info.active_permission ? info.active_permission.length : 0,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 查询最近的交易记录（最多 limit 条）
 */
async function getRecentTransactions(tronWeb, address, limit = 10) {
  try {
    const txs = await tronWeb.trx.getTransactionsRelated(address, "all", limit);
    return txs.map((tx) => {
      const raw_data = tx.raw_data || {};
      const contractCall = (raw_data.contract && raw_data.contract[0]) || {};
      return {
        txID: tx.txID,
        blockNumber: tx.blockNumber || "pending",
        timestamp: tx.block_timestamp
          ? new Date(tx.block_timestamp).toISOString()
          : (raw_data.timestamp ? new Date(raw_data.timestamp).toISOString() : "pending"),
        contractType: contractCall.type || "Unknown",
        status: tx.ret && tx.ret[0] ? tx.ret[0].contractRet : "UNKNOWN",
        fee: (tx.fee || 0) / config.sun,
      };
    });
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 查询指定区块高度的信息
 */
async function getBlockByNumber(tronWeb, blockNumber) {
  try {
    const block = await tronWeb.trx.getBlock(blockNumber);
    return {
      blockNumber: block.block_header.raw_data.number,
      txTrieRoot: block.block_header.raw_data.txTrieRoot,
      witnessAddress: tronWeb.address.fromHex(block.block_header.raw_data.witness_address),
      parentHash: block.block_header.raw_data.parentHash,
      timestamp: new Date(block.block_header.raw_data.timestamp).toISOString(),
      txCount: (block.transactions || []).length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 查询当前区块高度
 */
async function getCurrentBlock(tronWeb) {
  try {
    const block = await tronWeb.trx.getCurrentBlock();
    return {
      blockNumber: block.block_header.raw_data.number,
      timestamp: new Date(block.block_header.raw_data.timestamp).toISOString(),
      witnessAddress: tronWeb.address.fromHex(block.block_header.raw_data.witness_address),
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 查询 USDT 合约交易（Transfer 事件）
 */
async function getUsdtTransfers(tronWeb, address, network = "mainnet", limit = 10) {
  const contractAddr = config.usdtContract[network];
  try {
    // 使用 TronGrid 的事件 API
    const contract = await tronWeb.contract().at(contractAddr);
    const events = await contract.Transfer().getEvents({
      fromBlock: 0,
      toBlock: "latest",
      limit,
      filters: {
        // 可以只查某地址的转入转出
        from: tronWeb.address.toHex(address),
      },
    });
    return events.map((e) => ({
      txID: e.transaction,
      blockNumber: e.block,
      timestamp: new Date(e.timestamp).toISOString(),
      from: tronWeb.address.fromHex(e.result.from),
      to: tronWeb.address.fromHex(e.result.to),
      value: Number(e.result.value) / 10 ** config.usdtDecimals,
    }));
  } catch (e) {
    return { error: e.message, note: "部分 TronGrid 公共节点可能不支持事件 API，建议使用官方 API Key" };
  }
}

module.exports = {
  createClient,
  getTrxBalance,
  getUsdtBalance,
  getAccountResource,
  getAccountInfo,
  getRecentTransactions,
  getBlockByNumber,
  getCurrentBlock,
  getUsdtTransfers,
  config,
};
