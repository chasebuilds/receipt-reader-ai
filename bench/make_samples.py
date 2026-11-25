"""Copy a few dev-set receipts into site/samples and render one with no category keyword, so the demo shows the model deciding."""
from __future__ import annotations

import json
import random
import shutil

import generate as g

def main() -> None:
    out = g.ROOT / "site" / "samples"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.jpg"):
        old.unlink()
    dev = {t["file"]: t for t in json.loads((g.ROOT / "data/dev/truth.json").read_text(encoding="utf-8"))}
    first: dict[str, str] = {}
    for t in dev.values():
        first.setdefault(t["category"], t["file"])
    samples = []
    for f in first.values():
        shutil.copy(g.ROOT / "data/dev/receipts" / f, out / f)
        samples.append({k: dev[f][k] for k in ("file", "vendor", "date", "total", "tax", "category")})
    # Off-vocabulary receipt: none of these words are in the keyword rules.
    g.CATEGORIES = {"Meals": {"vendors": ["Juniper Tavern"], "items": [("Espresso", 3, 5), ("Croissant", 3, 5), ("Tiramisu", 6, 9), ("Ravioli", 14, 19)]}}
    img, truth = g.build(99, random.Random(5), g.load_fonts())
    truth["file"] = "ai-category.jpg"
    img.convert("RGB").save(out / truth["file"], quality=82)
    samples.append({k: truth[k] for k in ("file", "vendor", "date", "total", "tax", "category")})
    (out / "index.json").write_text(json.dumps(samples, indent=1) + "\n", encoding="utf-8")
    print(f"{len(samples)} samples in {out}")


if __name__ == "__main__":
    main()
