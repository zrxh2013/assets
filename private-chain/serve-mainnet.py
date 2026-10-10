#!/usr/bin/env python3
"""存证仓库 HTTP 服务器（主网版）—— 提供静态页面 + 主网 API 代理"""
import http.server
import json
import urllib.request
import os

ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')
MAINNET_NODE = 'https://api.trongrid.io'
USDT_CONTRACT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'  # TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ASSETS_DIR, **kwargs)

    def end_headers(self):
        if self.path.endswith('.html') or self.path == '/':
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        self.send_header('Connection', 'close')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/api/transaction?txid='):
            txid = self.path.split('txid=')[1]
            self.proxy_transaction(txid)
        elif self.path.startswith('/api/balance?address='):
            address = self.path.split('address=')[1].split('&')[0]
            self.proxy_balance(address)
        else:
            super().do_GET()

    def proxy_transaction(self, txid):
        """代理查询主网交易"""
        try:
            req = urllib.request.Request(
                f'{MAINNET_NODE}/wallet/gettransactionbyid',
                data=json.dumps({'value': txid}).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())

            if not data:
                self.send_json({'error': 'txID not found on mainnet'}, 404)
                return

            raw = data.get('raw_data', {})
            contract = raw.get('contract', [{}])[0]
            v = contract.get('parameter', {}).get('value', {})

            memo = ''
            memo_obj = None
            data_hex = raw.get('data', '')
            if data_hex:
                try:
                    memo = bytes.fromhex(data_hex).decode('utf-8')
                    memo_obj = json.loads(memo)
                except Exception:
                    pass

            self.send_json({
                'txID': data.get('txID'),
                'type': contract.get('type'),
                'timestamp': raw.get('timestamp'),
                'owner_address': v.get('owner_address'),
                'to_address': v.get('to_address'),
                'amount': v.get('amount'),
                'memo_hex': data_hex,
                'memo_text': memo,
                'memo_json': memo_obj,
            })
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def proxy_balance(self, address):
        """代理查询主网账户余额（TRX + USDT）"""
        try:
            fixed = address.replace('I', 'L').replace('l', 'i').replace('O', 'Q').replace('0', '1')
            import base58check
            addr_hex = base58check.b58decode(fixed)[:21].hex()
            address = fixed
        except Exception:
            self.send_json({'error': f'地址格式无效: {address}'}, 400)
            return

        try:
            req = urllib.request.Request(
                f'{MAINNET_NODE}/wallet/getaccount',
                data=json.dumps({'address': addr_hex}).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())

            trx_balance = (data.get('balance', 0)) / 1_000_000

            # USDT 余额：主网 getaccount 可能直接返回 trc20；否则调用合约 balanceOf
            usdt_balance = 0
            trc20_list = data.get('trc20', [])
            for token in trc20_list:
                for k, v in token.items():
                    if k.lower() == USDT_CONTRACT_HEX.lower():
                        usdt_balance = int(v)
                        break

            if usdt_balance == 0 and not trc20_list:
                owner_param = addr_hex[2:].rjust(64, '0')
                req2 = urllib.request.Request(
                    f'{MAINNET_NODE}/wallet/triggerconstantcontract',
                    data=json.dumps({
                        'owner_address': addr_hex,
                        'contract_address': USDT_CONTRACT_HEX,
                        'function_selector': 'balanceOf(address)',
                        'parameter': owner_param,
                    }).encode(),
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                try:
                    with urllib.request.urlopen(req2, timeout=15) as resp2:
                        result = json.loads(resp2.read())
                    constant = result.get('constant_result', [])
                    if constant:
                        usdt_balance = int(constant[0], 16)
                except Exception:
                    pass

            self.send_json({
                'address': address,
                'trx': trx_balance,
                'usdt': usdt_balance / 1_000_000,
                'usdt_raw': usdt_balance,
            })
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    os.chdir(ASSETS_DIR)
    server = http.server.HTTPServer(('0.0.0.0', 8080), Handler)
    print('✅ 存证仓库服务器启动（主网版）: http://127.0.0.1:8080')
    print(f'   静态文件: {ASSETS_DIR}')
    print(f'   主网节点: {MAINNET_NODE}')
    print(f'   USDT 合约: {USDT_CONTRACT_HEX}')
    print('   API: /api/transaction?txid=xxx  /api/balance?address=xxx')
    server.serve_forever()
