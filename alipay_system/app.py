"""
支付宝收款码系统 (Alipay Collection Code System)
==============================================
一个基于 Flask 的多商户收款码管理系统，支持：
- 商户注册 / 登录
- 生成带金额、备注的收款二维码
- 模拟买家扫码支付
- 收款记录查询与统计
"""

import os
import io
import base64
import hashlib
import hmac
import secrets
import sqlite3
import time
from datetime import datetime
from functools import wraps

from werkzeug.security import generate_password_hash, check_password_hash

import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
from flask import (
    Flask, request, session, redirect, url_for, render_template,
    jsonify, send_file, abort, g, Response
)

# 支付宝 SDK 封装层（模拟模式/真实模式自动切换）
from alipay_client import (
    is_real_pay, create_precreate, verify_notify,
    create_refund, query_trade, get_return_url,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "alipay.db")

app = Flask(__name__)

# Session 密钥：优先用环境变量，其次用持久化密钥文件，保证重启不掉线
_SECRET_KEY_FILE = os.path.join(BASE_DIR, ".secret_key")
_session_secret = os.getenv("FLASK_SECRET_KEY")
if not _session_secret:
    if os.path.exists(_SECRET_KEY_FILE):
        with open(_SECRET_KEY_FILE, "r") as f:
            _session_secret = f.read().strip()
    if not _session_secret:
        _session_secret = secrets.token_hex(32)
        try:
            with open(_SECRET_KEY_FILE, "w") as f:
                f.write(_session_secret)
        except OSError:
            pass  # 只读环境退化为每次随机（仅开发模式）
app.secret_key = _session_secret
app.config["DB_PATH"] = DB_PATH


# ------------------------------------------------------------------ DB layer
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


