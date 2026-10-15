"""
支付宝 SDK 封装层
=================
统一封装支付宝开放平台 API 调用，支持沙箱和生产环境切换。

兼容两种 SDK：
1. python-alipay-sdk  (社区版，pip install python-alipay-sdk)
   - API: from alipay import AliPay; AliPay(...).api.alipay_trade_xxx()
2. alipay-sdk-python   (官方版，pip install alipay-sdk-python)
   - API: from alipay.aop.api.DefaultAlipayClient import DefaultAlipayClient
          from alipay.aop.api.request.AlipayTradePrecreateRequest import AlipayTradePrecreateRequest
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

    返回一个统一适配器对象，封装两种 SDK 的差异，对外暴露：
      - precreate(trade_no, amount, subject, notify_url) -> dict
      - refund(trade_no, refund_amount, reason) -> dict
      - query(trade_no) -> dict
      - verify(data, signature) -> bool
    """
    if not is_real_pay():
        raise RuntimeError("当前为模拟模式，不初始化支付宝客户端")

    # 先校验凭证
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

    app_private_key_pem = _format_key(app_private_key, "private")
    alipay_public_key_pem = _format_key(alipay_public_key, "public")

    # 优先尝试官方 SDK（alipay-sdk-python）
    try:
        return _OfficialSdkAdapter(
            app_id, app_private_key_pem, alipay_public_key_pem,
            sign_type, env,
        )
    except ImportError:
        pass

    # 回退到社区 SDK（python-alipay-sdk）
    try:
        return _CommunitySdkAdapter(
            app_id, app_private_key_pem, alipay_public_key_pem,
            sign_type, env,
        )
    except ImportError as e:
        raise RuntimeError(
            "未安装支付宝 SDK，请执行: pip install alipay-sdk-python"
        ) from e


class _OfficialSdkAdapter:
    """适配 alipay-sdk-python（官方版）"""

    def __init__(self, app_id, app_private_key_pem, alipay_public_key_pem,
                 sign_type, env):
        from alipay.aop.api.AlipayClientConfig import AlipayClientConfig
        from alipay.aop.api.DefaultAlipayClient import DefaultAlipayClient

        config = AlipayClientConfig()
        config.app_id = app_id
        config.app_private_key = app_private_key_pem
        config.alipay_public_key = alipay_public_key_pem
        config.sign_type = sign_type
        # 沙箱/生产网关切换
        config.gateway = _GATEWAYS.get(env, _GATEWAYS["sandbox"])
        # 沙箱模式 debug=True
        config.debug = (env == "sandbox")
        self._client = DefaultAlipayClient(config, logger=None)
        self._sdk = "official"

    def _exec(self, request):
        """执行请求，返回 dict（已 parse response 体）"""
        # alipay-sdk-python 的 page_execute / execute
        response = self._client.execute(request)
        return self._parse_response(response, request.get_api_method())

    @staticmethod
    def _parse_response(response_text, method):
        """SDK 返回 JSON 字符串，顶层 key 是 "<method>_response" """
        import json
        try:
            data = json.loads(response_text) if isinstance(response_text, str) \
                else response_text
        except Exception as e:
            return {"code": "PARSE_ERROR", "msg": f"解析响应失败: {e}"}
        # 例：method=alipay.trade.precreate，key=alipay_trade_precreate_response
        key = method.replace(".", "_") + "_response"
        body = data.get(key, {})
        # 注入顶层签名校验状态字段（不在此处做验签，verify 接口独立）
        body.setdefault("code", data.get("code", ""))
        body.setdefault("msg", data.get("msg", ""))
        body.setdefault("sub_code", data.get("sub_code", ""))
        body.setdefault("sub_msg", data.get("sub_msg", ""))
        return body

    def precreate(self, trade_no, amount, subject, notify_url=""):
        from alipay.aop.api.request.AlipayTradePrecreateRequest import (
            AlipayTradePrecreateRequest,
        )
        from alipay.aop.api.domain.AlipayTradePrecreateModel import (
            AlipayTradePrecreateModel,
        )

        model = AlipayTradePrecreateModel()
        model.out_trade_no = trade_no
        model.total_amount = f"{amount:.2f}"
        model.subject = subject or "收款码支付"
        req = AlipayTradePrecreateRequest(biz_model=model)
        req.notify_url = notify_url
        body = self._exec(req)
        if body.get("code") == "10000":
            return {"ok": True, "qr_url": body.get("qr_code", "")}
        return {"ok": False, "msg": body.get("sub_msg") or body.get("msg", "预下单失败")}

    def refund(self, trade_no, refund_amount, reason=""):
        from alipay.aop.api.request.AlipayTradeRefundRequest import (
            AlipayTradeRefundRequest,
        )
        from alipay.aop.api.domain.AlipayTradeRefundModel import (
            AlipayTradeRefundModel,
        )
        model = AlipayTradeRefundModel()
        model.out_trade_no = trade_no
        model.refund_amount = f"{refund_amount:.2f}"
        model.refund_reason = reason or "商户主动退款"
        req = AlipayTradeRefundRequest(biz_model=model)
        body = self._exec(req)
        if body.get("code") == "10000":
            return {"ok": True, "refund_id": body.get("trade_no", "")}
        return {"ok": False, "msg": body.get("sub_msg") or body.get("msg", "退款失败")}

    def query(self, trade_no):
        from alipay.aop.api.request.AlipayTradeQueryRequest import (
            AlipayTradeQueryRequest,
        )
        from alipay.aop.api.domain.AlipayTradeQueryModel import (
            AlipayTradeQueryModel,
        )
        model = AlipayTradeQueryModel()
        model.out_trade_no = trade_no
        req = AlipayTradeQueryRequest(biz_model=model)
        body = self._exec(req)
        if body.get("code") == "10000":
            return {
                "ok": True,
                "status": body.get("trade_status", ""),
                "alipay_trade_no": body.get("trade_no", ""),
                "buyer_logon_id": body.get("buyer_logon_id", ""),
            }
        return {"ok": False, "msg": body.get("sub_msg") or "查询失败"}

    def verify(self, data, signature):
        """官方 SDK 的验签：用 alipay_public_key 校验 data 的 signature"""
        from alipay.aop.api.util.Signature import sign_with_rsa2, verify_with_rsa2
        # 官方 SDK 的 verify 接口签名细节因版本而异，做兼容
        try:
            # 拼接待验签字符串（按 key 字典序）
            sorted_items = sorted(data.items())
            query = "&".join(f"{k}={v}" for k, v in sorted_items if v)
            return verify_with_rsa2(
                self._client._config.alipay_public_key,
                query.encode("utf-8"),
                signature,
            )
        except Exception:
            return False


