---
name: "tron-chain-ops"
description: "TRON 链上转账、带 memo 上链存证、余额查询与交易确认。当用户需要在 TRON 主网/Nile 测试网发送 TRX、将数据写入交易 memo 上链存证、查询地址余额或验证交易确认时调用。"
---

# TRON 链上操作

封装 TRON 网络的常见链上操作：TRX 转账、带 memo 的上链存证、余额查询、交易确认验证。支持主网 (`api.trongrid.io`) 和 Nile 测试网 (`nile.trongrid.io`)。

## 前置条件

- Node.js 环境，已安装 `tronweb`
- 发送方私钥（环境变量或配置文件，**禁止硬编码到 skill**）
- 发送地址有足够 TRX 余额（含带宽/能量手续费）

## 1. 查询地址余额

```js
const { TronWeb } = require('tronweb');
const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' }); // 主网
// const tw = new TronWeb({ fullHost: 'https://nile.trongrid.io' }); // Nile 测试网

const acc = await tw.trx.getAccount('<T地址>');
console.log('余额:', (acc.balance || 0) / 1000000, 'TRX');
```

**注意**：`getaccount` RPC 对未激活地址返回空对象，`balance` 为 0。用 TronWeb `trx.getAccount` 比 curl 更可靠。

## 2. TRX 转账

```js
const tw = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: '<发送方私钥>', // 从环境变量读取
});

const result = await tw.trx.sendTransaction('<接收方T地址>', amountInSun);
// 1 TRX = 1_000_000 sun
if (result.result) {
  console.log('txID:', result.txid);
  console.log('Tronscan:', `https://tronscan.org/#/transaction/${result.txid}`);
}
```

## 3. 带 memo 的上链存证（关键场景）

将任意 JSON 数据写入交易 memo 实现链上存证。**必须用 `transactionBuilder.sendTrx` 的 `data` 选项**，不要手动注入 protobuf（易导致签名验证失败）。

```js
const tw = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: '<发送方私钥>',
});
const BURN = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'; // 黑洞地址

const memoObj = { ty: 'ANCHOR', v: 1, data: '...' };
const memoHex = Buffer.from(JSON.stringify(memoObj), 'utf-8').toString('hex');

// memo 限制约 900 字节，超限时分批
const tx = await tw.transactionBuilder.sendTrx(BURN, 1, undefined, { data: memoHex });
const signed = await tw.trx.sign(tx);
const result = await tw.trx.sendRawTransaction(signed);
```

**memo 大小控制**：单条 JSON 超过 900 字节时拆分为多笔交易，每批 ≤ 3 条记录。

## 4. 交易确认验证

```js
// 方式1：Tronscan API
const info = await fetch(`https://apilist.tronscanapi.com/api/transaction-info?hash=${txid}`).then(r => r.json());
console.log('confirmed:', info.confirmed, 'ret:', info.contractRet);

// 方式2：TronGrid RPC
const txInfo = await tw.trx.getTransactionInfo(txid);
console.log('block:', txInfo.blockNumber, 'fee:', txInfo.fee);
```

到账验证可能有 3~10 秒延迟，建议 `sleep 3~5` 后再查余额。

## 常见问题

| 错误 | 原因 | 解决 |
|-----|------|-----|
| `SIGERROR ... is signed by ... but it is not contained of permission` | 手动注入 protobuf 后 txID 计算错误，签名地址不匹配 | 改用 `transactionBuilder.sendTrx({ data: memoHex })` |
| `Client network socket disconnected before secure TLS` | 临时网络抖动 | 重试该笔交易，间隔 1.5~2 秒 |
| `Service is not available in your region` | Nile 水龙头区域限制 | 换用有余额的测试网地址转账，或通过浏览器人机验证领取 |
| 余额查询返回 0 但实际到账 | 节点同步延迟 | 用 TronWeb `trx.getAccount` 或等待几秒重查 |

## 安全约定

- 私钥通过环境变量传入，不写入 skill 或脚本
- 主网操作前必须确认余额充足（≥ 手续费 + 转账金额）
- 测试网 TRX 不可用于主网，两条链独立
- 黑洞地址 `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb` 用于存证类 1 drop 转账
