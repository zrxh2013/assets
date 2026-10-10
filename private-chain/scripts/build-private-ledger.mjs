// 将私链 USDT 存证结果注入到静态展示 HTML
import { readFileSync, writeFileSync } from 'fs';

const RESULTS_FILE = '/workspace/private-chain/assets/attestation-88-private-results.json';
const TEMPLATE_FILE = '/workspace/private-chain/assets/private-attestation-ledger.html';
const OUTPUT_FILE = '/workspace/private-chain/assets/private-attestation-ledger-final.html';

const META = {
  contract: 'TGHDLu1XmqswVgg4g7CfACotjAcJZeMwt5',
  contractHex: '414538870cc2b4adda5a0a49f14b34bbfa66b5db35',
  sender: 'TFuRdgLbf87XbDVnoThfCzk4jkxnwsYg1t',
  node: 'http://127.0.0.1:18090 (TRON 私链)',
};

const results = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
const ok = results.filter((r) => r.status === 'ok');
console.log(`加载 ${results.length} 条记录，其中 ${ok.length} 条成功`);

let template = readFileSync(TEMPLATE_FILE, 'utf8');

// 注入数据：在主 <script> 之前注入数据，确保主脚本运行时数据已就位
const injectScript = `<script>
window.__META = ${JSON.stringify(META)};
window.__ATTESTATIONS = ${JSON.stringify(ok)};
</script>
`;

// 锚点：主脚本前的注释行
const anchor = '<script>\n// 数据由生成脚本注入';
template = template.replace(anchor, `${injectScript}\n${anchor}`);

writeFileSync(OUTPUT_FILE, template);
console.log(`\n✅ 已生成静态展示页:`);
console.log(`   ${OUTPUT_FILE}`);
console.log(`   笔数: ${ok.length}`);
let total = 0;
ok.forEach((a) => (total += parseFloat(a.amount) || 0));
console.log(`   总金额: ${total.toFixed(2)} USDT`);
