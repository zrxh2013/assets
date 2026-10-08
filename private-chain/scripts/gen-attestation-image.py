#!/usr/bin/env python3
"""生成 USDT 存证凭证图 —— 将存证标题和内容嵌入 USDT logo"""
from PIL import Image, ImageDraw, ImageFont
import os, textwrap

ASSETS = '/workspace/private-chain/assets'
LOGO_PATH = os.path.join(ASSETS, 'usdt-logo-official.jpg')
OUTPUT_PATH = os.path.join(ASSETS, 'usdt-attestation-certificate.png')

# 存证数据（从链上获取）
TITLE = "USDT 转账凭证"
DATA = {
    "发送方 (From)": "TBhVUCRm3pZDJ144V9dLP6SNjf8ZaRZGkF",
    "接收方 (To)": "TY2rZAHXd1zovaLAfSQSpQ57r1kLMKsADR",
    "转账金额": "1,675,980 USDT",
    "数据哈希 (dataHash)": "0x91c8c5e6da5fdfbfabf1a6efe058c40e26af450915496afa1aa2362913575c14",
}
TXID = "294d7580270df4d842f038e3336a8e1153d1e82d64fd9401e6d24efaf0ee004d"
TIMESTAMP = "2026-10-08 10:24:15"

# 画布设置
W, H = 1080, 1920
BG_COLOR = (250, 248, 243)  # 米白背景
GOLD = (184, 134, 11)       # 金色
DARK = (44, 44, 44)         # 深灰
GRAY = (136, 136, 136)      # 灰色
GREEN = (38, 161, 123)      # 绿色（金额）

# 加载字体
def get_font(size, bold=False):
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

# 加载中文字体
def get_cjk_font(size):
    candidates = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc',
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return get_font(size)

# 创建画布
img = Image.new('RGB', (W, H), BG_COLOR)
draw = ImageDraw.Draw(img)

# 加载 USDT logo
logo = Image.open(LOGO_PATH).convert('RGBA')
logo_size = 360
logo = logo.resize((logo_size, logo_size), Image.LANCZOS)
logo_x = (W - logo_size) // 2
logo_y = 120
img.paste(logo, (logo_x, logo_y), logo if logo.mode == 'RGBA' else None)

# 标题
title_font = get_cjk_font(52)
title_bbox = draw.textbbox((0, 0), TITLE, font=title_font)
title_w = title_bbox[2] - title_bbox[0]
draw.text(((W - title_w) // 2, logo_y + logo_size + 60), TITLE, fill=DARK, font=title_font)

# 副标题
sub_font = get_cjk_font(26)
sub_text = "区块链存证凭证 · 数据永久上链不可篡改"
sub_bbox = draw.textbbox((0, 0), sub_text, font=sub_font)
sub_w = sub_bbox[2] - sub_bbox[0]
draw.text(((W - sub_w) // 2, logo_y + logo_size + 130), sub_text, fill=GOLD, font=sub_font)

# 分隔线
line_y = logo_y + logo_size + 190
draw.line([(120, line_y), (W - 120, line_y)], fill=(216, 160, 23), width=2)

# 存证内容
content_font = get_cjk_font(30)
label_font = get_cjk_font(26)
value_font = get_cjk_font(28)
amount_font = get_cjk_font(40)

y = line_y + 50
for label, value in DATA.items():
    # 标签
    draw.text((120, y), label, fill=GRAY, font=label_font)
    y += 42

    # 值（金额用绿色大字）
    if label == "转账金额":
        draw.text((120, y), value, fill=GREEN, font=amount_font)
        y += 62
    elif label.startswith("数据哈希") or "(" in label:
        # 长地址/哈希换行显示
        wrapped = textwrap.wrap(value, width=44)
        for line in wrapped:
            draw.text((120, y), line, fill=DARK, font=value_font)
            y += 40
        y += 10
    else:
        wrapped = textwrap.wrap(value, width=44)
        for line in wrapped:
            draw.text((120, y), line, fill=DARK, font=value_font)
            y += 40
        y += 10

    # 分隔虚线
    y += 8
    draw.line([(120, y), (W - 120, y)], fill=(224, 224, 224), width=1)
    y += 20

# 存证交易信息
y += 20
draw.text((120, y), "存证交易 (txID)", fill=GRAY, font=label_font)
y += 42
txid_wrapped = textwrap.wrap(TXID, width=44)
for line in txid_wrapped:
    draw.text((120, y), line, fill=GOLD, font=value_font)
    y += 40

y += 10
draw.text((120, y), f"存证时间: {TIMESTAMP}", fill=GRAY, font=label_font)
y += 40

# 底部网络标识
y = H - 120
net_font = get_cjk_font(24)
net_text = "TRON 私链（测试网络）"
net_bbox = draw.textbbox((0, 0), net_text, font=net_font)
net_w = net_bbox[2] - net_bbox[0]
draw.text(((W - net_w) // 2, y), net_text, fill=GOLD, font=net_font)

y += 40
verify_text = f"验证: 查询 txID {TXID[:16]}... 解码 memo"
verify_bbox = draw.textbbox((0, 0), verify_text, font=get_cjk_font(20))
verify_w = verify_bbox[2] - verify_bbox[0]
draw.text(((W - verify_w) // 2, y), verify_text, fill=GRAY, font=get_cjk_font(20))

# 保存
img.save(OUTPUT_PATH, 'PNG')
print(f"✅ 存证凭证图已生成: {OUTPUT_PATH}")
print(f"   尺寸: {img.size}")
