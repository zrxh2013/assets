const { TronWeb } = require('tronweb');
const tw = new TronWeb({ fullHost: 'https://nile.trongrid.io' });

const CALLER = 'TF65UqeFNN5YN75GeDfs9Nfc7LekL8eik9';

async function callContract(contractAddr, selector, extraParam) {
  try {
    const result = await tw.transactionBuilder.triggerSmartContract(
      contractAddr, selector, {}, { call_value: 0 }, CALLER
    );
    const out = result?.result?.constant_result;
    if (out && out.length > 0) return out[0];
    return null;
  } catch(e) { return 'ERR: ' + e.message.slice(0,100); }
}

function hexToStr(hex) {
  if (!hex || hex === null) return 'N/A';
  try {
    // 去除前导零，转 ASCII
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.substr(i, 2), 16);
      if (code > 0) str += String.fromCharCode(code);
    }
    return str.trim() || 'N/A';
  } catch(e) { return 'N/A'; }
}

function hexToInt(hex) {
  if (!hex || hex === null) return 'N/A';
  try { return BigInt('0x' + hex).toString(); } catch(e) { return 'N/A'; }
}

(async () => {
  const contracts = [
    { name: '官方水龙头USDT', addr: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' },
    { name: '机器人自建USDT', addr: 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq' }
  ];

  for (const c of contracts) {
    console.log('\n=== ' + c.name + ' (' + c.addr + ') ===');
    
    const nameHex = await callContract(c.addr, 'name()');
    const symHex = await callContract(c.addr, 'symbol()');
    const decHex = await callContract(c.addr, 'decimals()');
    const supplyHex = await callContract(c.addr, 'totalSupply()');
    
    const dec = hexToInt(decHex);
    const decNum = parseInt(dec) || 6;
    const supply = hexToInt(supplyHex);
    const supplyNum = supply !== 'N/A' ? (Number(BigInt(supply) / BigInt(Math.pow(10, decNum)))) : 'N/A';
    
    console.log('  name:', hexToStr(nameHex));
    console.log('  symbol:', hexToStr(symHex));
    console.log('  decimals:', dec);
    console.log('  totalSupply raw:', supply);
    console.log('  totalSupply:', supplyNum !== 'N/A' ? supplyNum.toLocaleString() : 'N/A');
    
    // 检查是否有 mint 函数 (查合约 ABI)
    try {
      const cInfo = await tw.trx.getContract(c.addr);
      if (cInfo && cInfo.abi) {
        const abi = typeof cInfo.abi === 'string' ? JSON.parse(cInfo.abi) : cInfo.abi;
        const fns = abi.entrys ? abi.entrys.filter(e => e.type === 'Function').map(e => e.signature || e.name) : [];
        const hasMint = fns.some(f => f && f.toLowerCase().includes('mint'));
        const hasTransfer = fns.some(f => f && f.toLowerCase().includes('transfer'));
        console.log('  合约函数列表:', fns.slice(0, 15).join(', '));
        console.log('  有 mint 函数:', hasMint);
        console.log('  有 transfer 函数:', hasTransfer);
      }
    } catch(e) { console.log('  ABI 查询失败:', e.message.slice(0, 80)); }
  }
  
  // 查 TYSfgUcv 在两个合约下的余额
  console.log('\n=== TYSfgUcv 余额 ===');
  for (const c of contracts) {
    const balHex = await callContract(c.addr, 'balanceOf(address)', '0000000000000000000000' + tw.address.toHex('TYSfgUcvATDNhqkQ2aPC5eGNo4X2c89epx').slice(2));
    const bal = hexToInt(balHex);
    console.log(c.name + ': ' + (bal !== 'N/A' ? (Number(BigInt(bal)) / Math.pow(10, 6)).toLocaleString() : 'N/A'));
  }
})();
