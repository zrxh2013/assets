// scripts/query-attestation-mainnet.mjs
// 通过 txID 查询 TRON 链上存证数据（支持主网 / Nile 测试网 / 私链）
//
// 用法：
//   node scripts/query-attestation-mainnet.mjs <txID> [--network mainnet|nile|private]
//
// 示例：
//   node scripts/query-attestation-mainnet.mjs 202c5bf477076b3919ac5346f8146a27b57c6b45664975e54387fd7d4462133c --network private
//   node scripts/query-attestation-mainnet.mjs <主网txID> --network mainnet
//
// 环境变量（可选）：
//   TRON_PRO_API_KEY   TronGrid Pro API Key，解除请求频率限制（仅主网/Nile）
//   TRON_FULL_NODE     自定义 fullNode 地址（覆盖默认配置）

import { TronWeb } from 'tronweb';

// ============ 网络配置 ============
const NETWORKS = {
  mainnet: {
    fullNode: 'https://api.trongrid.io',
    solidityNode: 'https://api.trongrid.io',
    eventServer: 'https://api.trongrid.io',
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    label: 'TRON 主网',
  },
  nile: {
    fullNode: 'https://nile.trongrid.io',
    solidityNode: 'https://nile.trongrid.io',
    eventServer: 'https://nile.trongrid.io',
    usdtContract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    label: 'Nile 测试网',
  },
  private: {
    fullNode: 'http://127.0.0.1:18090',
    solidityNode: 'http://127.0.0.1:18091',
    eventServer: 'http://127.0.0.1:18090',
    usdtContract: '419a6e591feb47e5c48c6f50ce1c6e775a82c1fb25', // 私链 USDT 合约
    label: '本地私链',
  },
};

// ============ 参数解析 ============
function parseArgs(argv) {
  const args = argv.slice(2);
  let txid = null;
  let network = 'mainnet';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--network' || a === '-n') {
      network = args[++i];
    } else if (a.startsWith('--network=')) {
      network = a.split('=')[1];
    } else if (!a.startsWith('-')) {
      txid = a;
    }
  }
  return { txid, network };
}

function printHelp() {
  console.log(`
TRON 存证数据查询工具
─────────────────────

用法:
  node scripts/query-attestation-mainnet.mjs <txID> [--network mainnet|nile|private]

参数:
  txID                  要查询的交易哈希（必填）
  --network, -n         网络类型（默认 mainnet）
                          mainnet  - TRON 主网
                          nile     - Nile 测试网
                          private  - 本地私链

环境变量:
  TRON_PRO_API_KEY      TronGrid Pro API Key（可选，主网/Nile）
  TRON_FULL_NODE        自定义 fullNode 地址（可选）

示例:
  # 查询主网存证
  node scripts/query-attestation-mainnet.mjs <txID> --network mainnet

  # 查询私链存证
  node scripts/query-attestation-mainnet.mjs 202c5bf477076b3919ac5346f8146a27b57c6b45664975e54387fd7d4462133c --network private
`);
}

