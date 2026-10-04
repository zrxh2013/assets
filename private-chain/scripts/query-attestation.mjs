// 查询存证数据示例
// 通过 txID 查询交易，解析转账信息和 memo 中的存证数据
import { TronWeb } from 'tronweb';

// ============ 配置 ============
const tw = new TronWeb({
  fullNode: 'http://127.0.0.1:18090',
  solidityNode: 'http://127.0.0.1:18091',
  eventServer: 'http://127.0.0.1:18090',
});

// 要查询的 txID
const TXID = '202c5bf477076b3919ac5346f8146a27b57c6b45664975e54387fd7d4462133c';

// ============ 查询并解析存证数据 ============
async function queryAttestation(txid) {
  console.log('=== 查询存证数据 ===');
  console.log('txID:', txid);
  console.log('');

  try {
    // 1. 查询交易
    const tx = await tw.trx.getTransaction(txid);
    if (!tx.txID) {
      console.log('❌ 交易不存在');
      return;
    }

    const raw = tx.raw_data;
    const contract = raw.contract[0];
    const type = contract.type;
    const v = contract.parameter.value;
    const ret = tx.ret && tx.ret[0] ? tx.ret[0].contractRet : 'UNKNOWN';

    console.log('【交易基本信息】');
    console.log('  类型:', type);
    console.log('  状态:', ret);
    console.log('  时间:', new Date(raw.timestamp).toLocaleString('zh-CN'));
    console.log('');

    // 2. 解析转账信息
    console.log('【转账信息】');
    if (type === 'TriggerSmartContract') {
      // USDT 等合约调用
      const contractAddr = tw.address.fromHex(v.contract_address);
      console.log('  合约地址:', contractAddr);

      const callData = v.data || '';
      if (callData.startsWith('a9059cbb')) {
        // transfer(address,uint256)
        const toAddr = '41' + callData.slice(32, 72);
        const amount = parseInt(callData.slice(72, 136), 16) / 1e6;
        console.log('  方法: transfer(address,uint256)');
        console.log('  接收方:', tw.address.fromHex(toAddr));
        console.log('  金额:', amount.toLocaleString(), 'USDT');
      } else {
        console.log('  方法数据:', callData.slice(0, 20) + '...');
      }
    } else if (type === 'TransferContract') {
      // TRX 转账
      console.log('  发送方:', tw.address.fromHex(v.owner_address));
      console.log('  接收方:', tw.address.fromHex(v.to_address));
      console.log('  金额:', (v.amount || 0) / 1e6, 'TRX');
    }
    console.log('');

    // 3. 解析 memo 存证数据
    console.log('【存证数据】');
    if (raw.data) {
      const memo = Buffer.from(raw.data, 'hex').toString('utf8');
      console.log('  memo (hex):', raw.data);
      console.log('  memo (文本):', memo);

      // 尝试解析 JSON
      try {
        const attestation = JSON.parse(memo);
        console.log('');
        console.log('  ✅ 解析存证 JSON:');
        console.log('     类型:', attestation.t);
        console.log('     金额:', attestation.a);
        console.log('     回执:', attestation.r);
        console.log('     地址:', attestation.addr);
        console.log('     时间:', new Date(attestation.ts * 1000).toLocaleString('zh-CN'));
      } catch {
        console.log('  (memo 非 JSON 格式)');
      }
    } else {
      console.log('  无 memo 数据');
    }

    // 4. 查询交易确认信息
    const info = await tw.trx.getTransactionInfo(txid);
    console.log('');
    console.log('【交易确认信息】');
    console.log('  区块号:', info.blockNumber);
    console.log('  消耗能量:', info.energy_usage_total || 0);
    console.log('  消耗带宽:', info.net_usage || 0, 'bytes');
    console.log('  手续费:', (info.fee || 0) / 1e6, 'TRX');
    console.log('');
    console.log('=== 查询完毕 ===');
  } catch (e) {
    console.error('❌ 查询失败:', e.message);
  }
}

queryAttestation(TXID);
