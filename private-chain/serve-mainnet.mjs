// 存证仓库 HTTP 服务器（主网版）—— Node.js 实现，更兼容反向代理
import http from 'http';
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets');
const MAINNET_HOST = 'api.trongrid.io';
const USDT_CONTRACT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function tronRpc(path, body) {
  const res = await fetch(`https://${MAINNET_HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('parse error: ' + text.slice(0, 200)); }
}

function b58decode(addr) {
  // TRON base58 字母表
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const ch of addr) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid char: ' + ch);
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(50, '0');
  return hex.slice(0, 42); // 21 bytes
}

function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Connection': 'close',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/transaction') {
    const txid = url.searchParams.get('txid') || '';
    try {
      const data = await tronRpc('/wallet/gettransactionbyid', { value: txid });
      if (!data || !data.raw_data) { sendJson(res, { error: 'txID not found' }, 404); return; }
      const raw = data.raw_data;
      const contract = raw.contract?.[0] || {};
      const v = contract.parameter?.value || {};
      let memo = '', memoObj = null;
      if (raw.data) {
        try { memo = Buffer.from(raw.data, 'hex').toString('utf8'); memoObj = JSON.parse(memo); } catch {}
      }
      sendJson(res, {
        txID: data.txID, type: contract.type, timestamp: raw.timestamp,
        owner_address: v.owner_address, to_address: v.to_address, amount: v.amount,
        memo_hex: raw.data || '', memo_text: memo, memo_json: memoObj,
      });
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  if (url.pathname === '/api/balance') {
    let address = url.searchParams.get('address') || '';
    let addrHex;
    try {
      const fixed = address.replace(/I/g, 'L').replace(/l/g, 'i').replace(/O/g, 'Q').replace(/0/g, '1');
      addrHex = b58decode(fixed);
      address = fixed;
    } catch { sendJson(res, { error: '地址格式无效' }, 400); return; }
    try {
      const data = await tronRpc('/wallet/getaccount', { address: addrHex });
      const trx = (data.balance || 0) / 1e6;
      let usdtRaw = 0;
      for (const tok of (data.trc20 || [])) {
        for (const [k, v] of Object.entries(tok)) {
          if (k.toLowerCase() === USDT_CONTRACT_HEX.toLowerCase()) usdtRaw = parseInt(v, 10);
        }
      }
      if (usdtRaw === 0) {
        const ownerParam = addrHex.slice(2).padStart(64, '0');
        const r = await tronRpc('/wallet/triggerconstantcontract', {
          owner_address: addrHex, contract_address: USDT_CONTRACT_HEX,
          function_selector: 'balanceOf(address)', parameter: ownerParam,
        });
        if (r.constant_result?.[0]) usdtRaw = parseInt(r.constant_result[0], 16);
      }
      sendJson(res, { address, trx, usdt: usdtRaw / 1e6, usdt_raw: usdtRaw });
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // 静态文件
  let filePath = url.pathname === '/' ? '/attestation-repository.html' : url.pathname;
  filePath = path.join(ASSETS_DIR, filePath);
  if (!filePath.startsWith(ASSETS_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length, 'Connection': 'close' };
    if (ext === '.html') headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(data);
  });
});

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 存证仓库服务器（主网版）启动: http://127.0.0.1:${PORT}`);
  console.log(`   主网节点: https://${MAINNET_HOST}`);
  console.log(`   API: /api/transaction?txid=xxx  /api/balance?address=xxx`);
});
