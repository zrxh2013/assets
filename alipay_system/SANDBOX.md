# 支付宝沙箱接入指南

本文档介绍如何把支付宝收款码系统从模拟模式切换到沙箱模式，进行真实链路测试（资金不流动）。

## 一、前置准备

### 1. 注册支付宝开发者账号
访问 https://open.alipay.com ，用企业或个人支付宝登录。

### 2. 进入沙箱
登录后访问 https://open.alipay.com/develop/sandbox/app
你会看到沙箱里已自动分配的"沙箱版"应用，含：
- APPID（沙箱专属，形如 `2021000xxxxxxxxx`）
- 沙箱版支付宝账号（买家账号 + 卖家账号，登录密码、支付密码均会显示）
- 沙箱网关：`https://openapi-sandbox.dl.alipaydev.com/gateway.do`

### 3. 下载沙箱版支付宝 App
扫码或下载：https://open.alipay.com/develop/sandbox/app
- 仅 Android 版（用沙箱买家账号登录）
- 用于真实扫码付款测试

### 4. 配置接口加签方式
在沙箱应用页面 → "接口加签方式" → 选 **公钥模式** → 用支付宝密钥生成器（[下载地址](https://docs.open.alipay.com/291/105971/)）生成 RSA2 密钥对：
- **应用私钥**：填入 `.env` 的 `ALIPAY_APP_PRIVATE_KEY`
- **应用公钥**：上传到沙箱页面
- **支付宝公钥**：沙箱页面回传，填入 `.env` 的 `ALIPAY_PUBLIC_KEY`

## 二、配置 .env

```bash
cd alipay_system
cp .env.example .env
```

编辑 `.env`，填入沙箱凭证：

```ini
ALIPAY_MODE=real
ALIPAY_ENV=sandbox
ALIPAY_APP_ID=2021000xxxxxxxxx           # 沙箱 APPID
ALIPAY_APP_PRIVATE_KEY=MIIEvQIBA...      # 应用私钥（纯 base64，无 PEM 头尾）
ALIPAY_PUBLIC_KEY=MIIBIjANBgkqhkiG...    # 支付宝公钥（纯 base64）
ALIPAY_SIGN_TYPE=RSA2
ALIPAY_NOTIFY_URL=http://your-domain/alipay/notify
ALIPAY_RETURN_URL=http://127.0.0.1:8000/pay/return
```

**关键点**：
- `ALIPAY_NOTIFY_URL` 必须公网可达，支付宝服务器要能 POST 到
- 本地开发用 `bash tunnel.sh` 拿公网域名（推荐 cloudflared quick tunnel，零配置）

## 三、启动内网穿透

```bash
# 在另一个终端跑（保持运行）
bash tunnel.sh 8000
```

输出形如：
```
公网地址: https://abc-xyz.trycloudflare.com
支付宝回调配置（写入 .env）：
  ALIPAY_NOTIFY_URL=https://abc-xyz.trycloudflare.com/alipay/notify
  ALIPAY_RETURN_URL=https://abc-xyz.trycloudflare.com/pay/return
```

**把这两行 URL 复制到 .env 替换 `your-domain`**，然后重启 Flask 服务。

## 四、启动服务并验证

```bash
# 1. 验证配置加载
python -c "from alipay_client import is_real_pay, get_alipay_client; print('real_mode:', is_real_pay()); c=get_alipay_client(); print('client ok')"
# 期望输出：
#   real_mode: True
#   client ok

# 2. 启动 Flask
python app.py
# 访问 http://127.0.0.1:8000/login
```

## 五、完整链路测试

1. **登录商户后台**（`demo / 123456`）
2. **生成收款码**：金额 0.01 元，备注"沙箱测试"
3. **点击"查看"→"打开支付页"**：付款页应显示商户名 + 脱敏账号
4. **点"去支付"**：
   - **模拟模式**：弹出本地收银台 → 输入支付密码 → 显示成功
   - **沙箱模式**：直接显示支付宝二维码 + "等待买家支付..."
5. **用沙箱版支付宝 App 扫码**：用沙箱买家账号支付 0.01 元
6. **支付成功后**：
   - 浏览器前端自动轮询 `/pay/<token>/query` 拿到 `paid` 状态
   - 显示成功页 + 支付宝交易号
7. **商户后台 → 收款记录**：能看到这笔订单 + 真实支付宝交易号
8. **退款测试**：在收款记录点退款 → 调 `alipay.trade.refund` → 资金退回买家

## 六、模拟模式 vs 沙箱模式 vs 生产模式

| 模式 | ALIPAY_MODE | ALIPAY_ENV | 资金 | 用途 |
|---|---|---|---|---|
| 模拟 | `simulation` | — | 不流动 | 演示、UI 测试、CI |
| 沙箱 | `real` | `sandbox` | 沙箱余额 | 真实链路测试 |
| 生产 | `real` | `production` | 真实资金 | 正式运营 |

**切换生产**：仅需改 `.env`：
- `ALIPAY_ENV=production`
- `ALIPAY_APP_ID` / 私钥 / 公钥换成正式应用凭证
- `ALIPAY_NOTIFY_URL` / `ALIPAY_RETURN_URL` 换成正式域名

## 七、常见问题

### Q1：扫码后状态一直 pending？
- 检查 `.env` 的 `ALIPAY_NOTIFY_URL` 是否公网可达
- 浏览器开发者工具看 `/pay/<token>/query` 返回的 status
- 看 Flask 日志有没有 `/alipay/notify` POST 请求
- 看 `/tmp/alipay_server.log`

### Q2：notify 收到但验签失败？
- 确认 `ALIPAY_PUBLIC_KEY` 是支付宝公钥（不是应用公钥）
- 确认 `ALIPAY_SIGN_TYPE=RSA2`（不是 RSA）
- 私钥/公钥不要带 PEM 头尾 `-----BEGIN/END-----`，纯 base64

### Q3：下单接口返回"支付宝下单失败"？
- 看返回的 msg 字段（沙箱会告诉具体原因）
- 常见：APPID 不对、签名错、商户未开通"当面付"产品权限（沙箱默认开通）

### Q4：cloudflared 启动失败？
- 沙箱网络可能阻断 trycloudflare API
- 换 ngrok（需注册）或 cpolar（国内推荐）
- 有公网服务器用 `bash tunnel.sh 8000 --ssh`

## 八、安全检查清单

切到生产前务必确认：

- [ ] `.env` 加入 `.gitignore`，不入库
- [ ] `FLASK_SECRET_KEY` 固定值，不依赖文件持久化
- [ ] `ALIPAY_NOTIFY_URL` 走 HTTPS
- [ ] 支付宝回调验签通过（`verify_notify` 返回 True 才更新订单）
- [ ] 商户登录密码哈希已升级到 PBKDF2
- [ ] CSRF 保护覆盖所有写操作路由
- [ ] 商户敏感字段（real_name/id_card 等）不进对外页面上下文
- [ ] 退款走 CAS 条件更新防并发超退
