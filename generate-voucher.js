#!/usr/bin/env node
/**
 * TRON 转账凭证生成器
 * 根据 TRON 链上交易哈希生成 PDF 转账凭证
 * 数据来源：TronScan API 真实链上记录
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');

const TRONSCAN_API = 'https://apilist.tronscanapi.com/api/transaction-info';
const TRONSCAN_URL = 'https://tronscan.org/#/transaction';

const FONT_REGULAR = '/usr/share/fonts/opentype/noto-cjk-otf/NotoSansCJKsc-Regular.otf';
const FONT_BOLD = '/usr/share/fonts/opentype/noto-cjk-otf/NotoSansCJKsc-Bold.otf';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node generate-voucher.js <交易哈希> [输出文件名]');
  console.error('示例: node generate-voucher.js c2ef2f4248fca44d1f8cbcf69fa30439c929b379590c1e99c12a49e53b8e5eb4');
  process.exit(1);
}

const txHash = args[0];
const outputFile = args[1] || `voucher-${txHash.slice(0, 12)}.pdf`;

// 校验哈希格式（64位十六进制）
if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
  console.error('错误：交易哈希格式不正确，应为 64 位十六进制字符串');
  process.exit(1);
}

async function fetchTransactionInfo(hash) {
  const response = await fetch(`${TRONSCAN_API}?hash=${hash}`);
  if (!response.ok) {
    throw new Error(`API 请求失败: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data || !data.hash) {
    throw new Error('未找到该交易，请检查哈希是否正确');
  }
  return data;
}

function formatAmount(value, decimals) {
  if (value === undefined || value === null) return '0';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return (num / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

function formatTRX(sun) {
  if (sun === undefined || sun === null) return '0';
  return (Number(sun) / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  });
}

function formatDate(timestamp) {
  if (!timestamp) return '未知';
  const d = new Date(Number(timestamp));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} UTC`;
}

function extractTransferDetails(data) {
  const tokenInfo = data.tokenTransferInfo || {};
  const contractData = data.contractData || {};
  const cost = data.cost || {};
  const isTRC20 = data.contractType === 31 && tokenInfo.symbol;
  const isTRXTransfer = data.contractType === 1;

  let details = {
    txType: isTRC20 ? 'TRC20 代币转账' : (isTRXTransfer ? 'TRX 转账' : '合约调用'),
    tokenName: '',
    symbol: '',
    amount: '',
    from: '',
    to: '',
    contractAddress: '',
    decimals: 6,
    netFee: cost.fee || 0,
    energyFee: cost.energy_fee || 0,
    energyUsage: cost.energy_usage || 0,
    netUsage: cost.net_usage || 0,
    memo: data.contractData?.data ? Buffer.from(data.contractData.data.slice(2), 'hex').toString('utf8') : ''
  };

  if (isTRC20) {
    details.tokenName = tokenInfo.tokenName || '';
    details.symbol = tokenInfo.symbol || '';
    details.decimals = tokenInfo.decimals || 6;
    details.amount = formatAmount(tokenInfo.amount_str || tokenInfo.amount, details.decimals);
    details.from = tokenInfo.from_address || '';
    details.to = tokenInfo.to_address || '';
    details.contractAddress = tokenInfo.contract_address || '';
  } else if (isTRXTransfer) {
    details.tokenName = 'Tronix';
    details.symbol = 'TRX';
    details.decimals = 6;
    details.amount = formatTRX(contractData.amount);
    details.from = data.ownerAddress || '';
    details.to = contractData.to_address || '';
  } else {
    details.tokenName = '合约调用';
    details.symbol = '-';
    details.from = data.ownerAddress || '';
    details.to = data.toAddress || '';
  }

  return details;
}

function generatePDF(data, details, outputPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(fs.createWriteStream(outputPath));

  doc.registerFont('Noto', FONT_REGULAR);
  doc.registerFont('Noto-Bold', FONT_BOLD);

  const pageWidth = doc.page.width - 100;
  let y = 50;

  // 标题
  doc.font('Noto-Bold').fontSize(22).fillColor('#1a1a1a').text('TRON 区块链转账凭证', { align: 'center' });
  y += 35;

  // 副标题
  doc.font('Noto').fontSize(10).fillColor('#666').text('TronScan 链上数据核验凭证', { align: 'center' });
  y += 25;

  // 分割线
  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke();
  y += 15;

  // 交易基本信息
  doc.font('Noto-Bold').fontSize(13).fillColor('#2c3e50').text('一、交易基本信息');
  y += 20;

  const baseInfo = [
    ['交易哈希', data.hash],
    ['区块高度', String(data.block || '-')],
    ['交易时间', formatDate(data.timestamp)],
    ['确认数', String(data.confirmations || 0)],
    ['交易类型', details.txType],
    ['交易状态', data.contractRet === 'SUCCESS' ? '✅ 成功' : '❌ ' + (data.contractRet || '未知')]
  ];

  baseInfo.forEach(([label, value]) => {
    doc.font('Noto-Bold').fontSize(10).fillColor('#555').text(label, 60, y, { width: 100 });
    doc.font('Noto').fontSize(10).fillColor('#1a1a1a').text(value, 160, y, { width: 380, break: false });
    y += 18;
  });

  y += 10;
  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke();
  y += 15;

  // 转账详情
  doc.font('Noto-Bold').fontSize(13).fillColor('#2c3e50').text('二、转账详情');
  y += 20;

  const transferInfo = [
    ['代币名称', details.tokenName || '-'],
    ['代币符号', details.symbol || '-'],
    ['转账金额', `${details.amount} ${details.symbol}`],
    ['转出地址', details.from || '-'],
    ['转入地址', details.to || '-'],
    ['合约地址', details.contractAddress || '-']
  ];

  transferInfo.forEach(([label, value]) => {
    doc.font('Noto-Bold').fontSize(10).fillColor('#555').text(label, 60, y, { width: 100 });
    doc.font('Noto').fontSize(10).fillColor('#1a1a1a').text(value, 160, y, { width: 380, break: false, ellipsis: true });
    y += 18;
  });

  y += 10;
  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke();
  y += 15;

  // 网络费用
  doc.font('Noto-Bold').fontSize(13).fillColor('#2c3e50').text('三、网络费用');
  y += 20;

  const totalFee = Number(details.netFee) + Number(details.energyFee);
  const feeInfo = [
    ['带宽消耗', details.netUsage ? `${details.netUsage} bytes` : '-'],
    ['带宽费用', formatTRX(details.netFee) + ' TRX'],
    ['能量消耗', details.energyUsage ? `${details.energyUsage} energy` : '-'],
    ['能量费用', formatTRX(details.energyFee) + ' TRX'],
    ['总费用', formatTRX(totalFee) + ' TRX']
  ];

  feeInfo.forEach(([label, value]) => {
    doc.font('Noto-Bold').fontSize(10).fillColor('#555').text(label, 60, y, { width: 100 });
    doc.font('Noto').fontSize(10).fillColor('#1a1a1a').text(value, 160, y, { width: 380 });
    y += 18;
  });

  // 交易备注
  if (details.memo) {
    y += 10;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke();
    y += 15;
    doc.font('Noto-Bold').fontSize(13).fillColor('#2c3e50').text('四、交易备注');
    y += 20;
    doc.font('Noto').fontSize(10).fillColor('#1a1a1a').text(details.memo, 60, y, { width: 480 });
    y += 30;
  }

  // 核验链接
  y += 10;
  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke();
  y += 15;
  doc.font('Noto-Bold').fontSize(13).fillColor('#2c3e50').text('五、链上核验');
  y += 20;
  doc.font('Noto').fontSize(10).fillColor('#1a1a1a').text('请在 TronScan 浏览器中核验交易详情：', 60, y, { width: 480 });
  y += 18;
  doc.font('Noto-Bold').fontSize(10).fillColor('#2980b9').text(`${TRONSCAN_URL}/${data.hash}`, 60, y, { width: 480 });
  y += 30;

  // 免责声明
  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke();
  y += 15;
  doc.font('Noto-Bold').fontSize(11).fillColor('#7f8c8d').text('免责声明');
  y += 18;
  doc.font('Noto').fontSize(8).fillColor('#7f8c8d').text(
    '本凭证由 TronScan API 实时获取链上数据自动生成，所有内容均为 TRON 区块链上的真实记录。' +
    '本凭证仅作为转账记录的留档参考，不构成任何财务或法律凭证。' +
    '生成时间：' + new Date().toISOString(),
    60, y, { width: 480, align: 'left' }
  );

  doc.end();
}

async function main() {
  try {
    console.log(`正在查询交易: ${txHash}`);
    const data = await fetchTransactionInfo(txHash);
    console.log(`交易状态: ${data.contractRet || '未知'}`);

    const details = extractTransferDetails(data);
    console.log(`转账类型: ${details.txType}`);
    console.log(`金额: ${details.amount} ${details.symbol}`);
    console.log(`从: ${details.from}`);
    console.log(`到: ${details.to}`);

    generatePDF(data, details, outputFile);
    console.log(`\n✅ 凭证已生成: ${outputFile}`);
    console.log(`文件大小: ${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error(`❌ 错误: ${err.message}`);
    process.exit(1);
  }
}

main();
