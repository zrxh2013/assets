import pkg from '/workspace/private-chain/node_modules/tronweb/dist/TronWeb.node.js';
const TronWeb = pkg.default || pkg.TronWeb || pkg;

const addr = 'TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ';
const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
});
(async () => {
  try {
    const b = await tronWeb.trx.getBalance(addr);
    console.log('Balance (sun):', b, '=> TRX:', b / 1e6);
    const band = await tronWeb.trx.getBandwidth(addr).catch(e => 'N/A: '+e.message);
    console.log('Bandwidth:', band);
    const res = await tronWeb.trx.getAccountResources(addr).catch(e => 'N/A: '+e.message);
    console.log('Resources:', typeof res === 'string' ? res : JSON.stringify(res).slice(0,1200));
    try {
      const acc = await tronWeb.trx.getAccount(addr);
      console.log('Account frozen_for_bandwidth:', JSON.stringify(acc.frozen ? acc.frozen : (acc.frozenV2 || 'none')).slice(0,500));
    } catch(e) { console.log('getAccount err:', e.message); }
  } catch(e) { console.error('ERR:', e.message); process.exit(1); }
})();
