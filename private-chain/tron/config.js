// tron/config.js
// 波场链主网配置

module.exports = {
  // 波场主网 RPC（TronGrid 官方公开节点）
  mainnet: {
    fullNode: "https://api.trongrid.io",
    solidityNode: "https://api.trongrid.io",
    eventServer: "https://api.trongrid.io",
  },
  // 波场 Nile 测试网
  nile: {
    fullNode: "https://nile.trongrid.io",
    solidityNode: "https://nile.trongrid.io",
    eventServer: "https://nile.trongrid.io",
  },
  // 波场 USDT 合约地址（主网官方）
  usdtContract: {
    mainnet: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    nile:   "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  },
  // USDT 小数位
  usdtDecimals: 6,
  // 单位转换
  sun: 1_000_000, // 1 TRX = 1,000,000 SUN
};
