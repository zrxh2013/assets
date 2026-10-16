# deBridge 任意代币跨链：Polygon → Tron

使用 deBridge DMP（通用消息传递协议）实现自定义 ERC-20 代币从 Polygon 跨链到 Tron 的完整方案。

## 架构原理

采用 **Lock-and-Mint**（锁定-铸造）模式：

```
Polygon (源链)                              Tron (目标链)
─────────────                              ─────────────
用户 → TokenSender 锁定代币                 TokenReceiver 铸造代币
         │                                        ▲
         │  deBridgeGate.send()                   │
         ▼                                        │
   deBridge 验证者网络 ──跨链消息──────────────► CallProxy
```

1. **源链**：用户将代币转入 `TokenSender` 合约（锁定），合约调用 `deBridgeGate.send()` 发送跨链消息
2. **deBridge 网络**：验证者签名确认消息
3. **目标链**：`CallProxy` 调用 `TokenReceiver`，验证来源合法后铸造等量代币给接收者

## 合约地址（主网）

| 链 | 合约 | 地址 |
|---|---|---|
| Polygon | DeBridgeGate | `0x43dE2d77BF8027e25dBD179B491e8d64f38398aA` |
| Polygon | CallProxy | `0x8a0C79F5532f3b2a16AD1E4282A5DAF81928a824` |
| Tron | DeBridgeGate | `TTGA4XQ419jodtFSMFiwYqfgG2uSLRBsnn` |
| Tron | CallProxy | `TUo8FfeP9XJdfB8zoH2nJGLi7CL2LJ1Lin` |

## 目录结构

```
├── contracts/
│   ├── TokenSender.sol          # 源链合约：锁定代币 + 发送跨链消息
│   ├── TokenReceiver.sol        # 目标链合约：接收消息 + 铸造代币
│   └── interfaces/
│       ├── IDeBridgeGate.sol
│       ├── ICallProxy.sol
│       └── IFlags.sol
├── scripts/
│   ├── deploy-sender.ts         # 部署 Polygon Sender
│   ├── deploy-receiver.ts       # 部署 Tron Receiver
│   ├── set-trusted-addresses.ts # 建立双向信任
│   ├── bridge-to-tron.ts        # 发起跨链转账
│   └── check-status.ts          # 查询跨链状态
├── config.json                  # 链配置和合约地址
├── hardhat.config.ts
├── package.json
└── tsconfig.json
```

## 使用步骤

### 1. 安装依赖

```bash
npm install
cp .env.example .env
# 编辑 .env 填入私钥和代币地址
```

### 2. 编译合约

```bash
npx hardhat compile
```

### 3. 部署 TokenSender（Polygon）

```bash
export PRIVATE_KEY=your_private_key
export SOURCE_TOKEN=0xYourTokenAddress
npm run deploy:sender
```

### 4. 部署 TokenReceiver（Tron）

```bash
export TRON_PRIVATE_KEY=your_tron_private_key_hex
npm run deploy:receiver
```

### 5. 建立双向信任

```bash
export PRIVATE_KEY=your_polygon_private_key
export TRON_PRIVATE_KEY=your_tron_private_key_hex
npm run set-trusted
```

### 6. 发起跨链转账

```bash
export PRIVATE_KEY=user_private_key
export AMOUNT=1000000000000000000  # 1 个代币（18 位精度）
export TRON_RECEIVER=TYourTronAddress
npm run bridge
```

### 7. 查询跨链状态

```bash
npm run status 0xYourSubmissionId
# 或使用轮询模式
WATCH=true npm run status 0xYourSubmissionId
```

## 安全说明

- 本合约为示例代码，生产环境使用前请进行安全审计
- `admin` 角色可设置信任地址，请妥善保管私钥
- 跨链消息需要 deBridge 验证者（≥2/3 多签）确认
- 协议费用以链原生币支付（Polygon 为 MATIC，Tron 为 TRX）

## 注意事项

1. **Tron 地址格式**：Tron 地址为 34 字符 Base58 字符串，跨链消息中以 UTF-8 字节传输
2. **精度对齐**：确保源链代币和目标链铸造代币的精度一致
3. **回源链**：`TokenReceiver.bridgeBack()` 支持从 Tron 销毁代币并在源链解锁（需 Sender 实现 unlock 逻辑）
4. **协议费用**：通过 `deBridgeGate.globalFixedNativeFee()` 动态获取

## 参考资料

- [deBridge 官方文档](https://docs.debridge.com)
- [deBridge 合约源码](https://github.com/debridge-finance/debridge-contracts-v1)
- [deBridge DMP 开发指南](https://docs.debridge.com/dmp-details)
