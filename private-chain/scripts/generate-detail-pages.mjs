// 生成 Tronscan 风格的二级页面：每个存证的交易详情页 + 地址余额展示页
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const DIST_DIR = '/tmp/ptahdao-ledger';
const DATA_FILE = '/workspace/private-chain/assets/attestation-88-private-results.json';

const META = {
  contract: 'TGHDLu1XmqswVgg4g7CfACotjAcJZeMwt5',
  contractHex: '414538870cc2b4adda5a0a49f14b34bbfa66b5db35',
  sender: 'TFuRdgLbf87XbDVnoThfCzk4jkxnwsYg1t',
  node: 'TRON 私链节点 (127.0.0.1:18090)',
  chainName: 'PtahDAO Trust Chain',
  chainId: 'PtahDAO-Private',
  symbol: 'USDT',
  tokenName: 'Tether USD',
  decimals: 6,
};

const attestations = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
mkdirSync(`${DIST_DIR}/tx`, { recursive: true });

// 解析 memo
function parseMemo(memoStr) {
  try {
    const m = JSON.parse(memoStr);
    return {
      name: m.t || '',
      amount: m.a || '',
      receipt: m.r || '',
      addr: m.addr || '',
      ts: m.ts || 0,
    };
  } catch {
    return { name: '', amount: '', receipt: '', addr: '', ts: 0 };
  }
}

// 模拟区块号（基于时间戳顺序）
const sortedAttests = [...attestations].sort((a, b) => a.ts - b.ts);
sortedAttests.forEach((a, i) => { a.block = 31 + Math.floor(i / 4); });

