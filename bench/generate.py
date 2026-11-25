"""Render synthetic receipt images with ground-truth JSON.

Every vendor, item and amount is made up. Fixed seed, so the set is reproducible.

    python bench/generate.py            # dev set: 72 receipts into data/dev/ (rules were tuned on this one)
    python bench/generate.py holdout    # held-out set: 60 receipts, other seed, into data/holdout/ (never tuned on)
"""
from __future__ import annotations

import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SETS = {"dev": (72, 20261125), "holdout": (60, 777001)}

FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/truetype/liberation")]
FONT_NAMES = ["consola.ttf", "cour.ttf", "lucon.ttf", "arial.ttf", "verdana.ttf", "tahoma.ttf", "times.ttf", "calibri.ttf",
              "DejaVuSansMono.ttf", "DejaVuSans.ttf", "LiberationMono-Regular.ttf", "LiberationSans-Regular.ttf"]

CATEGORIES = {
    "Meals": {
        "vendors": ["Maple Lantern Diner", "Copper Kettle Cafe", "Bluefin Noodle Bar", "Sunny Fork Grill", "Little Basil Bistro"],
        "items": [("Breakfast Platter", 8, 14), ("Club Sandwich", 9, 13), ("Iced Coffee", 3, 6), ("Soup of the Day", 5, 8),
                  ("Cheeseburger", 10, 15), ("Garden Salad", 7, 11), ("Pancake Stack", 7, 10), ("Lemonade", 2, 4)],
    },
    "Fuel": {
        "vendors": ["Quickfill Fuel Stop", "Ridgeway Gas & Go", "Pinecrest Petroleum", "Rapid Pump Station"],
        "items": [("Unleaded Regular", 30, 70), ("Diesel", 45, 110), ("Premium Unleaded", 35, 80), ("Car Wash Basic", 8, 12)],
    },
    "Office Supplies": {
        "vendors": ["Paperwise Supply Co", "Inkline Office Depot", "Staplehouse Stationers", "Deskworks Outlet"],
        "items": [("Copy Paper 10 Ream", 38, 55), ("Ballpoint Pens 12pk", 4, 9), ("Toner Cartridge", 45, 90), ("File Folders 50ct", 9, 16),
                  ("Sticky Notes", 3, 7), ("Binder 2in", 5, 9), ("Stapler", 8, 15)],
    },
    "Travel": {
        "vendors": ["Bluepine Airport Shuttle", "Metro Line Rideshare", "Skybridge Parking", "Railway Express Tickets"],
        "items": [("Airport Transfer", 25, 60), ("Parking 1 Day", 12, 30), ("Train Ticket", 18, 75), ("Toll Fee", 3, 9), ("Ride Fare", 14, 40)],
    },
    "Lodging": {
        "vendors": ["Harborview Inn", "Cedar Ridge Lodge", "Lakeside Suites", "Old Mill Motel"],
        "items": [("Room Night Queen", 89, 169), ("Room Night King", 109, 199), ("Resort Fee", 15, 30), ("Late Checkout", 20, 40)],
    },
    "Utilities": {
        "vendors": ["Northgrid Power Co", "Clearwater Utility District", "Brightwave Internet", "Valley Gas Service"],
        "items": [("Electric Service", 60, 180), ("Water Service", 25, 70), ("Internet Monthly Plan", 45, 90), ("Natural Gas Service", 30, 120),
                  ("Service Fee", 4, 10)],
    },
}

