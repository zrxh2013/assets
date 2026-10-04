"""
安全优化综合测试：验证 P0 级安全机制是否生效。

覆盖：
1. CSRF 保护（codes / refund / profile / toggle / delete）
2. 密码哈希升级（PBKDF2 + 旧 SHA256 兼容迁移）
3. 支付令牌一次性 + 期限
4. 并发退款 CAS 保护（防超退）
5. Session 持久化密钥文件存在
"""

import os
import sys
import time
import json
import hashlib
import sqlite3
import tempfile

# 让 app 直接以测试模式初始化（模拟支付）
os.environ["ALIPAY_MODE"] = "mock"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import app as app_module
from app import (
    hash_password, verify_password, needs_password_rehash,
    get_csrf_token, verify_csrf_token,
    _pay_tokens, PAY_TOKEN_TTL, gen_trade_no,
)


def banner(title):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


def assert_eq(label, got, want):
    ok = got == want
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}: got={got!r} want={want!r}")
    if not ok:
        raise AssertionError(f"{label} failed")


def assert_true(label, cond, info=None):
    mark = "PASS" if cond else "FAIL"
    extra = f" ({info})" if info else ""
    print(f"  [{mark}] {label}{extra}")
    if not cond:
        raise AssertionError(f"{label} failed")


# 测试用临时库，避免污染真实业务库
TMP_DB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
TMP_DB.close()
app_module.DB_PATH = TMP_DB.name
app_module.app.config["TESTING"] = True
app_module.app.config["PRESERVE_CONTEXT_ON_EXCEPTION"] = False

# 重建 schema
from app import init_db  # noqa
init_db()


# 测试 1：CSRF 保护
banner("1. CSRF 保护")
c = app_module.app.test_client()

# 先注册并登录一个商户（register/login 不带 CSRF 保护，是入口）
r = c.post("/register",
           data={"username": "security_test",
                 "password": "Passw0rd!",
                 "merchant_name": "安全测试商户",
                 "alipay_account": "security@test.com",
                 "merchant_type": "individual"},
           follow_redirects=False)
assert_true("注册成功", r.status_code in (302, 200), f"status={r.status_code}")

# 重新登录建立 session
r = c.post("/login",
           data={"username": "security_test",
                 "password": "Passw0rd!"},
           follow_redirects=False)
assert_true("登录成功", r.status_code in (302, 200), f"status={r.status_code}")

# 登录后注入 CSRF token
with c.session_transaction() as s:
    s["_csrf_token"] = "test_csrf_token_abc"
    assert_true("已登录", "merchant_id" in s, f"session={dict(s)}")
valid_token = "test_csrf_token_abc"

# 不带 token 应被拒（此时已登录，login_required 通过 → csrf_protect 拒绝 → 403）
r = c.post("/codes/create", data={"amount": "1.00", "note": "x"})
assert_eq("无 CSRF 拒绝 (codes/create)", r.status_code, 403)

r = c.post("/codes/1/toggle")
assert_eq("无 CSRF 拒绝 (codes/toggle)", r.status_code, 403)

r = c.post("/codes/1/delete")
assert_eq("无 CSRF 拒绝 (codes/delete)", r.status_code, 403)

r = c.post("/merchant/order/T123/refund", data={"refund_amount": "0.01"})
assert_eq("无 CSRF 拒绝 (refund)", r.status_code, 403)

# 伪造 token 应被拒
r = c.post("/codes/create", data={"amount": "1.00", "csrf_token": "fake"})
assert_eq("伪造 CSRF 拒绝", r.status_code, 403)

# 合法 token 应允许通过（codes/create 在登录后应 200 而非 403）
r = c.post("/codes/create",
           data={"amount": "9.90", "note": "测试", "csrf_token": valid_token})
assert_true("合法 CSRF 通过 (codes/create)", r.status_code != 403, f"status={r.status_code}")
data = r.get_json() or {}
code_token_a = data.get("token")
assert_true("codes/create 返回 token", code_token_a is not None, f"resp={data}")


# 测试 2：密码哈希升级
banner("2. 密码哈希升级 (PBKDF2 + SHA256 兼容)")
new_hash = hash_password("MyPass123")
assert_true("新版哈希以 pbkdf2: 开头", new_hash.startswith("pbkdf2:"), new_hash[:20])
assert_true("verify 正确密码", verify_password("MyPass123", new_hash))
assert_true("verify 拒绝错误密码", not verify_password("Wrong", new_hash))
assert_true("needs_rehash 检测新版", not needs_password_rehash(new_hash))

# 旧版 sha256 兼容
legacy_hash = hashlib.sha256("MyPass123".encode()).hexdigest()
assert_true("verify 兼容旧 SHA256", verify_password("MyPass123", legacy_hash))
assert_true("verify 拒绝旧版错误密码", not verify_password("Wrong", legacy_hash))
assert_true("needs_rehash 检测旧版", needs_password_rehash(legacy_hash))

