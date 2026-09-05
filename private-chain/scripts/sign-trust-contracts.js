const { ethers } = require('ethers');
const fs = require('fs');

// Safe-1 主地址（已在主网锚定的地址）
const MAIN_PRIV = '0x63d9de16c88d7a840beb55175946f9f62f5a62d1d3dc9b6df7b0962512dd80e3';
const MAIN_ADDR = 'TF65UqeFNN5YN75GeDfs9Nfc7LekL8eik9';

const wallet = new ethers.Wallet(MAIN_PRIV);
console.log('Signer ETH addr:', wallet.address);

const contracts = [
  { id: '001', title: 'AI蛋白质折叠信托计划', date: '2023.04.28', period: '12个月', yield: '22%-30%' },
  { id: '002', title: 'Air Car 空中汽车技术商业化信托', date: '2023.04.26', period: '24个月', yield: '18%-25%' },
  { id: '003', title: '前沿超算系统下一代超级计算机信托', date: '2023.04.26', period: '24个月', yield: '20%-28%' },
  { id: '004', title: '可控制核聚变信托配置', date: '2023.04.25', period: '36个月', yield: '15%-40%' },
  { id: '005', title: 'Boston Dynamics 机器人研发信托', date: '2023.04.25', period: '18个月', yield: '20%-26%' },
  { id: '006', title: 'OpenAI GPT-4 信托计划', date: '2023.04.26', period: '6个月', yield: '25%-35%' },
  { id: '007', title: 'AI量化策略配置包信托', date: '2023.04.26', period: '3个月', yield: '24%' },
  { id: '008', title: 'Xendit 数字支付信托产品', date: '2023.06.26', period: '12个月', yield: '16%-20%' },
  { id: '009', title: 'Bolttech 保险科技信托产品', date: '2023.06.25', period: '12个月', yield: '15%-19%' },
  { id: '010', title: 'Coda Payments 战略合作伙伴信托', date: '2023.06.19', period: '6个月', yield: '18%-22%' },
];

(async () => {
  const results = [];
  for (const c of contracts) {
    const message = `LMR-PTAH-2023-TRUST-${c.id}|${c.title}|${c.date}|${c.period}|${c.yield}|${MAIN_ADDR}`;
    // keccak256 哈希
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
    // 使用 secp256k1 签名（与 TRON 链上签名算法一致）
    const signature = await wallet.signMessage(message);
    // 验证：用 ecrecover 恢复地址
    const recovered = ethers.verifyMessage(message, signature);
    const valid = (recovered.toLowerCase() === wallet.address.toLowerCase());
    results.push({
      ...c,
      message,
      msgHash,
      signature,
      signerEthAddr: wallet.address,
      signerTronAddr: MAIN_ADDR,
      recovered,
      valid
    });
    console.log(`[${c.id}] ${c.title.slice(0,18).padEnd(18)} sig=${signature.slice(0,20)}... valid=${valid}`);
  }
  fs.writeFileSync('/workspace/private-chain/assets/trust-signatures.json', JSON.stringify(results, null, 2));
  console.log('\nDone. All valid:', results.every(r => r.valid));
})();
