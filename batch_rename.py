"""批量重命名文件脚本

用法：
    python batch_rename.py <目录> [选项]

示例：
    # 给所有文件加前缀
    python batch_rename.py ./photos --prefix "2026_"

    # 按序号重命名：photo_001.jpg, photo_002.jpg ...
    python batch_rename.py ./photos --pattern "photo_{:03d}"

    # 替换文件名中的字符串
    python batch_rename.py ./docs --replace "旧名字" "新名字"

    # 修改扩展名
    python batch_rename.py ./imgs --ext ".jpeg" ".jpg"

先用 --dry-run 预览，确认无误后再正式执行。
"""

import argparse
from pathlib import Path


def build_new_name(path: Path, index: int, args) -> str:
    name = path.stem
    suffix = path.suffix

    if args.replace:
        old, new = args.replace
        name = name.replace(old, new)

    if args.pattern:
        name = args.pattern.format(index)
        suffix = "" if "." in args.pattern else suffix

    if args.prefix:
        name = args.prefix + name

    if args.suffix:
        name = name + args.suffix

    if args.ext:
        suffix = args.ext[1]

    return name + suffix


def main():
    parser = argparse.ArgumentParser(description="批量重命名文件")
    parser.add_argument("directory", help="目标目录")
    parser.add_argument("--pattern", help="命名模板，如 photo_{:03d}（{...} 为序号）")
    parser.add_argument("--prefix", help="添加前缀")
    parser.add_argument("--suffix", help="添加后缀（扩展名之前）")
    parser.add_argument("--replace", nargs=2, metavar=("OLD", "NEW"), help="替换文件名中的字符串")
    parser.add_argument("--ext", nargs=2, metavar=("OLD", "NEW"), help="修改扩展名（仅处理匹配 OLD 的文件）")
    parser.add_argument("--filter", help="只处理文件名包含该字符串的文件")
    parser.add_argument("--dry-run", action="store_true", help="预览模式，不实际重命名")
    args = parser.parse_args()

    directory = Path(args.directory)
    if not directory.is_dir():
        print(f"错误：{directory} 不是有效目录")
        return

    files = sorted(p for p in directory.iterdir() if p.is_file())

    if args.ext:
        files = [p for p in files if p.suffix.lower() == args.ext[0].lower()]
    if args.filter:
        files = [p for p in files if args.filter in p.name]

    if not files:
        print("没有符合条件的文件")
        return

    for index, old_path in enumerate(files, start=1):
        new_name = build_new_name(old_path, index, args)
        new_path = old_path.with_name(new_name)

        if new_path == old_path:
            continue
        if new_path.exists():
            print(f"跳过：{new_name} 已存在")
            continue

        prefix = "[预览]" if args.dry_run else "[完成]"
        print(f"{prefix} {old_path.name} -> {new_name}")
        if not args.dry_run:
            old_path.rename(new_path)

    print(f"\n共处理 {len(files)} 个文件" + ("（预览模式）" if args.dry_run else ""))


if __name__ == "__main__":
    main()