// ============ 存证查询核心逻辑 ============
async function queryAttestation(txid, network) {
  const cfg = NETWORKS[network];
  if (!cfg) {
    console.error(`❌ 未知网络: ${network}，支持: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
  }

  // 自定义 fullNode 覆盖
  const fullNode = process.env.TRON_FULL_NODE || cfg.fullNode;

  // 构造 TronWeb 客户端（只读查询，无需私钥）
  const headers = {};
  if (process.env.TRON_PRO_API_KEY && network !== 'private') {
    headers['TRON-PRO-API-KEY'] = process.env.TRON_PRO_API_KEY;
  }

  const tw = new TronWeb({
    fullNode,
    solidityNode: cfg.solidityNode,
    eventServer: cfg.eventServer,
    headers,
  });

  console.log('═══════════════════════════════════════════════');
  console.log(` 网络: ${cfg.label}`);
  console.log(` 节点: ${fullNode}`);
  console.log(` txID: ${txid}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  try {
    // ---------- 1. 查询交易 ----------
    const tx = await tw.trx.getTransaction(txid);
    if (!tx.txID) {
      console.log('❌ 交易不存在（txID 无效或尚未上链）');
      return;
    }

    const raw = tx.raw_data;
    const contract = raw.contract && raw.contract[0];
    if (!contract) {
      console.log('❌ 交易无合约调用数据');
      return;
    }

    const type = contract.type;
    const v = contract.parameter.value;
    const ret = tx.ret && tx.ret[0] ? tx.ret[0].contractRet : 'UNKNOWN';

    console.log('【交易基本信息】');
    console.log(`  类型:   ${type}`);
    console.log(`  状态:   ${ret}${ret === 'SUCCESS' ? ' ✅' : ''}`);
    console.log(`  时间:   ${raw.timestamp ? new Date(raw.timestamp).toLocaleString('zh-CN') : 'N/A'}`);
    if (tx.blockNumber) console.log(`  区块:   ${tx.blockNumber}`);
    console.log('');

    // ---------- 2. 解析转账信息 ----------
    console.log('【转账信息】');
    if (type === 'TriggerSmartContract') {
      const contractAddr = tw.address.fromHex(v.contract_address);
      const isUsdt =
        contractAddr === cfg.usdtContract ||
        v.contract_address === cfg.usdtContract;
      console.log(`  合约:   ${contractAddr}${isUsdt ? ' (USDT)' : ''}`);

      const callData = v.data || '';
      if (callData.startsWith('a9059cbb')) {
        // transfer(address,uint256) 方法签名
        const toAddr = '41' + callData.slice(32, 72);
        const amount = parseInt(callData.slice(72, 136), 16) / 1e6;
        console.log(`  方法:   transfer(address,uint256)`);
        console.log(`  接收方: ${tw.address.fromHex(toAddr)}`);
        console.log(`  金额:   ${amount.toLocaleString()} USDT`);
      } else {
        console.log(`  调用数据: ${callData.slice(0, 64)}${callData.length > 64 ? '...' : ''}`);
      }
    } else if (type === 'TransferContract') {
      // 原生 TRX 转账
      console.log(`  发送方: ${tw.address.fromHex(v.owner_address)}`);
      console.log(`  接收方: ${tw.address.fromHex(v.to_address)}`);
      console.log(`  金额:   ${(v.amount || 0) / 1e6} TRX`);
    }
    console.log('');

    // ---------- 3. 解析 memo 存证数据 ----------
    console.log('【存证数据】');
    if (raw.data) {
      const memo = Buffer.from(raw.data, 'hex').toString('utf8');
      console.log(`  memo (hex):  ${raw.data}`);
      console.log(`  memo (文本): ${memo}`);

      // 尝试解析存证 JSON
      try {
        const att = JSON.parse(memo);
        console.log('');
        console.log('  ✅ 解析存证 JSON 成功');
        console.log(`     类型 (t):    ${att.t || '-'}`);
        console.log(`     金额 (a):    ${att.a || '-'}`);
        console.log(`     回执 (r):    ${att.r || '-'}`);
        console.log(`     地址 (addr): ${att.addr || '-'}`);
        console.log(`     时间 (ts):   ${att.ts ? new Date(att.ts * 1000).toLocaleString('zh-CN') : '-'}`);
      } catch {
        console.log('  ⚠️  memo 非 JSON 格式，按纯文本处理');
      }
    } else {
      console.log('  无 memo 数据');
    }

    // ---------- 4. 查询交易确认信息 ----------
    try {
      const info = await tw.trx.getTransactionInfo(txid);
      console.log('');
      console.log('【交易确认信息】');
      console.log(`  区块号:     ${info.blockNumber || 'N/A'}`);
      console.log(`  消耗能量:   ${info.energy_usage_total || 0}`);
      console.log(`  消耗带宽:   ${info.net_usage || 0} bytes`);
      console.log(`  手续费:     ${(info.fee || 0) / 1e6} TRX`);
      if (info.blockTimeStamp) {
        console.log(`  上链时间:   ${new Date(info.blockTimeStamp).toLocaleString('zh-CN')}`);
      }
    } catch (e) {
      console.log('');
      console.log(`  ⚠️  无法获取交易确认信息: ${e.message}`);
    }

    console.log('');
    console.log('═══════════════ 查询完毕 ═══════════════════════');
  } catch (e) {
    console.error(`\n❌ 查询失败: ${e.message}`);
    if (network === 'mainnet' || network === 'nile') {
      console.error('   提示：主网/Nile 查询可能需要设置 TRON_PRO_API_KEY 环境变量');
    }
    process.exit(1);
  }
}

// ============ 入口 ============
const { txid, network } = parseArgs(process.argv);

if (!txid) {
  printHelp();
  process.exit(1);
}

// 去除可能的 0x 前缀
const cleanTxid = txid.replace(/^0x/, '');

queryAttestation(cleanTxid, network);
