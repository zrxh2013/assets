#!/usr/bin/env python3
"""存证仓库 HTTP 服务器 —— 提供静态页面 + 私链 API 代理"""
import http.server
import json
import urllib.request
import os

ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')
PRIVATE_NODE = 'http://127.0.0.1:18090'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ASSETS_DIR, **kwargs)

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
        """代理查询私链交易"""
        try:
            req = urllib.request.Request(
                f'{PRIVATE_NODE}/wallet/gettransactionbyid',
                data=json.dumps({'value': txid}).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())

            raw = data.get('raw_data', {})
            contract = raw.get('contract', [{}])[0]
            v = contract.get('parameter', {}).get('value', {})

            # 解码 memo
            memo = ''
            memo_obj = None
            data_hex = raw.get('data', '')
            if data_hex:
                try:
                    memo = bytes.fromhex(data_hex).decode('utf-8')
                    memo_obj = json.loads(memo)
                except Exception:
                    pass

            result = {
                'txID': data.get('txID'),
                'type': contract.get('type'),
                'timestamp': raw.get('timestamp'),
                'owner_address': v.get('owner_address'),
                'to_address': v.get('to_address'),
                'amount': v.get('amount'),
                'memo_hex': data_hex,
                'memo_text': memo,
                'memo_json': memo_obj,
            }
            self.send_json(result)
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def proxy_balance(self, address):
        """代理查询私链账户余额（TRX + TRC20）"""
        try:
            # 地址转 hex：base58 解码后取前 21 字节（去掉末尾 4 字节 checksum）
            import base58check
            addr_hex = base58check.b58decode(address)[:21].hex()
        except Exception:
            self.send_json({'error': '地址格式无效'}, 400)
            return

        try:
            req = urllib.request.Request(
                f'{PRIVATE_NODE}/wallet/getaccount',
                data=json.dumps({'address': addr_hex}).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())

            trx_balance = (data.get('balance', 0)) / 1_000_000

            # TRC20 余额: 私链 getaccount 不返回 trc20，需通过合约 balanceOf 查询
            trc20_map = {}
            trc20_list = data.get('trc20', [])
            if trc20_list:
                # 主网/部分节点直接返回 trc20 字段
                for token in trc20_list:
                    for k, v in token.items():
                        trc20_map[k] = int(v)
            else:
                # 私链：调用 USDT 合约 balanceOf 查询
                USDT_CONTRACT_HEX = '41b79c4f7d2aac45e8f63cde7759c14474fed67786'
                owner_param = addr_hex[2:].rjust(64, '0')
                req2 = urllib.request.Request(
                    f'{PRIVATE_NODE}/wallet/triggerconstantcontract',
                    data=json.dumps({
                        'owner_address': addr_hex,
                        'contract_address': USDT_CONTRACT_HEX,
                        'function_selector': 'balanceOf(address)',
                        'parameter': owner_param,
                    }).encode(),
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                with urllib.request.urlopen(req2, timeout=10) as resp2:
                    result = json.loads(resp2.read())
                constant = result.get('constant_result', [])
                if constant:
                    trc20_map[USDT_CONTRACT_HEX] = int(constant[0], 16)

            self.send_json({
                'address': address,
                'trx': trx_balance,
                'trc20': trc20_map,
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
    print('✅ 存证仓库服务器启动: http://127.0.0.1:8080')
    print(f'   静态文件: {ASSETS_DIR}')
    print(f'   私链节点: {PRIVATE_NODE}')
    print('   API: /api/transaction?txid=xxx')
    server.serve_forever()