@app.context_processor
def inject_csrf_token():
    """向所有模板注入 csrf_token 变量。"""
    return {"csrf_token": get_csrf_token()}


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS merchants (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            merchant_name TEXT NOT NULL,
            alipay_account TEXT NOT NULL,
            avatar_color  TEXT NOT NULL DEFAULT '#1677FF',
            created_at    TEXT NOT NULL,
            real_name     TEXT NOT NULL DEFAULT '',
            id_card       TEXT NOT NULL DEFAULT '',
            id_verified   INTEGER NOT NULL DEFAULT 0,
            merchant_type TEXT NOT NULL DEFAULT 'individual',  -- individual个人 / notary_org公证处法人 / enterprise企业
            merchant_level TEXT NOT NULL DEFAULT 'basic',      -- basic普通用户 / merchant商户 / vip高级商户
            org_license   TEXT NOT NULL DEFAULT '',            -- 机构许可证号（公证处法人/企业用）
            uscc          TEXT NOT NULL DEFAULT '',            -- 统一社会信用代码
            legal_person  TEXT NOT NULL DEFAULT '',            -- 法定代表人
            reg_address   TEXT NOT NULL DEFAULT '',            -- 注册地址
            reg_capital   TEXT NOT NULL DEFAULT '',            -- 注册资本
            contact_phone TEXT NOT NULL DEFAULT '',            -- 联系电话
            website       TEXT NOT NULL DEFAULT '',            -- 官网
            org_type      TEXT NOT NULL DEFAULT '',            -- 机构类型（事业单位等）
            established_date TEXT NOT NULL DEFAULT '',         -- 成立日期
            id_card_source TEXT NOT NULL DEFAULT 'self_certified'  -- 身份证来源：self_certified本人认证 / sample示例数据 / official官方接口
        );

        CREATE TABLE IF NOT EXISTS codes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            token       TEXT UNIQUE NOT NULL,
            amount      REAL,          -- NULL 表示自由金额
            note        TEXT DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'active',  -- active / disabled
            created_at  TEXT NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS payments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_no        TEXT UNIQUE NOT NULL,             -- 商户订单号（系统生成，唯一）
            alipay_trade_no TEXT DEFAULT '',                  -- 支付宝交易号（模拟网关回填）
            code_id         INTEGER NOT NULL,
            merchant_id     INTEGER NOT NULL,
            amount          REAL NOT NULL,
            note            TEXT DEFAULT '',
            buyer           TEXT DEFAULT '匿名用户',
            buyer_contact   TEXT DEFAULT '',                  -- 买家联系方式
            pay_method      TEXT NOT NULL DEFAULT '',         -- balance余额 / bank_card银行卡 / huabei花呗
            status          TEXT NOT NULL DEFAULT 'pending',  -- pending待支付 / paid已支付 / failed失败 / refunded已退款
            created_at      TEXT NOT NULL,                    -- 下单时间
            paid_at         TEXT DEFAULT '',                  -- 支付完成时间
            refund_amount   REAL NOT NULL DEFAULT 0,          -- 退款金额
            refund_at       TEXT DEFAULT '',                  -- 退款时间
            refund_reason   TEXT DEFAULT '',                  -- 退款原因
            client_ip       TEXT DEFAULT '',                  -- 客户端IP
            user_agent      TEXT DEFAULT '',                  -- 浏览器UA
            FOREIGN KEY (code_id) REFERENCES codes(id) ON DELETE CASCADE,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS refunds (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_no        TEXT NOT NULL,
            refund_id       TEXT DEFAULT '',                  -- 支付宝退款流水号
            refund_amount   REAL NOT NULL,
            refund_reason   TEXT DEFAULT '',
            refunded_at     TEXT NOT NULL,
            FOREIGN KEY (trade_no) REFERENCES payments(trade_no)
        );

        CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
        CREATE INDEX IF NOT EXISTS idx_codes_merchant ON codes(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_refunds_trade ON refunds(trade_no);
        """
    )
    # 兼容旧表：补充新增字段（CREATE TABLE IF NOT EXISTS 不会更新已有表结构）
    _ensure_column(db, "merchants", "real_name", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "id_card", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "id_verified", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "merchants", "merchant_type", "TEXT NOT NULL DEFAULT 'individual'")
    _ensure_column(db, "merchants", "merchant_level", "TEXT NOT NULL DEFAULT 'basic'")
    _ensure_column(db, "merchants", "org_license", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "uscc", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "legal_person", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "reg_address", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "reg_capital", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "contact_phone", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "website", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "org_type", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "established_date", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "merchants", "id_card_source", "TEXT NOT NULL DEFAULT 'self_certified'")
    # payments 表升级为完整订单模型
    _ensure_column(db, "payments", "trade_no", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "payments", "alipay_trade_no", "TEXT DEFAULT ''")
    _ensure_column(db, "payments", "buyer_contact", "TEXT DEFAULT ''")
    _ensure_column(db, "payments", "pay_method", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "payments", "created_at", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(db, "payments", "refund_amount", "REAL NOT NULL DEFAULT 0")
    _ensure_column(db, "payments", "refund_at", "TEXT DEFAULT ''")
    _ensure_column(db, "payments", "refund_reason", "TEXT DEFAULT ''")
    _ensure_column(db, "payments", "client_ip", "TEXT DEFAULT ''")
    _ensure_column(db, "payments", "user_agent", "TEXT DEFAULT ''")
    # 旧数据兼容：status 由 success 迁移为 paid，paid_at 空值回填 created_at
    db.execute("UPDATE payments SET status='paid' WHERE status='success'")
    db.execute("UPDATE payments SET paid_at=created_at WHERE paid_at='' OR paid_at IS NULL")
    db.execute("UPDATE payments SET created_at=paid_at WHERE created_at='' OR created_at IS NULL")
    db.execute("UPDATE payments SET trade_no='LEGACY' || id WHERE trade_no='' OR trade_no IS NULL")
    # 旧表 paid_at 原为 NOT NULL，新订单下单时为空，需放宽约束：
    # SQLite 不能直接 ALTER COLUMN，用重建表方式处理（仅当检测到 NOT NULL 时）
    _relax_payments_paid_at(db)
    # 迁移完成后再创建依赖新列的索引
    db.execute("CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_payments_trade_no ON payments(trade_no)")
    db.commit()
    db.close()


def _relax_payments_paid_at(db):
    """若 payments.paid_at 为 NOT NULL，则重建表放宽为允许空。"""
    cols = db.execute("PRAGMA table_info(payments)").fetchall()
    paid_at_col = next((c for c in cols if c[1] == "paid_at"), None)
    if not paid_at_col or paid_at_col[3] == 0:  # notnull 标志位为 0 即允许空
        return
    # 重建表：复制现有数据，paid_at 允许空
    db.execute("ALTER TABLE payments RENAME TO payments_old")
    db.execute("""
        CREATE TABLE payments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_no        TEXT UNIQUE NOT NULL,
            alipay_trade_no TEXT DEFAULT '',
            code_id         INTEGER NOT NULL,
            merchant_id     INTEGER NOT NULL,
            amount          REAL NOT NULL,
            note            TEXT DEFAULT '',
            buyer           TEXT DEFAULT '匿名用户',
            buyer_contact   TEXT DEFAULT '',
            pay_method      TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'pending',
            created_at      TEXT NOT NULL,
            paid_at         TEXT DEFAULT '',
            refund_amount   REAL NOT NULL DEFAULT 0,
            refund_at       TEXT DEFAULT '',
            refund_reason   TEXT DEFAULT '',
            client_ip       TEXT DEFAULT '',
            user_agent      TEXT DEFAULT '',
            FOREIGN KEY (code_id) REFERENCES codes(id) ON DELETE CASCADE,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
        )
    """)
    db.execute("""
        INSERT INTO payments (id, trade_no, alipay_trade_no, code_id, merchant_id, amount,
            note, buyer, buyer_contact, pay_method, status, created_at, paid_at,
            refund_amount, refund_at, refund_reason, client_ip, user_agent)
        SELECT id, trade_no, alipay_trade_no, code_id, merchant_id, amount,
            note, buyer, buyer_contact, pay_method, status, created_at, paid_at,
            refund_amount, refund_at, refund_reason, client_ip, user_agent
        FROM payments_old
    """)
    db.execute("DROP TABLE payments_old")


def _ensure_column(db, table, column, definition):
    """若某列不存在则添加（SQLite 轻量迁移）。"""
    cols = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def mask_id_card(id_card: str) -> str:
    """身份证脱敏：前6位 + 8个星号 + 后4位。"""
    if not id_card or len(id_card) < 10:
        return id_card or ""
    return id_card[:6] + "*" * 8 + id_card[-4:]


def is_valid_id_card(id_card: str) -> bool:
    """简易 18 位身份证校验（含校验位验证）。"""
    if not id_card or len(id_card) != 18:
        return False
    if not id_card[:17].isdigit():
        return False
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check_map = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
    total = sum(int(id_card[i]) * weights[i] for i in range(17))
    return id_card[17].upper() == check_map[total % 11]


# 商户类型 / 等级枚举（集中管理，前后端共用）
MERCHANT_TYPES = {
    "individual": "个人",
    "notary_org": "公证处法人",
    "enterprise": "企业",
}
MERCHANT_LEVELS = {
    "basic": "普通用户",
    "merchant": "商户",
    "vip": "高级商户",
}
VALID_TYPES = set(MERCHANT_TYPES)
VALID_LEVELS = set(MERCHANT_LEVELS)


# --------------------------------------------------------------- helpers
def hash_password(password: str) -> str:
    """生成密码哈希：使用 pbkdf2:sha256 加盐，兼容旧版 sha256 哈希。"""
    return generate_password_hash(password, method="pbkdf2:sha256", salt_length=16)


def verify_password(password: str, stored_hash: str) -> bool:
    """验证密码：支持新版 pbkdf2 哈希和旧版 sha256 哈希（自动迁移）。"""
    if not stored_hash:
        return False
    # 新版哈希以 pbkdf2: 开头
    if stored_hash.startswith("pbkdf2:"):
        return check_password_hash(stored_hash, password)
    # 旧版 sha256（64 位十六进制）
    if len(stored_hash) == 64 and all(c in "0123456789abcdef" for c in stored_hash):
        return hmac.compare_digest(
            hashlib.sha256(password.encode("utf-8")).hexdigest(), stored_hash
        )
    return False


def needs_password_rehash(stored_hash: str) -> bool:
    """检查密码哈希是否需要升级到新版算法。"""
    return not stored_hash.startswith("pbkdf2:")


def gen_token() -> str:
    return secrets.token_urlsafe(12)


def gen_trade_no() -> str:
    """生成商户订单号：年月日时分秒 + 6位随机，如 20260807120000 ABC123"""
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    rand = secrets.token_hex(3).upper()
    return f"{ts}{rand}"


def gen_alipay_trade_no() -> str:
    """模拟支付宝交易号：28位纯数字"""
    return datetime.now().strftime("%Y%m%d%H%M%S") + secrets.token_hex(8)


# 支付方式枚举
PAY_METHODS = {
    "balance": "支付宝余额",
    "bank_card": "银行卡",
    "huabei": "花呗",
}

# 订单状态枚举
ORDER_STATUS = {
    "pending": "待支付",
    "paid": "已支付",
    "failed": "支付失败",
    "refunded": "已退款",
    "closed": "已关闭",
}

# 订单超时时间（秒）：pending 订单超过该时间未支付则自动关闭
ORDER_TIMEOUT_SECONDS = 15 * 60  # 15 分钟

# 支付密码（演示环境固定密码，生产环境应由用户设置并加密存储）
PAY_PASSWORD = os.getenv("PAY_PASSWORD", "123456")
MAX_PWD_RETRY = 5           # 最大密码错误次数
PWD_LOCK_SECONDS = 60       # 超过错误次数后锁定时长（秒）

# 密码重试状态：{ trade_no: {"fails": int, "lock_until": float} }
_pwd_retry = {}

# 支付令牌：密码校验通过后下发，pay_confirm 必须验证令牌才能支付
# 结构: { trade_no: {"token": str, "expires": float} }
_pay_tokens = {}
PAY_TOKEN_TTL = 120  # 支付令牌有效期 120 秒


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def get_csrf_token() -> str:
    """生成或获取当前 session 的 CSRF token。"""
    if "_csrf_token" not in session:
        session["_csrf_token"] = secrets.token_hex(16)
    return session["_csrf_token"]


def verify_csrf_token(token: str) -> bool:
    """校验 CSRF token。"""
    stored = session.get("_csrf_token")
    if not stored or not token:
        return False
    return secrets.compare_digest(stored, token)


def csrf_protect(f):
    """CSRF 校验装饰器：用于商户后台 POST 表单路由。"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == "POST":
            token = (request.form.get("csrf_token") or
                      request.headers.get("X-CSRF-Token") or "")
            if not verify_csrf_token(token):
                return jsonify({"ok": False, "msg": "CSRF 校验失败，请刷新页面重试"}), 403
        return f(*args, **kwargs)
    return decorated


