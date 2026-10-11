#!/usr/bin/env python3
"""人脸废图机检（环节 ⑤ 的出图门槛）。

判定的是「该有脸的地方变成了一块死寂的纯黑或纯白」：旧产线里生图模型
把提示词里的 stylized faces 读成「不用画五官」，于是封面人物脸要么全黑
剪影、要么一片空白。这里用像素统计把这类图挑出来。

用法:
    python check_art_faces.py <目录或图片> [<目录或图片> ...] [--json report.json]
退出码: 0 = 没有废图, 1 = 有废图

注意: 这是启发式检查，阈值需要拿你的真实废图集校准后再上产线。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("需要 Pillow：pip install pillow", file=sys.stderr)
    sys.exit(2)

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
NEAR_BLACK = 28
NEAR_WHITE = 236
FACE_BOX = (0.18, 0.08, 0.82, 0.62)
FLAT_RATIO_THRESHOLD = 0.90


def face_band_stats(path: Path) -> dict:
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        box = (
            int(w * FACE_BOX[0]),
            int(h * FACE_BOX[1]),
            int(w * FACE_BOX[2]),
            int(h * FACE_BOX[3]),
        )
        band = im.crop(box).resize((160, 160))
        raw = band.tobytes()  # RGB, 3 bytes per pixel

    total = len(raw) // 3
    black = 0
    white = 0
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        if r < NEAR_BLACK and g < NEAR_BLACK and b < NEAR_BLACK:
            black += 1
        elif r > NEAR_WHITE and g > NEAR_WHITE and b > NEAR_WHITE:
            white += 1
    return {
        "size": [w, h],
        "face_band_black_ratio": round(black / total, 4),
        "face_band_white_ratio": round(white / total, 4),
    }


def judge(stats: dict) -> str | None:
    black = stats["face_band_black_ratio"]
    white = stats["face_band_white_ratio"]
    if black >= FLAT_RATIO_THRESHOLD:
        return f"脸部区域 {black:.0%} 是纯黑，判为剪影废图"
    if white >= FLAT_RATIO_THRESHOLD:
        return f"脸部区域 {white:.0%} 是纯白，判为空白脸废图"
    return None


def collect(targets: list[str]) -> list[Path]:
    files: list[Path] = []
    for t in targets:
        p = Path(t)
        if p.is_dir():
            files.extend(sorted(f for f in p.rglob("*") if f.suffix.lower() in IMAGE_SUFFIXES))
        elif p.is_file():
            files.append(p)
        else:
            print(f"跳过不存在的路径: {p}", file=sys.stderr)
    return files


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="+")
    ap.add_argument("--json")
    args = ap.parse_args()

    files = collect(args.targets)
    bad: list[dict] = []
    checked = 0
    for f in files:
        try:
            stats = face_band_stats(f)
        except Exception as exc:  # noqa: BLE001
            bad.append({"file": str(f), "reason": f"读取失败: {exc}"})
            continue
        checked += 1
        reason = judge(stats)
        if reason:
            bad.append({"file": str(f), "reason": reason, **stats})

    report = {
        "checked": checked,
        "bad_count": len(bad),
        "result": "FAIL" if bad else "PASS",
        "thresholds": {
            "black_ratio": FLAT_RATIO_THRESHOLD,
            "white_ratio": FLAT_RATIO_THRESHOLD,
            "face_box": FACE_BOX,
        },
        "bad": bad,
    }
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{report['result']}  检查 {checked} 张，废图 {len(bad)} 张")
    for b in bad:
        print(f"  x {b['file']}  {b['reason']}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
