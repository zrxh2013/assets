import urllib.request, json, subprocess, time

SEND_ADDR = 'TN7U3YnxzGoSnMpPbaYeB6LLsktp88CcCQ'
BURN_ADDR = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'

anchor = json.load(open('assets/anchor-result-v2.json'))
anchorMap = anchor['anchorMap']

memoObj = {
    "a": "usdt-1156-anchor", "v": "2.0",
    "n": "TRON-MAINNET", "s": "TRON-NILE",
    "c": "TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq",
    "m": anchor['merkleRoot'],
    "t": 1156, "u": 2, "r": 247,
    "amt": "599999904.27",
    "samples": [
        {"i": 0, "ah": anchorMap[0]['anchor_hash'][2:18]},
        {"i": 500, "ah": anchorMap[499]['anchor_hash'][2:18]},
        {"i": 1155, "ah": anchorMap[-1]['anchor_hash'][2:18]},
    ],
    "ts": int(time.time()),
}
memoStr = json.dumps(memoObj)
print(f"Memo ({len(memoStr)} chars)")

# 1. createtransaction
print("\n[1] Build transfer tx...")
req = urllib.request.Request(
    "https://api.trongrid.io/wallet/createtransaction",
    data=json.dumps({"owner_address": SEND_ADDR, "to_address": BURN_ADDR, "amount": 1}).encode(),
    headers={"Content-Type": "application/json"}
)
resp = urllib.request.urlopen(req, timeout=10)
createResult = json.load(resp)
raw_data_hex = createResult['raw_data_hex']
print(f"    raw_data_hex: {len(raw_data_hex)} chars")

# 2. 注入 memo + 签名 + 广播
print("\n[2] Inject memo + sign + broadcast...")
node_code = f'''
const {{ TronWeb }} = require('tronweb');
const {{ Buffer }} = require('buffer');
const fs = require('fs');

const tw = new TronWeb({{ 
  fullHost: 'https://api.trongrid.io', 
  privateKey: '4A1620F8642CE420727CD9BC91156096EA175FB9A9BB5829C67295C6DE1E2309' 
}});

const rawHex = "{raw_data_hex}";
const memoStr = {json.dumps(memoStr)};
const memoBytes = Buffer.from(memoStr, 'utf-8');
const MEMO_TAG = 0x62;
const memoProto = Buffer.concat([Buffer.from([MEMO_TAG]), Buffer.from([memoBytes.length]), memoBytes]);
const rawBuf = Buffer.from(rawHex, 'hex');

let tsEnd = rawBuf.length;
for (let i = rawBuf.length - 1; i >= 0; i--) {{
  if (rawBuf[i] === 0x58) {{
    let pos = i + 1;
    while (pos < rawBuf.length && (rawBuf[pos] & 0x80)) pos++;
    pos++; tsEnd = pos; break;
  }}
}}

const newRaw = Buffer.concat([rawBuf.slice(0, tsEnd), memoProto, rawBuf.slice(tsEnd)]);
const newRawHex = newRaw.toString('hex');
console.log('    Injected. New raw:', newRaw.length, 'bytes');

const tx = {{
  raw_data_hex: newRawHex,
  raw_data: {{
    contract: [{{ type:'TransferContract', parameter:{{ value: {{ to_address:'{BURN_ADDR}', owner_address:'{SEND_ADDR}', amount:1 }}, type_url:'type.googleapis.com/protocol.TransferContract' }} }}]
  }},
  txID: '', visible: false,
}};

tw.trx.sign(tx).then(signed => {{
  console.log('    Signed');
  return tw.trx.sendRawTransaction(signed);
}}).then(r => {{
  console.log('    Result:', JSON.stringify(r).substring(0, 150));
  fs.writeFileSync('/tmp/bcast.json', JSON.stringify(r));
}}).catch(e => {{ console.error(e.message); process.exit(1); }});
'''

result = subprocess.run(['node', '-e', node_code], capture_output=True, text=True, timeout=30)
print(result.stdout)
if result.stderr: print("stderr:", result.stderr[:300])

# 3. 读结果
try:
    bcast = json.load(open('/tmp/bcast.json'))
    txHash = bcast.get('transaction', {}).get('id', bcast.get('txID', ''))
    if bcast.get('result'):
        print(f"\n{'='*60}")
        print(f"🎉  带 MEMO 的主网锚定成功！")
        print(f"{'='*60}")
        print(f"  txID: {txHash}")
        print(f"  Tronscan: https://tronscan.org/#/transaction/{txHash}")
        anchor['mainnetTxID'] = txHash
        anchor['mainnetUrl'] = f"https://tronscan.org/#/transaction/{txHash}"
        anchor['version'] = 'v3-with-memo'
        json.dump(anchor, open('assets/anchor-result-v2.json','w'), indent=2)
        print(f"  ✅ anchor-result-v2.json 已更新")
    else:
        print(f"  ❌ 失败: {bcast}")
except Exception as e:
    print(f"  结果读取失败: {e}")