def close_expired_orders(db) -> int:
    """将超过 ORDER_TIMEOUT_SECONDS 仍为 pending 的订单关闭，返回关闭数量。"""
    cutoff = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur = db.execute(
        "UPDATE payments SET status='closed' "
        "WHERE status='pending' "
        "AND datetime(created_at, '+' || ? || ' seconds') < ?",
        (ORDER_TIMEOUT_SECONDS, cutoff),
    )
    db.commit()
    return cur.rowcount


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "merchant_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return wrapper


def current_merchant():
    if "merchant_id" not in session:
        return None
    db = get_db()
    return db.execute(
        "SELECT * FROM merchants WHERE id = ?", (session["merchant_id"],)
    ).fetchone()


def make_qr(data: str) -> bytes:
    """生成 PNG 二维码字节流（圆角模块 + 白边）。"""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
        fill_color="#1A1A1A",
        back_color="white",
    )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def fmt_money(v) -> str:
    try:
        return "¥{:.2f}".format(float(v))
    except (TypeError, ValueError):
        return "¥0.00"


# --------------------------------------------------------------- auth routes
@app.route("/")
def index():
    if "merchant_id" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        merchant_name = (request.form.get("merchant_name") or "").strip()
        alipay_account = (request.form.get("alipay_account") or "").strip()
        real_name = (request.form.get("real_name") or "").strip()
        id_card = (request.form.get("id_card") or "").strip().upper()
        merchant_type = (request.form.get("merchant_type") or "individual").strip()
        org_license = (request.form.get("org_license") or "").strip()

        if not (username and password and merchant_name and alipay_account):
            return render_template("register.html", error="请完整填写所有字段"), 400
        if len(password) < 6:
            return render_template("register.html", error="密码至少 6 位"), 400
        if merchant_type not in VALID_TYPES:
            return render_template("register.html", error="商户类型不合法"), 400
        # 公证处法人 / 企业 必须提供机构许可证号
        if merchant_type in ("notary_org", "enterprise") and not org_license:
            return render_template("register.html",
                                   error="该商户类型需提供机构许可证号"), 400
        # 身份证为选填，但若填写则必须校验通过
        if id_card:
            if not real_name:
                return render_template("register.html", error="填写身份证时需同时提供真实姓名"), 400
            if not is_valid_id_card(id_card):
                return render_template("register.html", error="身份证号格式或校验位不正确"), 400

        db = get_db()
        if db.execute("SELECT id FROM merchants WHERE username = ?", (username,)).fetchone():
            return render_template("register.html", error="用户名已被占用"), 400

        # 新注册默认为普通用户等级；已完成实名或机构类型可直接为商户等级
        level = "merchant" if (id_card or merchant_type != "individual") else "basic"

        cur = db.execute(
            "INSERT INTO merchants (username, password_hash, merchant_name, alipay_account, created_at, "
            "real_name, id_card, id_verified, merchant_type, merchant_level, org_license) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (username, hash_password(password), merchant_name, alipay_account, now(),
             real_name, id_card, 1 if id_card else 0,
             merchant_type, level, org_license),
        )
        db.commit()
        session["merchant_id"] = cur.lastrowid
        return redirect(url_for("dashboard"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        db = get_db()
        m = db.execute(
            "SELECT * FROM merchants WHERE username = ?", (username,)
        ).fetchone()
        if not m or not verify_password(password, m["password_hash"]):
            return render_template("login.html", error="用户名或密码错误"), 401
        # 旧版 sha256 哈希自动升级为 pbkdf2
        if needs_password_rehash(m["password_hash"]):
            db.execute(
                "UPDATE merchants SET password_hash=? WHERE id=?",
                (hash_password(password), m["id"]),
            )
            db.commit()
        session["merchant_id"] = m["id"]
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# --------------------------------------------------------------- dashboard
@app.route("/dashboard")
@login_required
def dashboard():
    db = get_db()
    m = current_merchant()

    # 今日统计
    row = db.execute(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total "
        "FROM payments WHERE merchant_id = ? AND date(paid_at) = ? AND status = 'paid'",
        (m["id"], today()),
    ).fetchone()
    today_count = row["cnt"]
    today_total = row["total"]

    # 总统计
    row = db.execute(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total "
        "FROM payments WHERE merchant_id = ? AND status = 'paid'",
        (m["id"],),
    ).fetchone()
    total_count = row["cnt"]
    total_total = row["total"]

    # 活跃收款码数
    active_codes = db.execute(
        "SELECT COUNT(*) AS cnt FROM codes WHERE merchant_id = ? AND status = 'active'",
        (m["id"],),
    ).fetchone()["cnt"]

    # 最近 7 天收款趋势
    trend = db.execute(
        "SELECT date(paid_at) AS d, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total "
        "FROM payments WHERE merchant_id = ? AND status = 'paid' "
        "AND paid_at >= date('now', '-6 days') "
        "GROUP BY date(paid_at) ORDER BY d",
        (m["id"],),
    ).fetchall()

    # 最近 5 笔收款
    recent = db.execute(
        "SELECT * FROM payments WHERE merchant_id = ? AND status = 'paid' "
        "ORDER BY paid_at DESC LIMIT 5",
        (m["id"],),
    ).fetchall()

    return render_template(
        "dashboard.html",
        merchant=m,
        today_count=today_count, today_total=today_total,
        total_count=total_count, total_total=total_total,
        active_codes=active_codes,
        trend=trend,
        recent=recent,
        fmt=fmt_money,
    )


# --------------------------------------------------------------- codes
@app.route("/codes")
@login_required
def codes():
    db = get_db()
    m = current_merchant()
    rows = db.execute(
        "SELECT c.*, "
        "(SELECT COUNT(*) FROM payments p WHERE p.code_id = c.id AND p.status = 'paid') AS pay_cnt, "
        "(SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.code_id = c.id AND p.status = 'paid') AS pay_sum "
        "FROM codes c WHERE c.merchant_id = ? ORDER BY c.created_at DESC",
        (m["id"],),
    ).fetchall()
    return render_template("codes.html", merchant=m, codes=rows, fmt=fmt_money)


@app.route("/codes/create", methods=["POST"])
@login_required
@csrf_protect
def codes_create():
    m = current_merchant()
    amount_raw = (request.form.get("amount") or "").strip()
    note = (request.form.get("note") or "").strip()

    amount = None
    if amount_raw:
        try:
            amount = round(float(amount_raw), 2)
            if amount <= 0:
                raise ValueError
        except ValueError:
            return jsonify({"ok": False, "msg": "金额格式不正确"}), 400

    token = gen_token()
    db = get_db()
    db.execute(
        "INSERT INTO codes (merchant_id, token, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
        (m["id"], token, amount, note, now()),
    )
    db.commit()
    return jsonify({"ok": True, "token": token})


@app.route("/codes/<int:cid>/toggle", methods=["POST"])
@login_required
@csrf_protect
def codes_toggle(cid):
    m = current_merchant()
    db = get_db()
    c = db.execute(
        "SELECT * FROM codes WHERE id = ? AND merchant_id = ?", (cid, m["id"])
    ).fetchone()
    if not c:
        abort(404)
    new_status = "disabled" if c["status"] == "active" else "active"
    db.execute("UPDATE codes SET status = ? WHERE id = ?", (new_status, cid))
    db.commit()
    return jsonify({"ok": True, "status": new_status})


@app.route("/codes/<int:cid>/delete", methods=["POST"])
@login_required
@csrf_protect
def codes_delete(cid):
    m = current_merchant()
    db = get_db()
    db.execute(
        "DELETE FROM codes WHERE id = ? AND merchant_id = ?", (cid, m["id"])
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/codes/<int:cid>/qr.png")
@login_required
def codes_qr(cid):
    m = current_merchant()
    db = get_db()
    c = db.execute(
        "SELECT * FROM codes WHERE id = ? AND merchant_id = ?", (cid, m["id"])
    ).fetchone()
    if not c:
        abort(404)
    pay_url = url_for("pay", token=c["token"], _external=True)
    png = make_qr(pay_url)
    return send_file(io.BytesIO(png), mimetype="image/png",
                     download_name=f"code_{c['token']}.png")


# --------------------------------------------------------------- payments
@app.route("/records")
@login_required
def records():
    db = get_db()
    m = current_merchant()
    close_expired_orders(db)
    q = (request.args.get("q") or "").strip()
    date_from = (request.args.get("from") or "").strip()
    date_to = (request.args.get("to") or "").strip()

    sql = (
        "SELECT p.*, c.note AS code_note FROM payments p "
        "LEFT JOIN codes c ON c.id = p.code_id "
        "WHERE p.merchant_id = ?"
    )
    params = [m["id"]]
    if q:
        sql += " AND (p.note LIKE ? OR p.buyer LIKE ? OR p.trade_no LIKE ? OR c.note LIKE ?)"
        kw = f"%{q}%"
        params += [kw, kw, kw, kw]
    if date_from:
        sql += " AND date(p.created_at) >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND date(p.created_at) <= ?"
        params.append(date_to)
    sql += " ORDER BY p.created_at DESC LIMIT 500"
    rows = db.execute(sql, params).fetchall()

    total = sum(r["amount"] for r in rows if r["status"] == "paid")
    return render_template(
        "records.html", merchant=m, rows=rows, q=q,
        date_from=date_from, date_to=date_to,
        total=total, fmt=fmt_money,
        order_status=ORDER_STATUS, pay_methods=PAY_METHODS,
    )


# --------------------------------------------------------------- customer pay page
@app.route("/pay/<token>")
def pay(token):
    db = get_db()
    c = db.execute("SELECT * FROM codes WHERE token = ?", (token,)).fetchone()
    if not c:
        return render_template("pay.html", error="收款码不存在或已失效",
                               code=None, merchant=None), 404
    if c["status"] != "active":
        return render_template("pay.html", error="该收款码已停用",
                               code=None, merchant=None), 404
    m = db.execute(
        "SELECT * FROM merchants WHERE id = ?", (c["merchant_id"],)
    ).fetchone()
    return render_template("pay.html", code=c, merchant=m, error=None,
                           real_pay=is_real_pay())


@app.route("/pay/<token>/order", methods=["POST"])
def pay_create_order(token):
    """买家下单：生成待支付订单，返回 trade_no（真实模式额外返回支付宝二维码链接）。"""
    db = get_db()
    # 触发超时订单清理
    close_expired_orders(db)
    c = db.execute("SELECT * FROM codes WHERE token = ?", (token,)).fetchone()
    if not c or c["status"] != "active":
        return jsonify({"ok": False, "msg": "收款码无效"}), 404

    amount_raw = (request.form.get("amount") or "").strip()
    note = (request.form.get("note") or "").strip()
    buyer = (request.form.get("buyer") or "匿名用户").strip() or "匿名用户"
    buyer_contact = (request.form.get("buyer_contact") or "").strip()

    # 固定金额码：忽略用户输入金额
    amount = c["amount"] if c["amount"] is not None else None
    if amount is None:
        try:
            amount = round(float(amount_raw), 2)
            if amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"ok": False, "msg": "请输入有效金额"}), 400

    trade_no = gen_trade_no()
    db.execute(
        "INSERT INTO payments (trade_no, code_id, merchant_id, amount, note, buyer, "
        "buyer_contact, status, created_at, client_ip, user_agent) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
        (trade_no, c["id"], c["merchant_id"], amount, note, buyer,
         buyer_contact, now(), request.remote_addr or "",
         request.headers.get("User-Agent", "")[:200]),
    )
    db.commit()

    # 真实支付宝模式：调预下单生成扫码链接
    if is_real_pay():
        subject = note or c["note"] or "收款码支付"
        pre = create_precreate(trade_no, amount, subject)
        if not pre["ok"]:
            return jsonify({"ok": False, "msg": f"支付宝下单失败: {pre['msg']}"}), 500
        return jsonify({"ok": True, "trade_no": trade_no, "amount": amount,
                        "qr_url": pre["qr_url"], "real_pay": True})

    # 模拟模式：仅返回订单号，前端走本地收银台
    return jsonify({"ok": True, "trade_no": trade_no, "amount": amount})


@app.route("/pay/<token>/pay", methods=["POST"])
def pay_confirm(token):
    """买家在收银台确认支付：模拟网关扣款，幂等处理（同订单重复支付返回原结果）。"""
    db = get_db()
    close_expired_orders(db)
    trade_no = (request.form.get("trade_no") or "").strip()
    pay_method = (request.form.get("pay_method") or "balance").strip()
    if pay_method not in PAY_METHODS:
        return jsonify({"ok": False, "msg": "支付方式不合法"}), 400

    p = db.execute(
        "SELECT * FROM payments WHERE trade_no = ?", (trade_no,)
    ).fetchone()
    if not p:
        return jsonify({"ok": False, "msg": "订单不存在"}), 404
    # 幂等：已支付直接返回成功
    if p["status"] == "paid":
        return jsonify({"ok": True, "trade_no": trade_no,
                        "alipay_trade_no": p["alipay_trade_no"],
                        "amount": p["amount"], "paid_at": p["paid_at"]})
    if p["status"] in ("failed", "refunded", "closed"):
        return jsonify({"ok": False, "msg": f"订单状态为 {ORDER_STATUS[p['status']]}，无法支付"}), 400

    # 模拟模式：校验支付令牌（密码校验通过后下发，防止跳过密码直接支付）
    if not is_real_pay():
        pay_token = (request.form.get("pay_token") or "").strip()
        stored = _pay_tokens.get(trade_no)
        if not stored:
            return jsonify({"ok": False, "msg": "请先完成支付密码校验"}), 403
        if time.time() > stored["expires"]:
            _pay_tokens.pop(trade_no, None)
            return jsonify({"ok": False, "msg": "支付令牌已过期，请重新校验密码"}), 403
        if not secrets.compare_digest(pay_token, stored["token"]):
            return jsonify({"ok": False, "msg": "支付令牌无效"}), 403
        # 令牌使用后立即销毁（一次性）
        _pay_tokens.pop(trade_no, None)

    # 模拟网关扣款（真实场景此处调用支付宝 alipay.trade.pay）
    alipay_trade_no = gen_alipay_trade_no()
    db.execute(
        "UPDATE payments SET status='paid', pay_method=?, alipay_trade_no=?, paid_at=? "
        "WHERE trade_no=? AND status='pending'",
        (pay_method, alipay_trade_no, now(), trade_no),
    )
    db.commit()
    return jsonify({"ok": True, "trade_no": trade_no,
                    "alipay_trade_no": alipay_trade_no,
                    "amount": p["amount"], "paid_at": now()})


@app.route("/pay/<token>/query", methods=["GET"])
def pay_query(token):
    """查询订单状态（收银台前端轮询用）。"""
    trade_no = (request.args.get("trade_no") or "").strip()
    db = get_db()
    close_expired_orders(db)
    p = db.execute(
        "SELECT trade_no, amount, status, pay_method, paid_at, alipay_trade_no "
        "FROM payments WHERE trade_no = ?", (trade_no,)
    ).fetchone()
    if not p:
        return jsonify({"ok": False, "msg": "订单不存在"}), 404
    return jsonify({"ok": True, "data": dict(p)})


@app.route("/pay/notify", methods=["POST"])
def pay_notify():
    """支付宝异步通知回调 —— 真实支付模式下的核心安全环节。

    支付宝在买家支付成功后异步 POST 到此地址，服务端验签后更新订单状态。
    必须返回 "success"（非 200 状态码），否则支付宝会重试。
    """
    if not is_real_pay():
        return "fail"

    data = request.form.to_dict()
    signature = data.pop("sign", "")
    data.pop("sign_type", "")

    # 验签：确认请求确实来自支付宝
    if not verify_notify(data, signature):
        return "fail"

    trade_no = data.get("out_trade_no", "")
    trade_status = data.get("trade_status", "")
    alipay_trade_no = data.get("trade_no", "")

    # 只处理交易成功的通知
    if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        db = get_db()
        p = db.execute(
            "SELECT * FROM payments WHERE trade_no=?", (trade_no,)
        ).fetchone()
        if p and p["status"] == "pending":
            db.execute(
                "UPDATE payments SET status='paid', alipay_trade_no=?, "
                "paid_at=?, pay_method='alipay' WHERE trade_no=? AND status='pending'",
                (alipay_trade_no, now(), trade_no),
            )
            db.commit()

    return "success"


@app.route("/pay/return")
def pay_return():
    """支付宝同步回跳 —— 买家支付后浏览器跳回，展示结果页面。

    注意：此处不做状态更新（以异步 notify 为准），仅渲染结果页。
    """
    trade_no = request.args.get("out_trade_no", "")
    db = get_db()
    close_expired_orders(db)
    p = db.execute(
        "SELECT * FROM payments WHERE trade_no=?", (trade_no,)
    ).fetchone() if trade_no else None
    return render_template("pay_success.html", payment=p, trade_no=trade_no)


@app.route("/pay/<token>/verify_pwd", methods=["POST"])
def pay_verify_pwd(token):
    """支付密码服务端校验，带重试次数限制与临时锁定。"""
    close_expired_orders(get_db())
    trade_no = (request.form.get("trade_no") or "").strip()
    pwd = request.form.get("password") or ""
    if not trade_no:
        return jsonify({"ok": False, "msg": "缺少订单号"}), 400

    state = _pwd_retry.get(trade_no, {"fails": 0, "lock_until": 0})
    now_ts = time.time()
    # 若处于锁定中
    if state["lock_until"] and now_ts < state["lock_until"]:
        remain = int(state["lock_until"] - now_ts)
        return jsonify({"ok": False, "msg": f"密码错误次数过多，请 {remain} 秒后再试",
                        "locked": True, "retry_after": remain}), 429

    if pwd == PAY_PASSWORD:
        # 校验通过，清除该订单的失败记录
        _pwd_retry.pop(trade_no, None)
        # 下发一次性支付令牌（有效期 120 秒），pay_confirm 必须携带此令牌
        pay_token = secrets.token_urlsafe(24)
        _pay_tokens[trade_no] = {"token": pay_token, "expires": now_ts + PAY_TOKEN_TTL}
        return jsonify({"ok": True, "pay_token": pay_token})

    # 密码错误，累计失败次数
    state["fails"] = state.get("fails", 0) + 1
    remaining = MAX_PWD_RETRY - state["fails"]
    if state["fails"] >= MAX_PWD_RETRY:
        state["lock_until"] = now_ts + PWD_LOCK_SECONDS
        _pwd_retry[trade_no] = state
        return jsonify({"ok": False,
                        "msg": f"密码错误次数过多，请 {PWD_LOCK_SECONDS} 秒后再试",
                        "locked": True, "retry_after": PWD_LOCK_SECONDS,
                        "remaining": 0}), 429
    _pwd_retry[trade_no] = state
    return jsonify({"ok": False, "msg": f"支付密码错误，还可尝试 {remaining} 次",
                    "remaining": remaining}), 400


@app.route("/pay/<token>/receipt")
def pay_receipt(token):
    """买家电子凭证页：展示订单完整信息（支付后可查看）。"""
    db = get_db()
    close_expired_orders(db)
    trade_no = (request.args.get("trade_no") or "").strip()
    c = db.execute("SELECT * FROM codes WHERE token = ?", (token,)).fetchone()
    if not c:
        return render_template("receipt.html", error="收款码不存在",
                               payment=None, merchant=None, code=None), 404
    m = db.execute("SELECT * FROM merchants WHERE id = ?", (c["merchant_id"],)).fetchone()
    p = db.execute(
        "SELECT * FROM payments WHERE trade_no = ? AND code_id = ?",
        (trade_no, c["id"]),
    ).fetchone()
    if not p:
        return render_template("receipt.html", error="订单不存在",
                               payment=None, merchant=m, code=c), 404
    return render_template("receipt.html", payment=p, merchant=m, code=c,
                           pay_methods=PAY_METHODS, order_status=ORDER_STATUS, error=None)


@app.route("/order/query", methods=["GET", "POST"])
def order_query():
    """买家订单查询页：凭交易单号查询支付状态（无需登录）。"""
    db = get_db()
    close_expired_orders(db)
    trade_no = ""
    p = None
    merchant = None
    if request.method == "POST":
        trade_no = (request.form.get("trade_no") or "").strip()
        if trade_no:
            p = db.execute(
                "SELECT p.*, c.token AS code_token FROM payments p "
                "LEFT JOIN codes c ON c.id = p.code_id WHERE p.trade_no = ?",
                (trade_no,),
            ).fetchone()
            if p:
                merchant = db.execute(
                    "SELECT merchant_name, alipay_account FROM merchants WHERE id = ?",
                    (p["merchant_id"],),
                ).fetchone()
    return render_template("order_query.html", payment=p, merchant=merchant,
                           trade_no=trade_no, pay_methods=PAY_METHODS,
                           order_status=ORDER_STATUS)


@app.route("/merchant/order/<trade_no>", methods=["GET"])
@login_required
def order_detail(trade_no):
    """商户查看订单详情（JSON）。"""
    m = current_merchant()
    db = get_db()
    p = db.execute(
        "SELECT p.*, c.note AS code_note, c.amount AS code_amount FROM payments p "
        "LEFT JOIN codes c ON c.id = p.code_id "
        "WHERE p.trade_no = ? AND p.merchant_id = ?",
        (trade_no, m["id"]),
    ).fetchone()
    if not p:
        return jsonify({"ok": False, "msg": "订单不存在"}), 404
    return jsonify({
        "ok": True,
        "data": {
            "trade_no": p["trade_no"],
            "alipay_trade_no": p["alipay_trade_no"],
            "amount": p["amount"],
            "note": p["note"],
            "buyer": p["buyer"],
            "buyer_contact": p["buyer_contact"],
            "pay_method": p["pay_method"],
            "pay_method_text": PAY_METHODS.get(p["pay_method"], p["pay_method"]) if p["pay_method"] else "",
            "status": p["status"],
            "status_text": ORDER_STATUS.get(p["status"], p["status"]),
            "created_at": p["created_at"],
            "paid_at": p["paid_at"],
            "refund_amount": p["refund_amount"],
            "refund_at": p["refund_at"],
            "refund_reason": p["refund_reason"],
            "client_ip": p["client_ip"],
            "user_agent": p["user_agent"],
            "code_note": p["code_note"],
        }
    })


@app.route("/merchant/order/<trade_no>/refund", methods=["POST"])
@login_required
@csrf_protect
def order_refund(trade_no):
    """商户发起退款（支持部分退款，累计退款金额不得超过实付金额）。"""
    m = current_merchant()
    db = get_db()
    p = db.execute(
        "SELECT * FROM payments WHERE trade_no = ? AND merchant_id = ?",
        (trade_no, m["id"]),
    ).fetchone()
    if not p:
        return jsonify({"ok": False, "msg": "订单不存在"}), 404
    if p["status"] not in ("paid", "refunded"):
        return jsonify({"ok": False, "msg": f"订单状态为 {ORDER_STATUS[p['status']]}，不可退款"}), 400
    # 已全额退款则不可再退
    if p["status"] == "refunded" and p["refund_amount"] >= p["amount"]:
        return jsonify({"ok": False, "msg": "该订单已全额退款"}), 400

    # 退款金额：默认全额，可指定部分退款
    refund_raw = (request.form.get("refund_amount") or "").strip()
    if refund_raw:
        try:
            refund_amount = round(float(refund_raw), 2)
            if refund_amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"ok": False, "msg": "退款金额不合法"}), 400
    else:
        refund_amount = round(float(p["amount"]) - float(p["refund_amount"] or 0), 2)

    # 累计退款不得超过实付金额
    total_refund = round(float(p["refund_amount"] or 0) + refund_amount, 2)
    if total_refund > p["amount"] + 0.001:
        return jsonify({"ok": False, "msg": f"退款金额超过实付金额，最多可退 ¥{p['amount'] - (p['refund_amount'] or 0):.2f}"}), 400

    reason = (request.form.get("reason") or "商户主动退款").strip()

    # 真实支付宝模式：先调支付宝退款 API
    refund_id = ""
    if is_real_pay():
        r = create_refund(trade_no, refund_amount, reason)
        if not r["ok"]:
            return jsonify({"ok": False, "msg": f"支付宝退款失败: {r['msg']}"}), 500
        refund_id = r.get("refund_id", "")

    # 并发安全：用条件更新（CAS）防止并发退款导致超退
    # WHERE refund_amount = 原值 确保在我们读取和写入之间没有其他退款修改过该字段
    old_refund_amount = float(p["refund_amount"] or 0)
    new_status = "refunded" if total_refund >= p["amount"] - 0.001 else "paid"
    cursor = db.execute(
        "UPDATE payments SET status=?, refund_amount=?, refund_at=?, refund_reason=? "
        "WHERE trade_no=? AND refund_amount=?",
        (new_status, total_refund, now(), reason, trade_no, old_refund_amount),
    )
    if cursor.rowcount == 0:
        # 条件更新失败：说明并发请求已修改了 refund_amount，本次退款需重试
        db.rollback()
        return jsonify({"ok": False, "msg": "退款失败：订单退款状态已变更，请刷新后重试"}), 409

    # 记录退款流水到独立 refunds 表
    db.execute(
        "INSERT INTO refunds (trade_no, refund_id, refund_amount, refund_reason, refunded_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (trade_no, refund_id, refund_amount, reason, now()),
    )
    db.commit()
    return jsonify({"ok": True, "refund_amount": refund_amount,
                    "total_refund": total_refund,
                    "remaining": round(p["amount"] - total_refund, 2),
                    "status": new_status})


