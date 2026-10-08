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