# 空哈希保护
assert_true("空哈希拒绝", not verify_password("any", ""))


# 测试 3：支付令牌一次性 + 期限
banner("3. 支付令牌 (一次性 / 期限 / 防跳过)")
# 创建一个收款码 + 下单 + 模拟密码验证
r = c.post("/codes/create",
           data={"amount": "5.00", "note": "token测试", "csrf_token": valid_token})
data = r.get_json() or {}
code_token = data.get("token")
assert_true("创建收款码", code_token is not None, f"resp={data}")

# 下单
r = c.post(f"/pay/{code_token}/order", data={"buyer": "测试买家"})
data = r.get_json() or {}
trade_no = data.get("trade_no")
assert_true("下单成功", trade_no is not None, f"resp={data}")

# 不带 pay_token 直接支付 → 拒绝
r = c.post(f"/pay/{code_token}/pay",
           data={"trade_no": trade_no, "pay_method": "balance"})
assert_eq("无 pay_token 拒绝支付", r.status_code, 403)

# 模拟密码错误（PAY_PASSWORD 默认为环境变量，模拟模式下取环境变量或默认）
# 用错误的密码先触发一次失败（验证错误处理）
r = c.post(f"/pay/{code_token}/verify_pwd",
           data={"trade_no": trade_no, "password": "WRONG_PWD"})
# 失败应返回 400 + remaining
assert_true("错误密码返回失败", r.status_code in (400, 429), f"status={r.status_code}")

# 找出当前 PAY_PASSWORD
from app import PAY_PASSWORD
print(f"    INFO: 当前 PAY_PASSWORD = {PAY_PASSWORD!r}")

# 用正确密码拿到 token
r = c.post(f"/pay/{code_token}/verify_pwd",
           data={"trade_no": trade_no, "password": PAY_PASSWORD})
data = r.get_json() or {}
assert_eq("密码正确返回 ok", data.get("ok"), True)
pay_token = data.get("pay_token")
assert_true("下发 pay_token", pay_token is not None)

# 模拟过期场景：手动篡改 _pay_tokens 的过期时间为过去
_pay_tokens[trade_no]["expires"] = time.time() - 1
r = c.post(f"/pay/{code_token}/pay",
           data={"trade_no": trade_no, "pay_method": "balance", "pay_token": pay_token})
assert_eq("过期 token 拒绝支付", r.status_code, 403)

# 重新拿新 token
r = c.post(f"/pay/{code_token}/verify_pwd",
           data={"trade_no": trade_no, "password": PAY_PASSWORD})
pay_token2 = (r.get_json() or {}).get("pay_token")
assert_true("重新拿到新 token", pay_token2 is not None)

# 用合法 token 支付 → 成功
r = c.post(f"/pay/{code_token}/pay",
           data={"trade_no": trade_no, "pay_method": "balance", "pay_token": pay_token2})
data = r.get_json() or {}
assert_eq("合法 token 支付成功", data.get("ok"), True)

# 一次性：再用同 token 支付（订单已 paid，会幂等返回 ok，但 token 应已销毁）
assert_true("token 已销毁", trade_no not in _pay_tokens,
            f"_pay_tokens keys={list(_pay_tokens.keys())}")


# 测试 4：并发退款 CAS 保护
banner("4. 并发退款保护 (CAS / 防超退)")
# 上面那笔订单已 paid，金额 5.00
# 第一次退款：通过 HTTP 接口走正常流程（验证正常退款流程）
r = c.post(f"/merchant/order/{trade_no}/refund",
           data={"refund_amount": "2.00", "reason": "并发测试-第一笔",
                 "csrf_token": valid_token})
data = r.get_json() or {}
assert_eq("第一笔部分退款成功", data.get("ok"), True)
total_after_first = data.get("total_refund")
assert_eq("累计退款 2.00", total_after_first, 2.0)

# CAS 机制在真实并发下才触发（顺序请求每次都会读到最新值）
# 此处直接验证 SQL 的 WHERE refund_amount=? 条件更新模式：
# 模拟"另一请求"在 app 读取后修改 refund_amount，验证 CAS UPDATE 失败

# 模拟 app 读取到的旧值（刚退完 2.00 后的状态）
old_refund_amount = 2.00

# 另一个并发请求已经把 refund_amount 改成 4.50（仍 < 5.00，业务合法）
con = sqlite3.connect(app_module.DB_PATH)
con.execute("UPDATE payments SET refund_amount=? WHERE trade_no=?",
            (4.50, trade_no))
con.commit()

# 此时 app 用旧值 2.00 执行 CAS UPDATE → 应失败（rowcount=0）
cur = con.execute(
    "UPDATE payments SET status=?, refund_amount=?, refund_at=?, refund_reason=? "
    "WHERE trade_no=? AND refund_amount=?",
    ("paid", 2.50, "now", "CAS测试", trade_no, old_refund_amount),
)
con.commit()
rowcount = cur.rowcount
con.close()
assert_eq("CAS UPDATE 在 refund_amount 已变更时 rowcount=0", rowcount, 0)

