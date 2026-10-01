"""
支付宝 SDK 封装层
=================
统一封装支付宝开放平台 API 调用，支持沙箱和生产环境切换。
依赖 python-alipay-sdk (pip install python-alipay-sdk)
"""
import os
from functools import lru_cache
from dotenv import load_dotenv

load_dotenv()

# 支付模式：simulation=模拟支付，real=真实支付宝
ALIPAY_MODE = os.getenv("ALIPAY_MODE", "simulation")

# 沙箱网关 / 生产网关
_GATEWAYS = {
    "sandbox": "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
    "production": "https://openapi.alipay.com/gateway.do",
}


def is_real_pay() -> bool:
    """是否启用真实支付宝模式"""
    return ALIPAY_MODE == "real"


@lru_cache(maxsize=1)
def get_alipay_client():
    """
    初始化并缓存支付宝客户端。
    仅在 ALIPAY_MODE=real 时调用，模拟模式不应触发此函数。
    """
    if not is_real_pay():
        raise RuntimeError("当前为模拟模式，不初始化支付宝客户端")

    from alipay import AliPay

    app_id = os.getenv("ALIPAY_APP_ID", "")
    app_private_key = os.getenv("ALIPAY_APP_PRIVATE_KEY", "")
    alipay_public_key = os.getenv("ALIPAY_PUBLIC_KEY", "")
    env = os.getenv("ALIPAY_ENV", "sandbox")
    sign_type = os.getenv("ALIPAY_SIGN_TYPE", "RSA2")

    if not app_id or app_id.startswith("请替换"):
        raise RuntimeError("ALIPAY_APP_ID 未配置，请编辑 .env 文件")
    if not app_private_key or app_private_key.startswith("请替换"):
        raise RuntimeError("ALIPAY_APP_PRIVATE_KEY 未配置，请编辑 .env 文件")
    if not alipay_public_key or alipay_public_key.startswith("请替换"):
        raise RuntimeError("ALIPAY_PUBLIC_KEY 未配置，请编辑 .env 文件")

    client = AliPay(
        appid=app_id,
        app_notify_url=os.getenv("ALIPAY_NOTIFY_URL", ""),
        app_private_key_string=_format_key(app_private_key, "private"),
        alipay_public_key_string=_format_key(alipay_public_key, "public"),
        sign_type=sign_type,
        debug=(env == "sandbox"),
        verbose=False,
    )
    return client


def get_notify_url() -> str:
    """获取异步通知URL"""
    return os.getenv("ALIPAY_NOTIFY_URL", "")


def get_return_url() -> str:
    """获取同步回跳URL"""
    return os.getenv("ALIPAY_RETURN_URL", "")


def _format_key(raw: str, key_type: str) -> str:
    """将纯文本密钥格式化为 PEM 格式"""
    raw = raw.strip()
    if "BEGIN" in raw:
        return raw
    header = "PRIVATE KEY" if key_type == "private" else "PUBLIC KEY"
    # 每 64 字符换行
    lines = [raw[i:i + 64] for i in range(0, len(raw), 64)]
    return f"-----BEGIN {header}-----\n" + "\n".join(lines) + f"\n-----END {header}-----"


def create_precreate(trade_no: str, amount: float, subject: str) -> dict:
    """
    当面付预下单：生成扫码支付二维码链接。

    返回: {"ok": bool, "qr_url": str, "msg": str}
    """
    client = get_alipay_client()
    result = client.api.alipay_trade_precreate(
        out_trade_no=trade_no,
        total_amount=f"{amount:.2f}",
        subject=subject or "收款码支付",
        notify_url=get_notify_url(),
    )
    if result.get("code") == "10000":
        return {"ok": True, "qr_url": result.get("qr_code", "")}
    return {"ok": False, "msg": result.get("sub_msg") or result.get("msg", "预下单失败")}


def verify_notify(data: dict, signature: str) -> bool:
    """
    验证支付宝异步通知签名，确认请求确实来自支付宝。

    data: 去除 sign 和 sign_type 后的表单数据
    signature: sign 字段值
    """
    client = get_alipay_client()
    return client.verify(data, signature)


def create_refund(trade_no: str, refund_amount: float, reason: str = "") -> dict:
    """
    调用支付宝退款接口。

    返回: {"ok": bool, "refund_id": str, "msg": str}
    """
    client = get_alipay_client()
    result = client.api.alipay_trade_refund(
        out_trade_no=trade_no,
        refund_amount=f"{refund_amount:.2f}",
        refund_reason=reason or "商户主动退款",
    )
    if result.get("code") == "10000":
        return {"ok": True, "refund_id": result.get("trade_no", "")}
    return {"ok": False, "msg": result.get("sub_msg") or result.get("msg", "退款失败")}


def query_trade(trade_no: str) -> dict:
    """
    主动查询支付宝交易状态（备用：异步通知未到达时可主动查询）。

    返回: {"ok": bool, "status": str, "alipay_trade_no": str, "msg": str}
    """
    client = get_alipay_client()
    result = client.api.alipay_trade_query(out_trade_no=trade_no)
    if result.get("code") == "10000":
        return {
            "ok": True,
            "status": result.get("trade_status", ""),
            "alipay_trade_no": result.get("trade_no", ""),
            "buyer_logon_id": result.get("buyer_logon_id", ""),
        }
    return {"ok": False, "msg": result.get("sub_msg") or "查询失败"}