TOTAL_LABELS = ["TOTAL", "Total", "GRAND TOTAL", "Amount Due", "TOTAL DUE", "Balance Due"]
TAX_LABELS = ["Tax", "TAX", "Sales Tax", "VAT", "GST", "Tax 7%"]
SUB_LABELS = ["Subtotal", "SUBTOTAL", "Sub Total", "Net"]
STREETS = ["Elm St", "Harbor Rd", "Oak Ave", "Mill Ln", "Pine Way", "Center Blvd"]
TOWNS = ["Fairview", "Brookfield", "Lakemont", "Riverton", "Ashford"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_date(d: date, style: int) -> str:
    return [
        f"{d.month:02d}/{d.day:02d}/{d.year}",
        d.isoformat(),
        f"{MONTHS[d.month - 1]} {d.day:02d}, {d.year}",
        f"{d.day:02d}-{MONTHS[d.month - 1]}-{d.year}",
        f"{d.month}/{d.day}/{d.year % 100:02d}",
    ][style]


def load_fonts() -> list[Path]:
    found = [d / n for n in FONT_NAMES for d in FONT_DIRS if (d / n).exists()]
    if not found:
        sys.exit("no TrueType fonts found")
    return found


def money(x: float) -> str:
    return f"{x:,.2f}"


def build(i: int, rng: random.Random, fonts: list[Path]) -> tuple[Image.Image, dict]:
    category = rng.choice(list(CATEGORIES))
    spec = CATEGORIES[category]
    vendor = rng.choice(spec["vendors"])
    d = date(2025, 1, 1) + timedelta(days=rng.randrange(700))
    items = []
    for _ in range(rng.randint(1, 5)):
        name, lo, hi = rng.choice(spec["items"])
        qty = rng.choice([1, 1, 1, 2, 3])
        items.append((name, qty, round(rng.uniform(lo, hi), 2)))
    subtotal = round(sum(q * p for _, q, p in items), 2)
    rate = rng.choice([0.0, 0.05, 0.06, 0.07, 0.0825, 0.1])
    tax = round(subtotal * rate, 2)
    total = round(subtotal + tax, 2)

    font_path = rng.choice(fonts)
    size = rng.randint(20, 26)
    font = ImageFont.truetype(str(font_path), size)
    big = ImageFont.truetype(str(font_path), size + rng.randint(4, 10))
    width = rng.randint(520, 640)
    margin = 28
    lh = int(size * 1.45)
    centered = rng.random() < 0.6

    lines: list[tuple[str, str, ImageFont.FreeTypeFont, str]] = []  # (left, right, font, align)
    lines.append((vendor.upper() if rng.random() < 0.5 else vendor, "", big, "c" if centered else "l"))
    lines.append((f"{rng.randint(10, 9999)} {rng.choice(STREETS)}", "", font, "c" if centered else "l"))
    lines.append((f"{rng.choice(TOWNS)}, ST {rng.randint(10000, 99999)}", "", font, "c" if centered else "l"))
    lines.append(("", "", font, "l"))
    dstr = fmt_date(d, rng.randrange(5))
    t = f"{rng.randint(6, 22):02d}:{rng.randint(0, 59):02d}"
    if rng.random() < 0.5:
        lines.append((f"Date: {dstr}", t, font, "l"))
    else:
        lines.append((f"{dstr} {t}", "", font, "l"))
    lines.append((f"Receipt #{rng.randint(1000, 999999)}", "", font, "l"))
    lines.append(("-" * 60, "", font, "l"))
    for name, qty, price in items:
        label = f"{qty} x {name}" if qty > 1 else name
        lines.append((label, money(qty * price), font, "l"))
    lines.append(("-" * 60, "", font, "l"))
    lines.append((rng.choice(SUB_LABELS), money(subtotal), font, "l"))
    tax_label = rng.choice(TAX_LABELS)
    lines.append((tax_label, money(tax), font, "l"))
    lines.append((rng.choice(TOTAL_LABELS), ("$" if rng.random() < 0.5 else "") + money(total), big, "l"))
    if rng.random() < 0.5:
        tendered = float(int(total) + rng.choice([1, 5, 10, 20]))
        lines.append(("Cash", money(tendered), font, "l"))
        lines.append(("Change", money(tendered - total), font, "l"))
    else:
        lines.append((f"VISA ****{rng.randint(1000, 9999)}", money(total), font, "l"))
    lines.append(("", "", font, "l"))
    lines.append((rng.choice(["Thank you!", "Thanks for visiting", "Please come again"]), "", font, "c"))

    height = margin * 2 + sum(int(f.size * 1.45) for _, _, f, _ in lines)
    paper = rng.randint(235, 255)
    img = Image.new("L", (width, height), paper)
    draw = ImageDraw.Draw(img)
    y = margin
    ink = rng.randint(0, 60)
    for left, right, f, align in lines:
        if left.startswith("-----"):
            draw.line([(margin, y + lh // 2), (width - margin, y + lh // 2)], fill=ink, width=1)
        elif align == "c":
            w = draw.textlength(left, font=f)
            draw.text(((width - w) / 2, y), left, font=f, fill=ink)
        else:
            draw.text((margin, y), left, font=f, fill=ink)
        if right:
            w = draw.textlength(right, font=f)
            draw.text((width - margin - w, y), right, font=f, fill=ink)
        y += int(f.size * 1.45)

    # scan noise: slight rotation, blur, speckle
    angle = rng.uniform(-2.5, 2.5)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=paper)
    if rng.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.9)))
    px = img.load()
    for _ in range(int(img.width * img.height * rng.uniform(0.001, 0.004))):
        x, yy = rng.randrange(img.width), rng.randrange(img.height)
        px[x, yy] = rng.randint(80, 200)

    truth = {
        "file": f"r{i:03d}.jpg",
        "vendor": vendor,
        "date": d.isoformat(),
        "total": total,
        "tax": tax,
        "category": category,
        "meta": {"font": font_path.name, "angle": round(angle, 2), "date_text": dstr, "tax_label": tax_label},
    }
    return img, truth


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "dev"
    n, seed = SETS[name]
    out = ROOT / "data" / name
    rng = random.Random(seed)
    fonts = load_fonts()
    (out / "receipts").mkdir(parents=True, exist_ok=True)
    truths = []
    for i in range(1, n + 1):
        img, truth = build(i, rng, fonts)
        img.convert("RGB").save(out / "receipts" / truth["file"], quality=82)
        truths.append(truth)
    (out / "truth.json").write_text(json.dumps(truths, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(truths)} receipts to {out}")


if __name__ == "__main__":
    main()