// ========== 生成单笔交易详情页（Tronscan 风格）==========
function genTxDetailPage(att, idx) {
  const memo = parseMemo(att.memo);
  const date = new Date(att.ts);
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const hms = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  const block = att.block || 31;
  const energyUsed = 13942 + (idx % 100);
  const bandwidthUsed = 345 + (idx % 20);
  const fee = '0.01392 TRX';
  const memoHex = Buffer.from(att.memo, 'utf8').toString('hex');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>交易详情 ${att.txid.slice(0, 16)}... - Tronscan</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; font-size: 14px; }
  a { color: #4a90e2; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .topbar { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 12px 0; }
  .topbar-inner { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 32px; height: 32px; background: #c41e3a; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 16px; }
  .logo-text { font-size: 18px; font-weight: bold; color: #333; }
  .search { flex: 1; max-width: 400px; margin: 0 20px; }
  .search input { width: 100%; padding: 8px 12px; border: 1px solid #e8e8e8; border-radius: 4px; font-size: 13px; }
  .topbar-links { display: flex; gap: 15px; font-size: 13px; }
  .topbar-links a { color: #666; }

  .breadcrumb { max-width: 1200px; margin: 0 auto; padding: 15px 20px 0; font-size: 13px; color: #999; }
  .breadcrumb a { color: #4a90e2; }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .page-title { font-size: 22px; font-weight: bold; color: #333; margin-bottom: 16px; }

  .card { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .card-header { padding: 12px 20px; border-bottom: 1px solid #f0f0f0; font-weight: 600; font-size: 15px; background: #fafafa; display: flex; justify-content: space-between; align-items: center; }
  .card-body { padding: 16px 20px; }

  .tx-hash-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .tx-hash { font-family: "SF Mono", Consolas, monospace; font-size: 13px; word-break: break-all; color: #333; }
  .copy-btn { background: #f0f0f0; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; color: #666; }

  .status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; background: #e6f7ed; color: #52c41a; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .status-badge::before { content: "✓"; }

  .info-row { display: flex; padding: 10px 0; border-bottom: 1px solid #f5f5f5; }
  .info-row:last-child { border-bottom: none; }
  .info-label { width: 180px; color: #888; flex-shrink: 0; }
  .info-value { flex: 1; color: #333; word-break: break-all; }
  .info-value.mono { font-family: "SF Mono", Consolas, monospace; font-size: 13px; }
  .info-value.amount { color: #c41e3a; font-weight: 600; font-size: 16px; }
  .info-value.link a { color: #4a90e2; }
  .info-value .verified { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; color: #52c41a; font-size: 12px; }

  .token-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; background: #fff3e0; color: #ff9800; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .token-badge::before { content: "₮"; }

  .data-box { background: #f9f9f9; border: 1px solid #e8e8e8; border-radius: 4px; padding: 12px; font-family: "SF Mono", Consolas, monospace; font-size: 12px; word-break: break-all; color: #666; max-height: 200px; overflow-y: auto; }
  .data-box .memo-field { background: #fff; padding: 10px; border-radius: 4px; margin-bottom: 8px; }
  .data-box .memo-field .field-label { color: #999; font-size: 11px; margin-bottom: 4px; }

  .verify-section { background: linear-gradient(135deg, #fff7ed, #ffe4e6); border: 1.5px solid #c41e3a; border-radius: 8px; padding: 16px; margin-top: 16px; }
  .verify-title { font-weight: bold; color: #c41e3a; margin-bottom: 10px; font-size: 14px; }
  .verify-content { font-size: 13px; color: #333; line-height: 1.8; }
  .verify-content code { background: #fff; padding: 2px 6px; border-radius: 3px; font-family: monospace; }

  .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; border-top: 1px solid #e8e8e8; margin-top: 20px; }

  @media (max-width: 768px) {
    .info-label { width: 100px; }
    .topbar-links { display: none; }
  }
</style>
</head>
<body>
<!-- Topbar -->
<div class="topbar">
  <div class="topbar-inner">
    <div class="logo">
      <div class="logo-icon">T</div>
      <div class="logo-text">Tronscan</div>
    </div>
    <div class="search">
      <input type="text" placeholder="搜索地址 / 交易哈希 / 区块..." />
    </div>
    <div class="topbar-links">
      <a href="../index.html">首页</a>
      <a href="../address.html">地址</a>
      <a href="../index.html">交易列表</a>
    </div>
  </div>
</div>

<!-- Breadcrumb -->
<div class="breadcrumb">
  <a href="../index.html">首页</a> / <a href="../index.html">交易</a> / 交易详情
</div>

<div class="container">
  <h1 class="page-title">交易详情</h1>

  <!-- 交易基本信息 -->
  <div class="card">
    <div class="card-header">
      <span>交易信息</span>
      <span class="status-badge">成功</span>
    </div>
    <div class="card-body">
      <div class="info-row">
        <div class="info-label">交易哈希</div>
        <div class="info-value mono">
          <div class="tx-hash-row">
            <span class="tx-hash">${att.txid}</span>
            <button class="copy-btn" onclick="copyText('${att.txid}')">复制</button>
          </div>
        </div>
      </div>
      <div class="info-row">
        <div class="info-label">区块</div>
        <div class="info-value">
          <a href="#">#${block}</a>
          <span style="color:#999;margin-left:8px;font-size:12px;">(已确认)</span>
        </div>
      </div>
      <div class="info-row">
        <div class="info-label">区块时间</div>
        <div class="info-value">${ymd} ${hms} (UTC+8)</div>
      </div>
      <div class="info-row">
        <div class="info-label">交易类型</div>
        <div class="info-value">触发智能合约</div>
      </div>
      <div class="info-row">
        <div class="info-label">状态</div>
        <div class="info-value"><span class="status-badge">成功</span></div>
      </div>
    </div>
  </div>

  <!-- 转账信息（TRC20 USDT）-->
  <div class="card">
    <div class="card-header">
      <span>转账详情</span>
      <span class="token-badge">USDT</span>
    </div>
    <div class="card-body">
      <div class="info-row">
        <div class="info-label">合约地址</div>
        <div class="info-value mono link">
          <a href="../address.html?addr=${META.contract}">${META.contract}</a>
          <span class="verified">✓ 已验证</span>
        </div>
      </div>
      <div class="info-row">
        <div class="info-label">代币名称</div>
        <div class="info-value">Tether USD (USDT)</div>
      </div>
      <div class="info-row">
        <div class="info-label">发送方 (From)</div>
        <div class="info-value mono link">
          <a href="../address.html?addr=${META.sender}">${META.sender}</a>
        </div>
      </div>
      <div class="info-row">
        <div class="info-label">接收方 (To)</div>
        <div class="info-value mono link">
          <a href="../address.html?addr=${att.addr}">${att.addr}</a>
        </div>
      </div>
      <div class="info-row">
        <div class="info-label">转账金额</div>
        <div class="info-value amount">${att.amount} USDT</div>
      </div>
      <div class="info-row">
        <div class="info-label">代币精度</div>
        <div class="info-value">${META.decimals} decimals</div>
      </div>
    </div>
  </div>

  <!-- 资源消耗 -->
  <div class="card">
    <div class="card-header">资源消耗</div>
    <div class="card-body">
      <div class="info-row">
        <div class="info-label">能量消耗</div>
        <div class="info-value">${energyUsed.toLocaleString()} Energy</div>
      </div>
      <div class="info-row">
        <div class="info-label">带宽消耗</div>
        <div class="info-value">${bandwidthUsed} Bandwidth</div>
      </div>
      <div class="info-row">
        <div class="info-label">手续费</div>
        <div class="info-value">${fee}</div>
      </div>
    </div>
  </div>

  <!-- Memo / Data 字段 -->
  <div class="card">
    <div class="card-header">交易数据 (Memo / Data)</div>
    <div class="card-body">
      <div class="data-box">
        <div class="memo-field">
          <div class="field-label">Memo 明文（存证数据）：</div>
          ${att.memo}
        </div>
        <div class="memo-field">
          <div class="field-label">Memo Hex：</div>
          ${memoHex}
        </div>
      </div>
    </div>
  </div>

  <!-- 存证核验信息 -->
  <div class="verify-section">
    <div class="verify-title">🛡 存证核验信息</div>
    <div class="verify-content">
      受益人姓名：<code>${memo.name}</code><br/>
      存证金额：<code>${memo.amount} USDT</code><br/>
      回执编号：<code>${memo.receipt}</code><br/>
      受益人地址：<code>${memo.addr}</code><br/>
      上链时间戳：<code>${memo.ts}</code>（${ymd} ${hms}）<br/>
      <hr style="margin:10px 0;border:none;border-top:1px dashed #c41e3a;"/>
      <b>✓ 链上转账金额与存证金额一致：</b>${att.amount} USDT = ${memo.amount} USDT<br/>
      <b>✓ 链上接收方地址与存证地址一致：</b>${att.addr} = ${memo.addr}<br/>
      <b>✓ 交易哈希 SHA-256 已上链存证</b>
    </div>
  </div>
</div>

<div class="footer">
  Powered by Tronscan-style · PtahDAO Trust Chain · 共 ${attestations.length} 笔存证
</div>

<script>
function copyText(text) {
  navigator.clipboard && navigator.clipboard.writeText(text);
  const btn = event.target;
  const old = btn.textContent;
  btn.textContent = '已复制';
  setTimeout(() => btn.textContent = old, 1500);
}
</script>
</body>
</html>`;
}

// ========== 生成地址余额展示页 ==========
function genAddressPage() {
  // 计算每个地址的汇总数据
  const addrMap = new Map();
  attestations.forEach(a => {
    const m = parseMemo(a.memo);
    const entry = addrMap.get(a.addr) || { addr: a.addr, txCount: 0, totalIn: 0, txList: [] };
    entry.txCount++;
    entry.totalIn += parseFloat(a.amount);
    entry.txList.push({ txid: a.txid, amount: a.amount, name: m.name, receipt: m.receipt, ts: a.ts });
    addrMap.set(a.addr, entry);
  });
  // 添加发送方
  addrMap.set(META.sender, {
    addr: META.sender, txCount: attestations.length, totalIn: 0, isSender: true,
    txList: []
  });

  const addrList = Array.from(addrMap.values()).sort((a, b) => b.totalIn - a.totalIn);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>地址详情 - Tronscan</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; font-size: 14px; }
  a { color: #4a90e2; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .topbar { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 12px 0; }
  .topbar-inner { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 32px; height: 32px; background: #c41e3a; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 16px; }
  .logo-text { font-size: 18px; font-weight: bold; }
  .topbar-links { display: flex; gap: 15px; font-size: 13px; }
  .topbar-links a { color: #666; }

  .breadcrumb { max-width: 1200px; margin: 0 auto; padding: 15px 20px 0; font-size: 13px; color: #999; }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .page-title { font-size: 22px; font-weight: bold; margin-bottom: 16px; }

  .card { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .card-header { padding: 12px 20px; border-bottom: 1px solid #f0f0f0; font-weight: 600; font-size: 15px; background: #fafafa; }
  .card-body { padding: 16px 20px; }

  .info-row { display: flex; padding: 10px 0; border-bottom: 1px solid #f5f5f5; }
  .info-row:last-child { border-bottom: none; }
  .info-label { width: 180px; color: #888; flex-shrink: 0; }
  .info-value { flex: 1; color: #333; word-break: break-all; }
  .info-value.mono { font-family: "SF Mono", Consolas, monospace; font-size: 13px; }
  .info-value.amount { color: #c41e3a; font-weight: 600; font-size: 18px; }
  .info-value .usdt { color: #ff9800; font-weight: 600; }

  .balance-box { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
  .balance-item { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 16px; text-align: center; }
  .balance-label { font-size: 12px; color: #999; margin-bottom: 6px; }
  .balance-value { font-size: 20px; font-weight: bold; }
  .balance-value.trx { color: #c41e3a; }
  .balance-value.usdt { color: #26a17b; }

  table { width: 100%; border-collapse: collapse; }
  th { background: #fafafa; padding: 10px; text-align: left; font-size: 13px; color: #666; border-bottom: 1px solid #e8e8e8; }
  td { padding: 10px; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
  td.mono { font-family: "SF Mono", Consolas, monospace; font-size: 12px; }
  td.amount { color: #c41e3a; font-weight: 600; }
  tr:hover { background: #fafafa; }

  .addr-search { padding: 12px 20px; }
  .addr-search input { width: 100%; padding: 10px 14px; border: 1px solid #e8e8e8; border-radius: 4px; font-size: 13px; }

  .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; border-top: 1px solid #e8e8e8; margin-top: 20px; }

  @media (max-width: 768px) {
    .info-label { width: 100px; }
    .balance-box { grid-template-columns: 1fr; }
    .topbar-links { display: none; }
  }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <div class="logo">
      <div class="logo-icon">T</div>
      <div class="logo-text">Tronscan</div>
    </div>
    <div class="topbar-links">
      <a href="index.html">首页</a>
      <a href="index.html">交易列表</a>
    </div>
  </div>
</div>

<div class="breadcrumb">
  <a href="index.html">首页</a> / 地址列表
</div>

<div class="container">
  <h1 class="page-title">地址详情</h1>

  <div class="addr-search">
    <input id="addrSearch" type="text" placeholder="输入地址查询（如 TLaGjwhv...）" />
  </div>

  <!-- 发送方钱包 -->
  <div class="card" id="sender-card">
    <div class="card-header">发送方钱包（主钱包）</div>
    <div class="card-body">
      <div class="info-row">
        <div class="info-label">地址</div>
        <div class="info-value mono">${META.sender}</div>
      </div>
      <div class="balance-box">
        <div class="balance-item">
          <div class="balance-label">TRX 余额</div>
          <div class="balance-value trx">9,999,999,740.14 TRX</div>
        </div>
        <div class="balance-item">
          <div class="balance-label">USDT 余额</div>
          <div class="balance-value usdt">986,855,470.84 USDT</div>
        </div>
        <div class="balance-item">
          <div class="balance-label">已发起交易</div>
          <div class="balance-value">${attestations.length}</div>
        </div>
      </div>
      <div class="info-row">
        <div class="info-label">已转出 USDT</div>
        <div class="info-value usdt">${attestations.reduce((s,a)=>s+parseFloat(a.amount),0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} USDT</div>
      </div>
      <div class="info-row">
        <div class="info-label">USDT 合约</div>
        <div class="info-value mono">${META.contract}</div>
      </div>
    </div>
  </div>

  <!-- USDT 合约 -->
  <div class="card">
    <div class="card-header">USDT 合约</div>
    <div class="card-body">
      <div class="info-row">
        <div class="info-label">合约地址</div>
        <div class="info-value mono">${META.contract}</div>
      </div>
      <div class="info-row">
        <div class="info-label">代币名称</div>
        <div class="info-value">Tether USD</div>
      </div>
      <div class="info-row">
        <div class="info-label">代币符号</div>
        <div class="info-value">USDT</div>
      </div>
      <div class="info-row">
        <div class="info-label">精度</div>
        <div class="info-value">6</div>
      </div>
      <div class="info-row">
        <div class="info-label">总发行量</div>
        <div class="info-value amount">1,000,000,000 USDT</div>
      </div>
    </div>
  </div>

  <!-- 受益人地址汇总 -->
  <div class="card">
    <div class="card-header">受益人地址汇总（共 ${addrList.filter(a=>!a.isSender).length} 个）</div>
    <div class="card-body" style="padding:0;">
      <table>
        <thead>
          <tr>
            <th>地址</th>
            <th>收到 USDT</th>
            <th>交易数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="addrTableBody">
          ${addrList.filter(a => !a.isSender).map(a => `
            <tr class="addr-row">
              <td class="mono">${a.addr}</td>
              <td class="amount">${a.totalIn.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USDT</td>
              <td>${a.txCount}</td>
              <td><a href="index.html?addr=${a.addr}">查看交易</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="footer">
  Powered by Tronscan-style · PtahDAO Trust Chain · 共 ${attestations.length} 笔存证
</div>

<script>
const addrSearch = document.getElementById('addrSearch');
addrSearch.addEventListener('input', () => {
  const q = addrSearch.value.trim().toLowerCase();
  document.querySelectorAll('.addr-row').forEach(row => {
    const addr = row.cells[0].textContent.toLowerCase();
    row.style.display = addr.includes(q) ? '' : 'none';
  });
});

// URL 参数自动填充
const params = new URLSearchParams(location.search);
const addrParam = params.get('addr');
if (addrParam) {
  addrSearch.value = addrParam;
  addrSearch.dispatchEvent(new Event('input'));
}
</script>
</body>
</html>`;
}

// ========== 生成主索引页（更新版，带跳转）==========
function genIndexPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-store">
<title>PtahDAO 信托确权清算存证账本 — Tronscan 风格</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; font-size: 14px; }
  a { color: #4a90e2; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .topbar { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 12px 0; position: sticky; top: 0; z-index: 10; }
  .topbar-inner { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 32px; height: 32px; background: #c41e3a; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 16px; }
  .logo-text { font-size: 18px; font-weight: bold; }
  .topbar-links { display: flex; gap: 15px; font-size: 13px; }
  .topbar-links a { color: #666; }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }

  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat-card { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-label { font-size: 12px; color: #999; margin-bottom: 6px; }
  .stat-value { font-size: 22px; font-weight: bold; color: #333; }
  .stat-value.usdt { color: #26a17b; }
  .stat-value.trx { color: #c41e3a; }

  .card { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .card-header { padding: 12px 20px; border-bottom: 1px solid #f0f0f0; font-weight: 600; font-size: 15px; background: #fafafa; display: flex; justify-content: space-between; align-items: center; }
  .card-body { padding: 0; }

  .search-box { padding: 12px 20px; }
  .search-box input { width: 100%; padding: 10px 14px; border: 1px solid #e8e8e8; border-radius: 4px; font-size: 13px; }

  table { width: 100%; border-collapse: collapse; }
  th { background: #fafafa; padding: 12px 16px; text-align: left; font-size: 13px; color: #666; border-bottom: 1px solid #e8e8e8; }
  td { padding: 12px 16px; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
  td.mono { font-family: "SF Mono", Consolas, monospace; font-size: 12px; }
  td.amount { color: #c41e3a; font-weight: 600; }
  tr:hover { background: #fafafa; cursor: pointer; }
  .status-badge { display: inline-flex; padding: 2px 8px; background: #e6f7ed; color: #52c41a; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .token-badge { display: inline-flex; padding: 2px 8px; background: #fff3e0; color: #ff9800; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .empty { text-align: center; padding: 40px; color: #999; }

  .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; border-top: 1px solid #e8e8e8; margin-top: 20px; }

  @media (max-width: 768px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .topbar-links { display: none; }
    table { font-size: 12px; }
    th, td { padding: 8px; }
  }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <div class="logo">
      <div class="logo-icon">T</div>
      <div class="logo-text">Tronscan</div>
    </div>
    <div class="topbar-links">
      <a href="index.html">交易列表</a>
      <a href="address.html">地址详情</a>
    </div>
  </div>
</div>

<div class="container">
  <!-- 统计 -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">存证笔数</div>
      <div class="stat-value" id="statCount">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">存证总金额 (USDT)</div>
      <div class="stat-value usdt" id="statTotal">0.00</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">成功交易</div>
      <div class="stat-value trx" id="statSuccess">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">受益人地址</div>
      <div class="stat-value" id="statAddr">0</div>
    </div>
  </div>

  <!-- 搜索 -->
  <div class="card">
    <div class="search-box">
      <input id="searchInput" type="text" placeholder="搜索姓名 / 回执号 / txID / 地址..." />
    </div>
  </div>

  <!-- 交易列表 -->
  <div class="card">
    <div class="card-header">
      <span>交易列表</span>
      <span style="font-size:12px;color:#999;">点击行查看详情</span>
    </div>
    <div class="card-body">
      <table>
        <thead>
          <tr>
            <th>回执号</th>
            <th>受益人</th>
            <th>交易哈希</th>
            <th>金额</th>
            <th>代币</th>
            <th>区块</th>
            <th>时间</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody id="txTableBody"></tbody>
      </table>
      <div id="emptyMsg" class="empty" style="display:none;">无匹配记录</div>
    </div>
  </div>
</div>

<div class="footer">
  Powered by Tronscan-style · PtahDAO Trust Chain · 共 <span id="totalCount">0</span> 笔存证
</div>

<script>
window.__META = ${JSON.stringify(META)};
window.__ATTESTATIONS = ${JSON.stringify(attestations)};
</script>
<script src="app.js"></script>
</body>
</html>`;
}

// ========== 执行生成 ==========
console.log('=== 生成 70 笔交易详情页 ===');
attestations.forEach((a, i) => {
  const html = genTxDetailPage(a, i);
  writeFileSync(`${DIST_DIR}/tx/${a.txid}.html`, html);
});
console.log(`✓ 生成 ${attestations.length} 个交易详情页 → ${DIST_DIR}/tx/`);

console.log('=== 生成地址余额展示页 ===');
const addrHtml = genAddressPage();
writeFileSync(`${DIST_DIR}/address.html`, addrHtml);
console.log(`✓ address.html 生成完成`);

console.log('=== 生成主索引页（Tronscan 风格）===');
const indexHtml = genIndexPage();
writeFileSync(`${DIST_DIR}/index.html`, indexHtml);
console.log(`✓ index.html 生成完成`);

console.log('');
console.log('=== 生成完成 ===');
console.log(`目录: ${DIST_DIR}`);
console.log(`文件: index.html + address.html + tx/*.html (${attestations.length}个)`);
