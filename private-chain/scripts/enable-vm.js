// 启用私链 VM 相关参数
const { TronWeb } = require('tronweb');

const PRIV = 'C6F570D56246C08804ACBA9B9C96A134E0CACF319C227C84D7557D86A83BD85D';
const FROM = 'TFuRdgLbf87XbDVnoThfCzk4jkxnwsYg1t';

const tw = new TronWeb({
  fullNode: 'http://127.0.0.1:18090',
  solidityNode: 'http://127.0.0.1:18091',
  privateKey: PRIV,
});

const FROM_HEX = tw.address.toHex(FROM);

const VM_PARAMS = [
  { key: 9, name: 'ALLOW_TVM_TRANSFER_TRC10' },
  { key: 7, name: 'ALLOW_TVM_CONSTANTINOPLE' },
  { key: 8, name: 'ALLOW_TVM_SOLIDITY_059' },
  { key: 10, name: 'ALLOW_TVM_ISTANBUL' },
  { key: 11, name: 'ALLOW_TVM_LONDON' },
];

async function main() {
  // 创建所有提案
  for (const param of VM_PARAMS) {
    try {
      console.log(`创建提案: ${param.name} (key=${param.key})`);
      const proposalTx = await tw.transactionBuilder.createProposal([{ key: param.key, value: 1 }], FROM_HEX);
      const signed = await tw.trx.sign(proposalTx);
      const result = await tw.trx.sendRawTransaction(signed);
      console.log(`  结果: ${result.result}`);
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.error(`  错误: ${e.message}`);
    }
  }

  // 等待区块确认
  console.log('\n等待区块确认...');
  await new Promise(r => setTimeout(r, 10000));

  // 列出所有提案
  const proposals = await tw.fullNode.request('wallet/listproposals', {}, 'post');
  const proposalList = proposals.proposals || [];
  console.log(`\n找到 ${proposalList.length} 个提案`);

  // 批准所有未批准的提案
  for (const p of proposalList) {
    const pid = p.proposal_id;
    const params = p.parameters || [];
    console.log(`\n提案 ${pid}:`, JSON.stringify(params));
    
    try {
      const approveTx = await tw.transactionBuilder.voteProposal(pid, true, FROM_HEX);
      const signed = await tw.trx.sign(approveTx);
      const result = await tw.trx.sendRawTransaction(signed);
      console.log(`  批准结果: ${result.result}`);
    } catch (e) {
      console.error(`  错误: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  // 等待生效（需要等下一个 maintenance 周期）
  console.log('\n等待提案生效（maintenance 周期）...');
  await new Promise(r => setTimeout(r, 30000));

  // 验证
  console.log('\n=== 验证 VM 参数 ===');
  const resp = await tw.fullNode.request('wallet/getchainparameters', {}, 'post');
  const params = resp.chainParameter || [];
  for (const p of params) {
    if (p.key.includes('Tvm') || p.key.includes('vm')) {
      console.log(`${p.key} = ${p.value}`);
    }
  }
}

main().catch(e => console.error(e));