@app.route("/records/export.csv")
@login_required
def export_csv():
    """导出对账单 CSV（含 BOM 以兼容 Excel）。"""
    import csv
    import io
    m = current_merchant()
    q = (request.args.get("q") or "").strip()
    date_from = (request.args.get("from") or "").strip()
    date_to = (request.args.get("to") or "").strip()
    db = get_db()
    sql = (
        "SELECT p.*, c.note AS code_note FROM payments p "
        "LEFT JOIN codes c ON c.id = p.code_id WHERE p.merchant_id = ?"
    )
    params = [m["id"]]
    if q:
        sql += " AND (p.note LIKE ? OR p.buyer LIKE ? OR p.trade_no LIKE ? OR c.note LIKE ?)"
        kw = f"%{q}%"
        params += [kw, kw, kw, kw]
    if date_from:
        sql += " AND date(p.created_at) >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND date(p.created_at) <= ?"
        params.append(date_to)
    sql += " ORDER BY p.created_at DESC LIMIT 2000"
    rows = db.execute(sql, params).fetchall()

    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 BOM
    w = csv.writer(buf)
    w.writerow(["交易单号", "支付宝交易号", "下单时间", "支付时间", "买家", "联系电话",
                "金额", "支付方式", "状态", "退款金额", "退款时间", "退款原因",
                "收款备注", "码备注"])
    for r in rows:
        w.writerow([
            r["trade_no"], r["alipay_trade_no"], r["created_at"], r["paid_at"] or "",
            r["buyer"], r["buyer_contact"] or "",
            f"{r['amount']:.2f}", PAY_METHODS.get(r["pay_method"], "") if r["pay_method"] else "",
            ORDER_STATUS.get(r["status"], r["status"]),
            f"{r['refund_amount']:.2f}" if r["refund_amount"] else "0.00",
            r["refund_at"] or "", r["refund_reason"] or "",
            r["note"] or "", r["code_note"] or "",
        ])
    csv_data = buf.getvalue()
    from urllib.parse import quote
    fname = f"alipay_records_{m['merchant_name']}_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv"
    return Response(
        csv_data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"},
    )