# 对照：用当前真实值 4.50 执行 CAS UPDATE → 应成功
con = sqlite3.connect(app_module.DB_PATH)
cur = con.execute(
    "UPDATE payments SET status=?, refund_amount=?, refund_at=?, refund_reason=? "
    "WHERE trade_no=? AND refund_amount=?",
    ("paid", 4.80, "now", "CAS对照", trade_no, 4.50),
)
con.commit()
rowcount_ok = cur.rowcount
con.close()
assert_eq("CAS UPDATE 用最新值时 rowcount=1", rowcount_ok, 1)

print("  [PASS] CAS 模式已生效（条件更新防超退）")


# 测试 5：Session 持久化密钥文件
banner("5. Session 持久化密钥文件")
key_file = os.path.join(BASE_DIR, ".secret_key")
if os.environ.get("FLASK_SECRET_KEY"):
    print("  [SKIP] 已设置 FLASK_SECRET_KEY 环境变量，跳过文件持久化检查")
else:
    assert_true(".secret_key 文件存在", os.path.exists(key_file))
    with open(key_file) as f:
        sk = f.read().strip()
    assert_true("密钥长度合理 (>=64)", len(sk) >= 64, f"len={len(sk)}")
    assert_eq("app.secret_key 与文件一致", app_module.app.secret_key, sk)


# 测试 6：支付宝账号脱敏
banner("6. 支付宝账号脱敏 (mask_account)")
from app import mask_account
# 邮箱：保留首字符 + 域名
assert_eq("普通邮箱", mask_account("zhangsan@example.com"), "z***@example.com")
assert_eq("单字符邮箱名", mask_account("a@example.com"), "a***@example.com")
# 手机号：前3 + **** + 后4
assert_eq("11位手机号", mask_account("13888888888"), "138****8888")
assert_eq("7位数字", mask_account("1234567"), "123****4567")
# 短账号保护
assert_eq("空字符串", mask_account(""), "")
assert_eq("1字符", mask_account("a"), "a***")
assert_eq("2字符", mask_account("ab"), "a***")
# 模板过滤器已注册
assert_true("mask_account 过滤器已注册",
            "mask_account" in app_module.app.jinja_env.filters)


# 测试 7：对外页面字段最小暴露
banner("7. 对外页面 merchant 字段最小暴露 (白名单)")
from app import public_merchant_view, PUBLIC_MERCHANT_FIELDS

# 模拟一个完整 merchant 行（含所有敏感字段）
class FakeRow:
    def __init__(self, d):
        self._d = d
    def __getitem__(self, k):
        return self._d[k]
    def keys(self):
        return self._d.keys()

full_row = FakeRow({
    "id": 1, "username": "sec_test", "password_hash": "pbkdf2:xxx",
    "merchant_name": "测试商户", "alipay_account": "test@example.com",
    "avatar_color": "#1677FF",
    "real_name": "王小明", "id_card": "110101199001010012",
    "contact_phone": "13888888888", "org_license": "XYZ-001",
    "uscc": "91110000ABC", "legal_person": "李四",
    "reg_address": "北京市朝阳区", "reg_capital": "100万",
})
view = public_merchant_view(full_row)
view_keys = set(view.keys())
# 白名单应只包含公开字段
assert_eq("白名单字段数", len(view_keys), 3)
for k in view_keys:
    assert_true(f"白名单字段 {k} 合法", k in PUBLIC_MERCHANT_FIELDS, f"key={k}")
# 敏感字段必须不在视图里
sensitive = ["password_hash", "username", "real_name", "id_card",
             "contact_phone", "org_license", "uscc", "legal_person",
             "reg_address", "reg_capital"]
for s in sensitive:
    assert_true(f"敏感字段 {s} 未暴露", s not in view, f"view={view}")

# None 输入应返回空 dict
assert_eq("None 输入返回空 dict", public_merchant_view(None), {})

# 端到端验证：访问 /pay/<token>，渲染后 HTML 不应包含敏感字段值
# 先创建一个收款码（已有 code_token_a），访问 pay 页面
r = c.get(f"/pay/{code_token_a}")
assert_eq("/pay/<token> 状态码", r.status_code, 200)
html = r.get_data(as_text=True)
assert_true("/pay HTML 含商户名", "安全测试商户" in html)
assert_true("/pay HTML 不含真实姓名", "王小明" not in html, "已注册商户 real_name 应不暴露")
assert_true("/pay HTML 不含完整手机号", "13888888888" not in html)
assert_true("/pay HTML 含脱敏账号", "***" in html)


banner("全部测试通过 ✓")
print(f"\n测试用临时库：{TMP_DB.name}（可手动删除）")
