// 单笔 Merkle 验证：输入 Nile txID → 输出是否属于这批 + 完整 proof
// 用法: node scripts/verify-merkle.js <txID>
const crypto = require('crypto');
const fs = require('fs');

const tree = JSON.parse(fs.readFileSync('/tmp/merkle-tree.json', 'utf8'));
const { root, leaves, layers } = tree;

function sha256Hex(a, b) {
  if (b !== undefined) return crypto.createHash('sha256').update(Buffer.from(a + b, 'hex')).digest('hex');
  return crypto.createHash('sha256').update(Buffer.from(a, 'hex')).digest('hex');
}

function getMerklePath(idx) {
  const path = [];
  let i = idx;
  for (let l = 0; l < layers.length - 1; l++) {
    const sib = i % 2 === 0 ? i + 1 : i - 1;
    const h = sib < layers[l].length ? layers[l][sib] : layers[l][i];
    path.push({ pos: i % 2 === 0 ? 'R' : 'L', h });
    i = Math.floor(i / 2);
  }
  return path;
}

function verify(leaf, path) {
  let h = sha256Hex(leaf);
  for (const n of path) h = sha256Hex(n.pos === 'L' ? n.h + h : h + n.h);
  return h === root;
}

const input = process.argv[2];
if (!input) {
  console.log('用法: node scripts/verify-merkle.js <Nile txID>');
  console.log('示例: node scripts/verify-merkle.js 68d9bea8...');
  process.exit(0);
}

const idx = leaves.indexOf(input);
if (idx === -1) {
  console.log('❌ 该 txID 不在 Merkle Tree 中 (不属于这批 ' + leaves.length + ' 笔)');
  // 模糊匹配
  const similar = leaves.filter(t => t.startsWith(input.slice(0, 8)));
  if (similar.length > 0) {
    console.log('\n💡 您是不是想查以下交易?');
    similar.slice(0, 5).forEach(t => console.log('  ' + t));
  }
  process.exit(1);
}

const path = getMerklePath(idx);
const valid = verify(input, path);

console.log('=== 单笔 Merkle 验证 ===');
console.log('txID:       ' + input);
console.log('序号:       第 ' + (idx + 1) + ' 笔 / 共 ' + leaves.length + ' 笔');
console.log('Merkle Root (主网链上): ' + root);
console.log('Path 层数:  ' + path.length);
console.log('验证结果:   ' + (valid ? '✅ 通过 — 此交易属于这批' : '❌ 失败'));
console.log('\nMerkle Path:');
path.forEach((n, i) => {
  console.log('  ' + (i+1) + '. [' + n.pos + '] ' + n.h);
});
console.log('\n🔗 主网锚定: https://tronscan.org/#/transaction/7506790e8dedc4052747b55241e45a9ff89415d81d3f3e1acbaa5784c888f407');
console.log('🔗 Nile 交易: https://nile.tronscan.org/#/transaction/' + input);