class _CommunitySdkAdapter:
    """适配 python-alipay-sdk（社区版）"""

    def __init__(self, app_id, app_private_key_pem, alipay_public_key_pem,
                 sign_type, env):
        from alipay import AliPay
        self._client = AliPay(
            appid=app_id,
            app_notify_url=os.getenv("ALIPAY_NOTIFY_URL", ""),
            app_private_key_string=app_private_key_pem,
            alipay_public_key_string=alipay_public_key_pem,
            sign_type=sign_type,
            debug=(env == "sandbox"),
            verbose=False,
        )
        self._sdk = "community"

    def precreate(self, trade_no, amount, subject, notify_url=""):
        result = self._client.api.alipay_trade_precreate(
            out_trade_no=trade_no,
            total_amount=f"{amount:.2f}",
            subject=subject or "收款码支付",
            notify_url=notify_url,
        )
        if result.get("code") == "10000":
            return {"ok": True, "qr_url": result.get("qr_code", "")}
        return {"ok": False, "msg": result.get("sub_msg") or result.get("msg", "预下单失败")}

    def refund(self, trade_no, refund_amount, reason=""):
        result = self._client.api.alipay_trade_refund(
            out_trade_no=trade_no,
            refund_amount=f"{refund_amount:.2f}",
            refund_reason=reason or "商户主动退款",
        )
        if result.get("code") == "10000":
            return {"ok": True, "refund_id": result.get("trade_no", "")}
        return {"ok": False, "msg": result.get("sub_msg") or result.get("msg", "退款失败")}

    def query(self, trade_no):
        result = self._client.api.alipay_trade_query(out_trade_no=trade_no)
        if result.get("code") == "10000":
            return {
                "ok": True,
                "status": result.get("trade_status", ""),
                "alipay_trade_no": result.get("trade_no", ""),
                "buyer_logon_id": result.get("buyer_logon_id", ""),
            }
        return {"ok": False, "msg": result.get("sub_msg") or "查询失败"}

    def verify(self, data, signature):
        return self._client.verify(data, signature)


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
    return client.precreate(trade_no, amount, subject, get_notify_url())


def verify_notify(data: dict, signature: str) -> bool:
    """
    验证支付宝异步通知签名，确认请求确实来自支付宝。

    data: 去除 sign 和 sign_type 后的表单数据
    signature: sign 字段值
    """
    client = get_alipay_client()
    try:
        return client.verify(data, signature)
    except Exception:
        return False


def create_refund(trade_no: str, refund_amount: float, reason: str = "") -> dict:
    """
    调用支付宝退款接口。

    返回: {"ok": bool, "refund_id": str, "msg": str}
    """
    client = get_alipay_client()
    return client.refund(trade_no, refund_amount, reason)


def query_trade(trade_no: str) -> dict:
    """
    主动查询支付宝交易状态（备用：异步通知未到达时可主动查询）。

    返回: {"ok": bool, "status": str, "alipay_trade_no": str, "msg": str}
    """
    client = get_alipay_client()
    return client.query(trade_no)