@app.route("/pay/<token>/qr.png")
def pay_qr(token):
    """公开的二维码图片（不要求登录），方便展示/下载。"""
    c = get_db().execute(
        "SELECT * FROM codes WHERE token = ?", (token,)
    ).fetchone()
    if not c:
        abort(404)
    pay_url = url_for("pay", token=c["token"], _external=True)
    png = make_qr(pay_url)
    return send_file(io.BytesIO(png), mimetype="image/png")


@app.route("/pay/alipay_qr.png")
def alipay_qr_img():
    """生成支付宝扫码二维码图片（从 qr_url 参数生成）。"""
    url = request.args.get("url", "")
    if not url:
        abort(400)
    png = make_qr(url)
    return send_file(io.BytesIO(png), mimetype="image/png")


# --------------------------------------------------------------- merchant profile
@app.route("/profile", methods=["GET", "POST"])
@login_required
@csrf_protect
def profile():
    m = current_merchant()
    db = get_db()
    if request.method == "POST":
        merchant_name = (request.form.get("merchant_name") or "").strip()
        alipay_account = (request.form.get("alipay_account") or "").strip()
        avatar_color = (request.form.get("avatar_color") or "#1677FF").strip()
        new_password = (request.form.get("password") or "").strip()
        real_name = (request.form.get("real_name") or "").strip()
        id_card = (request.form.get("id_card") or "").strip().upper()
        merchant_type = (request.form.get("merchant_type") or "individual").strip()
        merchant_level = (request.form.get("merchant_level") or m["merchant_level"]).strip()
        org_license = (request.form.get("org_license") or "").strip()

        if not (merchant_name and alipay_account):
            return render_template("profile.html", merchant=m,
                                   error="商户名和支付宝账号不能为空"), 400
        if merchant_type not in VALID_TYPES:
            return render_template("profile.html", merchant=m,
                                   error="商户类型不合法"), 400
        if merchant_level not in VALID_LEVELS:
            return render_template("profile.html", merchant=m,
                                   error="商户等级不合法"), 400
        # 公证处法人 / 企业 必须提供机构许可证号
        if merchant_type in ("notary_org", "enterprise") and not org_license:
            return render_template("profile.html", merchant=m,
                                   error="该商户类型需提供机构许可证号"), 400

        # 处理实名身份证：若提交了身份证则校验；留空则保留原值（不强制要求）
        id_verified = m["id_verified"] if "id_verified" in m.keys() else 0
        if id_card:
            if not real_name:
                return render_template("profile.html", merchant=m,
                                       error="填写身份证时需同时提供真实姓名"), 400
            if not is_valid_id_card(id_card):
                return render_template("profile.html", merchant=m,
                                       error="身份证号格式或校验位不正确"), 400
            id_verified = 1
        elif not real_name:
            id_card = ""
            id_verified = 0

        if new_password:
            if len(new_password) < 6:
                return render_template("profile.html", merchant=m,
                                       error="新密码至少 6 位"), 400
            db.execute(
                "UPDATE merchants SET merchant_name=?, alipay_account=?, avatar_color=?, "
                "real_name=?, id_card=?, id_verified=?, merchant_type=?, merchant_level=?, "
                "org_license=?, password_hash=? WHERE id=?",
                (merchant_name, alipay_account, avatar_color,
                 real_name, id_card, id_verified,
                 merchant_type, merchant_level, org_license,
                 hash_password(new_password), m["id"]),
            )
        else:
            db.execute(
                "UPDATE merchants SET merchant_name=?, alipay_account=?, avatar_color=?, "
                "real_name=?, id_card=?, id_verified=?, merchant_type=?, merchant_level=?, "
                "org_license=? WHERE id=?",
                (merchant_name, alipay_account, avatar_color,
                 real_name, id_card, id_verified,
                 merchant_type, merchant_level, org_license, m["id"]),
            )
        db.commit()
        return redirect(url_for("profile"))
    return render_template("profile.html", merchant=m,
                           merchant_types=MERCHANT_TYPES,
                           merchant_levels=MERCHANT_LEVELS)


# --------------------------------------------------------------- error handlers
@app.errorhandler(404)
def not_found(_):
    return render_template("error.html", code=404,
                           msg="页面不存在"), 404


@app.errorhandler(500)
def server_err(_):
    return render_template("error.html", code=500,
                           msg="服务器内部错误"), 500


# --------------------------------------------------------------- template filters
@app.template_filter("money")
def _money(v):
    return fmt_money(v)


@app.template_filter("initial")
def _initial(name):
    return (name[:1].upper() if name else "M")


@app.template_filter("mask_id")
def _mask_id(id_card):
    return mask_id_card(id_card)


# --------------------------------------------------------------- entrypoint
if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=8000, debug=False)
else:
    # 支持 gunicorn / uwsgi 启动时自动建表
    init_db()
