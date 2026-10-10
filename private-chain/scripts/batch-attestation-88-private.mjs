// 批量存证广播 - 88受益人确权清算清单（私链 USDT 版）
import { TronWeb } from 'tronweb';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// 私链节点
const FULL_HOST = 'http://127.0.0.1:18090';
// 私链部署者钱包（拥有 100 亿 TRX + 10 亿 USDT）
const SENDER_PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
// 私链 USDT 合约地址（hex，部署脚本输出）
const USDT_CONTRACT_HEX = '414538870cc2b4adda5a0a49f14b34bbfa66b5db35';

const tw = new TronWeb({
  fullNode: FULL_HOST,
  solidityNode: 'http://127.0.0.1:18091',
  eventServer: FULL_HOST,
  privateKey: SENDER_PRIV,
});

// 转换合约地址为 base58
const USDT_CONTRACT = TronWeb.address.fromHex(USDT_CONTRACT_HEX);
const SENDER_BASE58 = tw.defaultAddress.base58;

const RESULTS_FILE = '/tmp/attestation-88-private-results.json';

// USDT ABI（仅 transfer / balanceOf / decimals）
const USDT_ABI = [
  {
    constant: false,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
];

const beneficiaries = [
  { name: "杨王兴", addr: "TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv", amount: "87455.20", receipt: "REC-0001" },
  { name: "陈志琦", addr: "TTEQktFXNvQeFFqGbALhHHTtUVqieanDqz", amount: "89540.00", receipt: "REC-0002" },
  { name: "刘玉珍", addr: "TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG", amount: "92831.00", receipt: "REC-0003" },
  { name: "蔡金木", addr: "TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3", amount: "35880.00", receipt: "REC-0004" },
  { name: "13913516336", addr: "THmuNGuu6XbEhnb3ZMewi2wHpiagzQH547", amount: "28932.00", receipt: "REC-0005" },
  { name: "杨必胜", addr: "TLz94yY3DP1PjJcJH6G2XajLLtriJnJqPi", amount: "63023.31", receipt: "REC-0006" },
  { name: "张建仁", addr: "TQTW7w6g3jmoHJdBfvAcRjq19hNZssE1GM", amount: "12577.82", receipt: "REC-0007" },
  { name: "杨春", addr: "TQaK2i9Ez32roCw4SkbKPD3rANf1zwrKAd", amount: "130674.00", receipt: "REC-0008" },
  { name: "孙影", addr: "TY8MjaQgjXevUto8CPFTiDjYzY4eq1ZBUZ", amount: "211359.04", receipt: "REC-0009" },
  { name: "吴胜才", addr: "TUKqF7NKq9wm8H2BjdMteY3YNucesSxTEX", amount: "133650.01", receipt: "REC-0010" },
  { name: "吴晓霞", addr: "TCUbdgKAVKiJd3uSQhSy99VY7CgCXZUSvG", amount: "70948.72", receipt: "REC-0011" },
  { name: "卫敏", addr: "TFcfAQ6g6SgFr7Q493KuSvL4doKzYeTEH1", amount: "62515.65", receipt: "REC-0012" },
  { name: "行来学", addr: "TDAS217aCAJqwiqfjLTk7861UkVjSwmMd8", amount: "16795.13", receipt: "REC-0013" },
  { name: "苏福年", addr: "TDzPUpSTD5gvwTjQwxayyTJP66hxQyKsT9", amount: "7544.92", receipt: "REC-0014" },
  { name: "陈慰贤", addr: "TZGHBft1EZfGRpFvTitLAE2dkzeCsgahko", amount: "55535.93", receipt: "REC-0015" },
  { name: "陈志辉", addr: "TL3rGPn4tH35iJfJKHReeAGgP4ypnu9Knp", amount: "26524.00", receipt: "REC-0016" },
  { name: "杨金祥", addr: "TXfENYGDXsiGoyXW7RfRjP6NwdZ1eZxv2M", amount: "247250.00", receipt: "REC-0017" },
  { name: "常永才", addr: "TKpSoyFTyjAjWWNhQRjyvN32h2SjoZDMEY", amount: "173650.00", receipt: "REC-0018" },
  { name: "陆跃华", addr: "TXfaDirEqn6zB3ceKqBCmPhKVBGz5aLW7W", amount: "295711.00", receipt: "REC-0019" },
  { name: "林树华", addr: "TURXCdG2RqkKYWkZqrr9GF9TiayrmUbuCf", amount: "18170.00", receipt: "REC-0020" },
  { name: "陈冬华", addr: "TSjZtwjxoxAtgVNpF7fGnPebQUozZyDD94", amount: "24314.00", receipt: "REC-0021" },
  { name: "陶云上", addr: "TRbZgbnHqBPGY5ixTdqrKnfwtxnWQXQ1nf", amount: "17416.66", receipt: "REC-0022" },
  { name: "张春荣", addr: "TYRfu5iwiKUpbDhAi9Wef2fniukMf7awgG", amount: "30000.00", receipt: "REC-0023" },
  { name: "谢丽丽", addr: "TMH2Dr8JUX6ZB5oPMsgad5KPjXYkQFWZBc", amount: "19412.00", receipt: "REC-0024" },
  { name: "王英", addr: "THfHyxHLCaejoFF1RMSjzWzid5bEY2NztX", amount: "9124.66", receipt: "REC-0025" },
  { name: "林彤", addr: "TDWLNfDEzVvjNbLEELjwuiGVVfjvE2jZa3", amount: "8632.00", receipt: "REC-0026" },
  { name: "金慧", addr: "TKPNtdh9pmD7H88jdEydEVTfvUhEpZcPoU", amount: "119300.00", receipt: "REC-0027" },
  { name: "陈极预", addr: "TKzmqWYseejp1UHQNiqamCvcNT623nUd8U", amount: "109391.00", receipt: "REC-0028" },
  { name: "崔玉杰", addr: "TB1NEbAfUb8Tb11qC3DgHZB8eX3UNqUNXX", amount: "67620.00", receipt: "REC-0030" },
  { name: "师全生", addr: "TDucrnuzKu8DWFV4v34SzAsFBBW3X2pTiv", amount: "24274.50", receipt: "REC-0031" },
  { name: "王艳芳", addr: "TBtySJFhGAFuNAesLdH2Gxc6qLNjyr6fGg", amount: "97750.00", receipt: "REC-0032" },
  { name: "赵丽娜", addr: "TKEqeAkfSsvpyDQVxkfT8oTm3cszdARvLC", amount: "395266.10", receipt: "REC-0033" },
  { name: "李文霞", addr: "TL99Tb4M1F6SCAEaqUXxsb7DKVEufjYQcP", amount: "441499.00", receipt: "REC-0034" },
  { name: "吴蓓", addr: "TNDmDyE9vEDYzaVtzFyidrDr7J1z1ZhAaH", amount: "181792.70", receipt: "REC-0035" },
  { name: "彭永涛", addr: "TWCrFmdtGEECB2mL2nzZF7CXtDqpHa4r5F", amount: "63998.65", receipt: "REC-0036" },
  { name: "王保稳", addr: "TXKPYtXsAfNqzFyRQ1tYbQPg1sHHc3AG3B", amount: "138000.00", receipt: "REC-0037" },
  { name: "陈柯琳", addr: "TBbwn5L9tPn76ENnhxk7XR4AUmNjdkZaGM", amount: "415409.90", receipt: "REC-0038" },
  { name: "包燕琴", addr: "TCkea2cBgHMF7MaaictmWucL8fz3v6fM9E", amount: "104180.41", receipt: "REC-0039" },
  { name: "宋国强", addr: "TKDuJL8QxQ7YNwmU5z88rsvVSk492HjVSQ", amount: "14720.00", receipt: "REC-0040" },
  { name: "朱周明", addr: "TG4CnMzYLbhJE5scviTJX6MWnzF1CLDz3r", amount: "156054.00", receipt: "REC-0041" },
  { name: "陈胜华", addr: "TPEkCgaiqBgJVLtDokykj4vbNU1zcJwiA5", amount: "125622.52", receipt: "REC-0042" },
  { name: "王育玲", addr: "TDpyNjVqWNmUEqSfyfriWQ9T9BRGAYMwXX", amount: "540973.00", receipt: "REC-0043" },
  { name: "曹桂芹", addr: "TFhMJecV7tsLkuzARiBJUsN2faLvR5XYUg", amount: "42550.00", receipt: "REC-0044" },
  { name: "薛莞芳", addr: "TLaGjwhvA8XQYSxFAcAXy7Dvuue9eGYitv", amount: "196800.00", receipt: "REC-0061" },
  { name: "廖贵萍", addr: "TAsMrjMJsirjHpAwqJozwVGj63q6TbLh2Q", amount: "128500.00", receipt: "REC-0062" },
  { name: "黄妍", addr: "TV4NwDvz8bjd9rFBYjCkbSjbcGaJN78HNf", amount: "96800.00", receipt: "REC-0063" },
  { name: "李晓琳", addr: "TR6K12BvZ2j6H2WK5jBwJA2mYGGMu8wtgw", amount: "115200.00", receipt: "REC-0064" },
  { name: "刘选民", addr: "TFkQqF6FQvKNQBvo4xBMnWWPsohnQ5WNR2", amount: "142000.00", receipt: "REC-0065" },
  { name: "谭贵蓉", addr: "TP1K3KDae37Z4ehRaL8dxwijtBrQiEriVh", amount: "88600.00", receipt: "REC-0066" },
  { name: "任庆荣", addr: "TX2pxD6NXZAYeG9aWJExbVHeU4rpRFCL65", amount: "105000.00", receipt: "REC-0067" },
  { name: "张银海", addr: "TJCgQ1kPuKKrVvqYaL5yiz21WYQsfWbYNk", amount: "117967.61", receipt: "REC-0081" },
  { name: "林伟", addr: "TYwN38csB2kaXxUfQyPeHNNsA5J5jTX46n", amount: "101906.57", receipt: "REC-0068" },
  { name: "张姝媚", addr: "TF8vw2MSSuZoGnkDWT17nvZG5RJBGuncUx", amount: "278000.00", receipt: "REC-0069" },
  { name: "蒋勇", addr: "TSXENd8uWE2NML5TSf7Apnu5oLkKBe72G9", amount: "157327.74", receipt: "REC-0070" },
  { name: "王艳霞", addr: "TQs3r36YbdPK2DE1NSXuzeDVYgEiTjPoff", amount: "24150.00", receipt: "REC-0071" },
  { name: "汤琦", addr: "TFxD6MqVweTeoLb93dF2WjL1Fncf9RetVX", amount: "193310.00", receipt: "REC-0073" },
  { name: "赵徐霞", addr: "TMTK22vS2kFyGhLwTM2bFwfBsXsTTfs7t9", amount: "30431.12", receipt: "REC-0074" },
  { name: "吴惠香", addr: "TVjtHvhn4L3xXMxdA4jEKwyWkNj4Q8pKX8", amount: "143000.00", receipt: "REC-0075" },
  { name: "韩宏伟", addr: "TFrRiaeERx3nyaA2mPkC1xEM6qz7p9rVbx", amount: "203645.84", receipt: "REC-0076" },
  { name: "郑永爱", addr: "TWUWZqx3NVTarG1BirzYfDfEZ4ptUXhQcp", amount: "399764.40", receipt: "REC-0077" },
  { name: "景玉琴", addr: "TPaXDmv3r38Hjw9LuxqxD2zWde3SSoor3L", amount: "58695.00", receipt: "REC-0078" },
  { name: "张自英", addr: "TEoLh8z4bBswJVj1A4LrPqd1yVtPJN5MEG", amount: "105300.00", receipt: "REC-0079" },
  { name: "姜悦", addr: "TFGhU2en6VYbq5QjoP2pHmaSuZFAQQ6tGe", amount: "282202.00", receipt: "REC-0080" },
  { name: "何陈菲", addr: "TTf34ZKbVM5DjFfhYsQ1oFsLRMj5XcNhPm", amount: "45502.00", receipt: "REC-0081" },
  { name: "刘波", addr: "TUS2dCKEruUFAWWdQE7bju8JG35dWs5zas", amount: "32675.30", receipt: "REC-0082" },
  { name: "陈燕丽", addr: "TApyDXyESvKhpH6wNSVYMC6SkEPgW1LfXP", amount: "56671.00", receipt: "REC-0083" },
  { name: "祁成桂", addr: "TECXdSpFSMGE4PwhZVfK6NvroWPMoNuTfd", amount: "862500.00", receipt: "REC-0084" },
  { name: "祝勤佳", addr: "TTUgudqWpuGju48g4EYVqTBdZVZy3Hpz7W", amount: "573017.15", receipt: "REC-0085" },
  { name: "郭祥梅", addr: "TDn2L49LvNWeRK9hQwqS611JGV2VNXA1T9", amount: "2273166.00", receipt: "REC-0109" },
  { name: "吴雪云", addr: "TCPC2Td8sBoh6sauz3976bp2X9shZuxZMx", amount: "1324528.60", receipt: "REC-0086" },
];

// 工具：将 base58 地址转为 hex21（合约 transfer 调用使用）
function addrToHex21(addr) {
  return TronWeb.address.toHex(addr);
}

// 工具：构造 memo 字符串
function buildMemo(b, ts) {
  return JSON.stringify({
    t: b.name,
    a: b.amount,
    r: b.receipt,
    addr: b.addr,
    ts,
  });
}

// 调用 USDT 合约 transfer，附带 memo 上链
async function broadcastAttestation(b) {
  const ts = Date.now();
  const memo = buildMemo(b, ts);
  // amount: 字符串 → 最小单位（6 位小数）
  const valueStr = String(b.amount);
  const [whole, frac = ''] = valueStr.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  const valueRaw = BigInt(whole) * 1000000n + BigInt(frac6);
  const toHex = addrToHex21(b.addr);
  const fromHex = addrToHex21(SENDER_BASE58);

  // 构造 trigger smart contract（USDT transfer）
  const tx = await tw.transactionBuilder.triggerSmartContract(
    USDT_CONTRACT_HEX,
    'transfer(address,uint256)',
    { feeLimit: 1000000000 },
    [
      { type: 'address', value: toHex },
      { type: 'uint256', value: valueRaw.toString() },
    ],
    fromHex
  );

  // 触发合约返回的 transaction 对象（含 unsign 交易）
  const unsign = tx.transaction;
  if (!unsign) throw new Error('triggerSmartContract 未返回 transaction');

  // 附加 memo（raw_data.data）
  const withMemo = await tw.transactionBuilder.addUpdateData(unsign, memo, 'utf8');

  // 签名
  const signed = await tw.trx.sign(withMemo);
  // 广播
  const result = await tw.trx.sendRawTransaction(signed);

  if (result.result === true) {
    return { success: true, txid: result.txid, memo, ts };
  } else {
    let msg = result.message || 'unknown error';
    try { msg = tw.toUtf8(msg); } catch {}
    return { success: false, error: msg };
  }
}

async function getUsdtBalance(addr) {
  const result = await tw.transactionBuilder.triggerConstantContract(
    USDT_CONTRACT_HEX,
    'balanceOf(address)',
    {},
    [{ type: 'address', value: addrToHex21(addr) }],
    addrToHex21(SENDER_BASE58)
  );
  if (result.constant_result && result.constant_result[0]) {
    return BigInt('0x' + result.constant_result[0]);
  }
  return 0n;
}

async function getTrxBalance() {
  const acc = await tw.trx.getAccount(SENDER_BASE58);
  return (acc.balance || 0) / 1e6;
}

async function main() {
  console.log('='.repeat(70));
  console.log('信托确权清算批量存证广播 — TRON 私链 USDT');
  console.log('='.repeat(70));
  console.log(`节点: ${FULL_HOST}`);
  console.log(`USDT 合约(hex): ${USDT_CONTRACT_HEX}`);
  console.log(`USDT 合约(b58): ${USDT_CONTRACT}`);
  console.log(`发送方(b58): ${SENDER_BASE58}`);

  const trx = await getTrxBalance();
  console.log(`TRX 余额: ${trx.toFixed(2)}`);

  const usdtRaw = await getUsdtBalance(SENDER_BASE58);
  console.log(`USDT 余额: ${(Number(usdtRaw) / 1e6).toFixed(2)}`);

  // 加载已完成的结果（断点续传）
  let results = [];
  const doneSet = new Set();
  if (existsSync(RESULTS_FILE)) {
    try {
      results = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
      results.forEach((r) => {
        if (r.status === 'ok') doneSet.add(r.receipt);
      });
      console.log(`📂 已加载历史记录: ${doneSet.size} 条已完成`);
    } catch (e) {
      console.log(`⚠️ 历史记录解析失败，重新开始`);
    }
  }

  const pending = beneficiaries.filter((b) => !doneSet.has(b.receipt));
  console.log(`待存证: ${pending.length} 条 (总 ${beneficiaries.length} 条)`);
  console.log('');

  let ok = doneSet.size;
  let fail = 0;

  for (let i = 0; i < pending.length; i++) {
    const b = pending[i];
    process.stdout.write(`[${i + 1}/${pending.length}] ${b.name} (${b.amount} USDT) → ${b.addr.slice(0, 10)}... `);
    try {
      const r = await broadcastAttestation(b);
      if (r.success) {
        console.log(`✅ ${r.txid.slice(0, 16)}...`);
        ok++;
        results.push({ ...b, txid: r.txid, status: 'ok', memo: r.memo, ts: r.ts });
      } else {
        console.log(`❌ ${r.error.slice(0, 60)}`);
        fail++;
        results.push({ ...b, error: r.error, status: 'fail' });
      }
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 80)}`);
      fail++;
      results.push({ ...b, error: e.message, status: 'fail' });
    }
    // 保存进度（每笔）
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    // 私链无 rate limit，仅短暂等待出块
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`汇总: 成功 ${ok} | 失败 ${fail} | 剩余 ${beneficiaries.length - ok - fail}`);
  const finalUsdt = await getUsdtBalance(SENDER_BASE58);
  console.log(`USDT 余额: ${(Number(finalUsdt) / 1e6).toFixed(2)}`);
  console.log(`结果已保存: ${RESULTS_FILE}`);
  console.log('='.repeat(70));
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
