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
import secrets
import sqlite3
from datetime import datetime
from functools import wraps

import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
from flask import (
    Flask, request, session, redirect, url_for, render_template,
    jsonify, send_file, abort, g
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "alipay.db")

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
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
            established_date TEXT NOT NULL DEFAULT ''          -- 成立日期
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
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            code_id     INTEGER NOT NULL,
            merchant_id INTEGER NOT NULL,
            amount      REAL NOT NULL,
            note        TEXT DEFAULT '',
            buyer       TEXT DEFAULT '匿名用户',
            status      TEXT NOT NULL DEFAULT 'success',  -- success / failed
            paid_at     TEXT NOT NULL,
            FOREIGN KEY (code_id) REFERENCES codes(id) ON DELETE CASCADE,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
        CREATE INDEX IF NOT EXISTS idx_codes_merchant ON codes(merchant_id);
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
    db.commit()
    db.close()


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
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def gen_token() -> str:
    return secrets.token_urlsafe(12)


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


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
        if not m or m["password_hash"] != hash_password(password):
            return render_template("login.html", error="用户名或密码错误"), 401
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
        "FROM payments WHERE merchant_id = ? AND date(paid_at) = ? AND status = 'success'",
        (m["id"], today()),
    ).fetchone()
    today_count = row["cnt"]
    today_total = row["total"]

    # 总统计
    row = db.execute(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total "
        "FROM payments WHERE merchant_id = ? AND status = 'success'",
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
        "FROM payments WHERE merchant_id = ? AND status = 'success' "
        "AND paid_at >= date('now', '-6 days') "
        "GROUP BY date(paid_at) ORDER BY d",
        (m["id"],),
    ).fetchall()

    # 最近 5 笔收款
    recent = db.execute(
        "SELECT * FROM payments WHERE merchant_id = ? ORDER BY paid_at DESC LIMIT 5",
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
        "(SELECT COUNT(*) FROM payments p WHERE p.code_id = c.id AND p.status = 'success') AS pay_cnt, "
        "(SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.code_id = c.id AND p.status = 'success') AS pay_sum "
        "FROM codes c WHERE c.merchant_id = ? ORDER BY c.created_at DESC",
        (m["id"],),
    ).fetchall()
    return render_template("codes.html", merchant=m, codes=rows, fmt=fmt_money)


@app.route("/codes/create", methods=["POST"])
@login_required
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
        sql += " AND (p.note LIKE ? OR p.buyer LIKE ? OR c.note LIKE ?)"
        kw = f"%{q}%"
        params += [kw, kw, kw]
    if date_from:
        sql += " AND date(p.paid_at) >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND date(p.paid_at) <= ?"
        params.append(date_to)
    sql += " ORDER BY p.paid_at DESC LIMIT 500"
    rows = db.execute(sql, params).fetchall()

    total = sum(r["amount"] for r in rows if r["status"] == "success")
    return render_template(
        "records.html", merchant=m, rows=rows, q=q,
        date_from=date_from, date_to=date_to,
        total=total, fmt=fmt_money,
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
    return render_template("pay.html", code=c, merchant=m, error=None)


@app.route("/pay/<token>/submit", methods=["POST"])
def pay_submit(token):
    db = get_db()
    c = db.execute("SELECT * FROM codes WHERE token = ?", (token,)).fetchone()
    if not c or c["status"] != "active":
        return jsonify({"ok": False, "msg": "收款码无效"}), 404

    amount_raw = (request.form.get("amount") or "").strip()
    note = (request.form.get("note") or "").strip()
    buyer = (request.form.get("buyer") or "匿名用户").strip() or "匿名用户"

    # 固定金额码：忽略用户输入金额
    amount = c["amount"] if c["amount"] is not None else None
    if amount is None:
        try:
            amount = round(float(amount_raw), 2)
            if amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"ok": False, "msg": "请输入有效金额"}), 400

    db.execute(
        "INSERT INTO payments (code_id, merchant_id, amount, note, buyer, paid_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (c["id"], c["merchant_id"], amount, note, buyer, now()),
    )
    db.commit()
    return jsonify({"ok": True, "amount": amount})


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


# --------------------------------------------------------------- merchant profile
@app.route("/profile", methods=["GET", "POST"])
@login_required
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
