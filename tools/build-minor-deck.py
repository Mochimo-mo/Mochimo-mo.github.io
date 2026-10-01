"""Build LUNA's Minor Arcana card data from the editorial source."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(__file__).with_name("minor-deck.txt")

SUITS = {
    "wands": {"cn": "权杖", "en": "Wands", "mark": "✦",
              "sky": ("#111b38", "#533454", "#d18252"), "land": ("#694a53", "#1b2a3c"),
              "accent": "#f3b35f", "soft": "#f3d199"},
    "cups": {"cn": "圣杯", "en": "Cups", "mark": "◌",
             "sky": ("#0b2440", "#29617a", "#91a6a0"), "land": ("#367b89", "#143e5d"),
             "accent": "#9ddbcf", "soft": "#f5d9a3"},
    "swords": {"cn": "宝剑", "en": "Swords", "mark": "✧",
               "sky": ("#0a1934", "#36516b", "#a3a4a1"), "land": ("#587187", "#172b47"),
               "accent": "#d2e0e8", "soft": "#e7bd86"},
    "pentacles": {"cn": "星币", "en": "Pentacles", "mark": "✷",
                  "sky": ("#102d2c", "#416657", "#a1a46b"), "land": ("#63754f", "#19372e"),
                  "accent": "#e6c46d", "soft": "#dbdbaa"},
}
RANKS = {
    "ace": ("A", "王牌", "Ace", 1), "2": ("2", "二", "Two", 2),
    "3": ("3", "三", "Three", 3), "4": ("4", "四", "Four", 4),
    "5": ("5", "五", "Five", 5), "6": ("6", "六", "Six", 6),
    "7": ("7", "七", "Seven", 7), "8": ("8", "八", "Eight", 8),
    "9": ("9", "九", "Nine", 9), "10": ("10", "十", "Ten", 10),
    "page": ("P", "侍从", "Page", 0), "knight": ("N", "骑士", "Knight", 0),
    "queen": ("Q", "皇后", "Queen", 0), "king": ("K", "国王", "King", 0),
}
FUR = [
    ("#e5ad74", "#915b4f", "#5c3d43"),
    ("#c6d5d3", "#748990", "#49636c"),
    ("#edca9a", "#ae8d72", "#71575c"),
    ("#9e8990", "#554d6b", "#363850"),
    ("#ddd1b9", "#9b9a8e", "#626d69"),
]


def load_cards():
    cards = []
    reversed_cards = {}
    for line in SOURCE.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) != 9:
            raise ValueError(f"Expected nine fields: {line}")
        suit, rank, keys, meaning, question, reverse_keys, reverse_meaning, up, down = parts
        if suit not in SUITS or rank not in RANKS:
            raise ValueError(f"Unknown suit/rank: {suit}/{rank}")
        number, chinese, english, count = RANKS[rank]
        card_id = f"{suit}-{rank}"
        cards.append({
            "id": card_id, "n": number, "en": f"{english} of {SUITS[suit]['en']}",
            "cn": SUITS[suit]["cn"] + chinese, "keys": keys.split("、"),
            "meaning": meaning, "question": question, "symbol": SUITS[suit]["mark"],
            "decision": [int(up), int(down)]
        })
        reversed_cards[card_id] = {"keys": reverse_keys.split("、"), "meaning": reverse_meaning}
    assert len(cards) == 56 and len({c["id"] for c in cards}) == 56
    assert all(sum(c["id"].startswith(s + "-") for c in cards) == 14 for s in SUITS)
    return cards, reversed_cards



def main():
    cards, reversed_cards = load_cards()
    payload = "const MINOR_CARDS = Object.freeze(" + json.dumps(cards, ensure_ascii=False, separators=(",", ":")) + ");\n"
    payload += "const MINOR_REVERSED = Object.freeze(" + json.dumps(reversed_cards, ensure_ascii=False, separators=(",", ":")) + ");\n"
    (ROOT / "minor.js").write_text(payload, encoding="utf-8")
    print(f"Built {len(cards)} Minor Arcana card entries")


if __name__ == "__main__":
    main()
