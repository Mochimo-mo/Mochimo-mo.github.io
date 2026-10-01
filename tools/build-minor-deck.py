"""Build LUNA's original, lightweight cat-themed Minor Arcana SVGs and card data."""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(__file__).with_name("minor-deck.txt")
ART = ROOT / "assets" / "cards" / "minor"

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


def celestial(suit, rank, seed):
    rng = random.Random(seed)
    items = ['<g fill="#f6dfac">']
    for _ in range(66):
        x, y = rng.randint(70, 1130), rng.randint(85, 850)
        r = rng.choice([1, 2, 2, 3, 4])
        opacity = rng.choice([".28", ".4", ".55", ".75"])
        items.append(f'<circle cx="{x}" cy="{y}" r="{r}" opacity="{opacity}"/>')
    items.append("</g>")
    if suit == "wands":
        items.append('<circle cx="914" cy="366" r="170" fill="url(#halo)" opacity=".78"/>')
        items.append('<circle cx="914" cy="366" r="87" fill="#ffcf86" opacity=".7"/>')
    elif suit == "cups":
        items.append('<circle cx="920" cy="305" r="112" fill="#e6e6d3" opacity=".8"/>')
        items.append('<circle cx="968" cy="275" r="112" fill="#1d4c68"/>')
        items.append('<circle cx="920" cy="305" r="150" fill="none" stroke="#d5e1cb" opacity=".4" stroke-width="2"/>')
    elif suit == "swords":
        items.append('<circle cx="905" cy="300" r="156" fill="url(#halo)" opacity=".46"/>')
        for y in [365, 410, 462]:
            items.append(f'<path d="M0 {y} C330 {y-100} 670 {y+65} 1200 {y-30}" fill="none" stroke="#d9e5e5" stroke-width="5" opacity=".16"/>')
    else:
        items.append('<circle cx="930" cy="310" r="125" fill="#dfc879" opacity=".62"/>')
        items.append('<circle cx="930" cy="310" r="165" fill="none" stroke="#e5d8a1" opacity=".4" stroke-width="2"/>')
    # More scattered light around the top of the frame.
    for i in range(8):
        x, y = rng.randint(130, 1080), rng.randint(150, 710)
        items.append(f'<path d="M{x-11} {y}h22 M{x} {y-11}v22" stroke="#f6d99e" stroke-width="2" opacity=".68"/>')
    return "".join(items)


def landscape(suit, rank, pal):
    pieces = [
        '<path d="M0 965 Q245 870 405 933 T802 919 T1200 971 V1800 H0Z" fill="url(#land)"/>',
        '<path d="M0 1130 C210 1030 393 1110 583 1047 S950 1060 1200 994 V1800 H0Z" fill="#0b1b30" opacity=".46"/>',
        '<path d="M0 1435 Q300 1275 600 1448 T1200 1370 V1800 H0Z" fill="#081827" opacity=".62"/>'
    ]
    if suit == "cups":
        for y in [1190, 1300, 1430, 1560]:
            pieces.append(f'<path d="M-40 {y} Q145 {y-60} 318 {y} T690 {y} T1280 {y-20}" fill="none" stroke="#a7ded5" stroke-width="9" opacity=".21"/>')
        for x in [170, 985]:
            pieces.append(f'<path d="M{x-80} 1260 Q{x} 1180 {x+80} 1260 Q{x} 1320 {x-80} 1260" fill="#9ed8b1" opacity=".18"/>')
    if suit == "wands":
        for x in [85, 240, 1010, 1112]:
            pieces.append(f'<path d="M{x} 1640 Q{x+80} 1390 {x+10} 1270" fill="none" stroke="#d59b68" stroke-width="12" opacity=".28"/>')
            pieces.append(f'<path d="M{x+15} 1510q90 -65 120 -15q-80 40 -120 15 M{x+11} 1440q-85 -70 -115 -10q70 46 115 10" fill="#e1b972" opacity=".34"/>')
    if suit == "swords":
        pieces.append('<path d="M0 970 L230 730 363 960 600 660 826 990 1050 765 1200 940" fill="#8b9dab" opacity=".18"/>')
        pieces.append('<path d="M0 990 L230 730 363 960 600 660 826 990 1050 765 1200 940" fill="none" stroke="#e3e6d9" opacity=".22" stroke-width="4"/>')
    if suit == "pentacles":
        for x in [100, 1080]:
            pieces.append(f'<path d="M{x} 1600 C{x-20} 1240 {x+80} 1030 {x+40} 870" fill="none" stroke="#132d2e" stroke-width="55" opacity=".78"/>')
            for ox, oy in [(-90,950),(50,840),(120,1010),(-45,1120)]:
                pieces.append(f'<ellipse cx="{x+ox}" cy="{oy}" rx="108" ry="55" fill="#597d65" opacity=".34" transform="rotate(-22 {x+ox} {oy})"/>')
    return "".join(pieces)


def story_scene(suit, rank, pal):
    accent = pal["accent"]
    bits = []
    if rank == "ace":
        bits += ['<path d="M600 410 L600 1250" stroke="#f8dbad" opacity=".19" stroke-width="105"/>',
                 '<circle cx="600" cy="510" r="250" fill="none" stroke="#e9d39f" opacity=".45" stroke-width="4"/>',
                 '<circle cx="600" cy="510" r="218" fill="none" stroke="#e9d39f" opacity=".3" stroke-width="2"/>']
    elif rank == "2":
        bits += ['<path d="M600 1710 Q565 1280 185 1050 M600 1710 Q650 1230 1020 1030" fill="none" stroke="#e7c796" stroke-width="35" opacity=".24"/>',
                 '<path d="M350 1070V810Q350 700 450 700 M850 1070V810Q850 700 750 700" fill="none" stroke="#efd6a4" stroke-width="11" opacity=".35"/>']
    elif rank == "3":
        bits += ['<path d="M0 1030 Q300 970 600 1010 T1200 970" fill="none" stroke="#e8d2b0" stroke-width="3" opacity=".55"/>',
                 '<path d="M900 991l85 -104 90 108z" fill="#eed7ad" opacity=".42"/>',
                 '<path d="M985 885v145" stroke="#d7cfb0" stroke-width="8" opacity=".64"/>']
    elif rank == "4":
        bits += ['<path d="M220 1180V720Q600 340 980 720V1180" fill="none" stroke="#eed5a0" stroke-width="22" opacity=".42"/>',
                 '<path d="M260 1130Q600 690 940 1130" fill="none" stroke="#f8e0b5" stroke-width="5" opacity=".35"/>']
    elif rank == "5":
        bits += ['<path d="M100 620L330 760 490 630 650 780 895 580 1120 735" fill="none" stroke="#efc595" stroke-width="11" opacity=".18"/>',
                 '<path d="M0 510Q310 420 610 550T1200 440" fill="none" stroke="#d6c9bd" stroke-width="34" opacity=".14"/>']
        if suit == "pentacles":
            bits += ['<rect x="790" y="670" width="270" height="370" rx="130" fill="#f5cf8b" opacity=".2"/>',
                     '<path d="M925 670v370M790 860h270" stroke="#ebd69f" stroke-width="14" opacity=".43"/>']
    elif rank == "6":
        bits += ['<path d="M200 1220Q600 640 1000 1220" fill="none" stroke="#f2dda8" stroke-width="35" opacity=".3"/>',
                 '<path d="M240 1220Q600 710 960 1220" fill="none" stroke="#fff0c0" stroke-width="5" opacity=".45"/>']
    elif rank == "7":
        bits += ['<path d="M130 1300Q450 1080 760 1050T1100 800" fill="none" stroke="#eacb9b" stroke-width="32" opacity=".24"/>',
                 '<path d="M0 1640L1200 1120" stroke="#f4dfad" opacity=".12" stroke-width="150"/>']
    elif rank == "8":
        for i in range(7):
            y = 550 + i*75
            bits.append(f'<path d="M0 {y}Q350 {y-95} 1200 {y-150}" fill="none" stroke="{accent}" stroke-width="3" opacity=".18"/>')
        if suit == "pentacles":
            bits += ['<rect x="150" y="1280" width="900" height="100" rx="15" fill="#a8795e" opacity=".46"/>',
                     '<path d="M170 1280H1030" stroke="#f1ce9d" stroke-width="9" opacity=".48"/>']
    elif rank == "9":
        for i in range(5):
            x = 130 + i*230
            bits.append(f'<path d="M{x} 1300V870" stroke="#f6d89d" stroke-width="8" opacity=".28"/><circle cx="{x}" cy="850" r="34" fill="{accent}" opacity=".28"/>')
    elif rank == "10":
        bits += ['<path d="M0 1050L160 800 290 920 410 710 600 980 790 730 930 890 1070 710 1200 900V1210H0Z" fill="#e4cfab" opacity=".19"/>',
                 '<path d="M100 1140H1100V1060L600 750Z" fill="#efd3a3" opacity=".16"/>']
    elif rank == "page":
        bits += ['<path d="M120 1290Q600 1140 1080 1290V1420Q600 1280 120 1420Z" fill="#f6dbac" opacity=".25"/>',
                 '<path d="M600 1180V1400" stroke="#fff1c7" stroke-width="8" opacity=".36"/>']
    elif rank == "knight":
        bits += ['<path d="M-100 1360Q520 1020 1300 1120" fill="none" stroke="#f3d7a5" stroke-width="55" opacity=".18"/>',
                 '<path d="M-100 1420Q540 1090 1300 1200" fill="none" stroke="#faf2c4" stroke-width="4" opacity=".4"/>']
    else:
        bits += ['<path d="M210 1260V805Q600 520 990 805V1260" fill="none" stroke="#e9c68e" stroke-width="23" opacity=".4"/>',
                 '<path d="M225 1280H975" stroke="#f5dca9" stroke-width="18" opacity=".4"/>']
        if rank == "queen":
            bits.append('<path d="M310 810Q600 370 890 810" fill="none" stroke="#eae1b3" stroke-width="7" opacity=".5"/>')
        else:
            bits.append('<path d="M300 755L400 620 510 700 600 535 690 700 800 620 900 755Z" fill="#e8bc73" opacity=".32"/>')
    if suit == "swords" and rank == "3":
        bits.append('<path d="M600 500C400 255 215 530 600 850C985 530 800 255 600 500Z" fill="#d18f9f" opacity=".52" stroke="#f7cbb8" stroke-width="9"/>')
    if suit == "swords" and rank == "8":
        bits.append('<ellipse cx="600" cy="1070" rx="310" ry="190" fill="none" stroke="#d9e5e3" stroke-width="15" opacity=".36"/>')
    if suit == "cups" and rank == "5":
        bits.append('<path d="M210 1250Q600 1390 990 1250" fill="none" stroke="#b5d2cc" opacity=".42" stroke-width="10"/>')
    return "".join(bits)


def emblem(suit, x, y, scale=1, rotation=0, opacity=1):
    if suit == "wands":
        mark = '''<path d="M0 105Q-16 -50 0 -138" fill="none" stroke="#f6d5a0" stroke-width="25" stroke-linecap="round"/>
          <path d="M0 95Q-16 -50 0 -138" fill="none" stroke="#9e5d46" stroke-width="15" stroke-linecap="round"/>
          <path d="M-6 -70Q-83 -100 -87 -35Q-34 -28 -6 -70 M5 -12Q83 -60 88 -2Q38 18 5 -12" fill="#8aa777" stroke="#d9bc81" stroke-width="4"/>
          <path d="M0 -151Q-55 -192 0 -226Q55 -192 0 -151Z" fill="#ffd683" stroke="#fff0b5" stroke-width="6"/>'''
    elif suit == "cups":
        mark = '''<path d="M-88 -120Q-97 12 0 23Q97 12 88 -120Z" fill="url(#metal)" stroke="#fae3b1" stroke-width="8"/>
          <ellipse cx="0" cy="-120" rx="89" ry="20" fill="#a9dcdb" stroke="#f7e5b7" stroke-width="8"/>
          <path d="M0 23V106 M-52 108H52" stroke="#f4d9a0" stroke-width="20" stroke-linecap="round"/>
          <path d="M-89 -96Q-137 -94 -121 -30Q-105 0 -69 -8 M89 -96Q137 -94 121 -30Q105 0 69 -8" fill="none" stroke="#edd7ae" stroke-width="8"/>'''
    elif suit == "swords":
        mark = '''<path d="M0 -232L31 -175L20 56H-20L-31 -175Z" fill="url(#blade)" stroke="#f2e4c4" stroke-width="6"/>
          <path d="M-90 59Q0 86 90 59" fill="none" stroke="#d5b67e" stroke-width="24" stroke-linecap="round"/>
          <path d="M0 72V145" stroke="#bb916e" stroke-width="24"/><circle cx="0" cy="150" r="20" fill="#f1d9a0"/>'''
    else:
        pts = " ".join(f"{math.cos(-math.pi/2 + i*4*math.pi/5)*72:.1f},{math.sin(-math.pi/2 + i*4*math.pi/5)*72:.1f}" for i in range(5))
        mark = f'''<circle r="108" fill="url(#metal)" stroke="#ffebb5" stroke-width="11"/>
          <circle r="88" fill="none" stroke="#786744" stroke-width="5" opacity=".6"/>
          <polygon points="{pts}" fill="none" stroke="#fff2c0" stroke-width="11" stroke-linejoin="round"/>'''
    return f'<g transform="translate({x} {y}) rotate({rotation}) scale({scale})" opacity="{opacity}">{mark}</g>'


def emblem_positions(rank, suit):
    number = RANKS[rank][3]
    if rank == "ace":
        return [(600, 500, 1.2, 0)]
    if number:
        if number <= 4:
            layouts = {
                2: [(345, 610), (855, 610)],
                3: [(280, 620), (600, 380), (920, 620)],
                4: [(300, 480), (900, 480), (300, 1040), (900, 1040)],
            }
            pts = layouts.get(number, [])
        else:
            # A halo of objects leaves the center clear for the cat.
            pts = []
            for j in range(number):
                angle = math.pi * (1.12 + 1.76 * j / max(1, number-1))
                x = 600 + 426 * math.cos(angle)
                y = 850 + 460 * math.sin(angle)
                pts.append((round(x), round(y)))
        scale = .45 if number >= 8 else .55 if number >= 5 else .75
        return [(x, y, scale, (-8 if i%2 else 8) if suit=="wands" else 0) for i,(x,y) in enumerate(pts)]
    return [(840, 530, .92, 0)]


def cat(x, y, scale, fur, mood, pose="sit", crown=False, scarf=False, mirror=False):
    light, mid, dark = fur
    eye = "#e9c273" if mood != "sad" else "#b5c3c2"
    eyes = (
        '<path d="M-77 -66q31 -25 56 0 M21 -66q31 -25 56 0" fill="none" stroke="#373a42" stroke-width="10" stroke-linecap="round"/>'
        if mood in {"sleep", "happy"} else
        f'<ellipse cx="-46" cy="-66" rx="20" ry="28" fill="{eye}"/><ellipse cx="46" cy="-66" rx="20" ry="28" fill="{eye}"/>'
        '<path d="M-46 -86v43 M46 -86v43" stroke="#1e2934" stroke-width="10" stroke-linecap="round"/>'
        '<circle cx="-53" cy="-76" r="6" fill="#fff4d4"/><circle cx="39" cy="-76" r="6" fill="#fff4d4"/>'
    )
    base = f'''<path d="M115 260Q330 315 240 75Q225 25 194 60Q276 211 115 186" fill="none" stroke="{dark}" stroke-width="73" stroke-linecap="round"/>
        <path d="M117 258Q288 287 224 84" fill="none" stroke="{light}" stroke-width="36" stroke-linecap="round" opacity=".8"/>
        <ellipse cx="0" cy="226" rx="159" ry="205" fill="url(#fur)" stroke="{dark}" stroke-width="10"/>
        <ellipse cx="2" cy="252" rx="106" ry="133" fill="{light}" opacity=".7"/>
        <ellipse cx="-94" cy="393" rx="64" ry="43" fill="{light}" stroke="{dark}" stroke-width="9"/>
        <ellipse cx="92" cy="393" rx="64" ry="43" fill="{light}" stroke="{dark}" stroke-width="9"/>
        <path d="M-152 -153L-128 -318Q-75 -301 -53 -235 Q0 -265 53 -235Q75 -301 128 -318L152 -153Q195 5 0 24Q-195 5 -152 -153Z" fill="url(#fur)" stroke="{dark}" stroke-width="10" stroke-linejoin="round"/>
        <path d="M-121 -273Q-84 -269 -63 -225L-126 -191Z M121 -273Q84 -269 63 -225L126 -191Z" fill="#d99b98" opacity=".85"/>
        <path d="M-115 -166Q-65 -206 -9 -182 M115 -166Q65 -206 9 -182" fill="none" stroke="{dark}" stroke-width="13" opacity=".46"/>
        {eyes}
        <ellipse cx="-27" cy="-9" rx="49" ry="35" fill="#f6e5cf"/><ellipse cx="27" cy="-9" rx="49" ry="35" fill="#f6e5cf"/>
        <path d="M-18 -30Q0 -43 18 -30L0 -12Z" fill="#986e79"/>
        <path d="M0 -11v17m0 0q-21 17 -43 0m43 0q21 17 43 0" fill="none" stroke="{dark}" stroke-width="7" stroke-linecap="round"/>
        <path d="M-52 -14Q-140 -43 -180 -35 M-50 4Q-139 4 -179 24 M52 -14Q140 -43 180 -35 M50 4Q139 4 179 24" fill="none" stroke="#f2dec8" stroke-width="5" opacity=".8"/>
        <path d="M-140 103Q0 151 140 103" fill="none" stroke="#d7b77d" stroke-width="16"/>
        <circle cy="139" r="23" fill="#f5d186" stroke="#906b5a" stroke-width="5"/>
        <path d="M-95 141Q-135 171 -119 211 M95 141Q135 171 119 211" fill="none" stroke="{dark}" stroke-width="12" opacity=".3"/>'''
    if pose == "sleep":
        base = f'''<path d="M-165 191Q-370 125 -282 318Q-248 372 -165 293" fill="none" stroke="{dark}" stroke-width="85" stroke-linecap="round"/>
            <ellipse cx="18" cy="234" rx="265" ry="166" fill="url(#fur)" stroke="{dark}" stroke-width="11"/>
            <ellipse cx="-90" cy="160" rx="145" ry="120" fill="{light}" stroke="{dark}" stroke-width="9"/>
            <path d="M-207 69l-3 -151 104 78 85 -92 31 156Q-45 172 -207 69Z" fill="{light}" stroke="{dark}" stroke-width="9"/>
            <path d="M-180 15q27 -22 52 0 M-68 24q27 -22 52 0" fill="none" stroke="{dark}" stroke-width="9"/>
            <path d="M-104 54l20 7-12 12Z" fill="#ab8588"/>
            <ellipse cx="141" cy="350" rx="115" ry="55" fill="{light}" stroke="{dark}" stroke-width="9"/>'''
    elif pose == "walk":
        base = f'''<path d="M-180 195Q-395 45 -316 -56" fill="none" stroke="{dark}" stroke-width="60" stroke-linecap="round"/>
            <ellipse cx="-40" cy="166" rx="235" ry="125" fill="url(#fur)" stroke="{dark}" stroke-width="9"/>
            <path d="M-207 248l-34 148m117 -135 -10 132m164 -116 31 119m75 -147 66 145" stroke="{light}" stroke-width="61" stroke-linecap="round"/>
            <path d="M65 41l-16 -160 95 73 78 -104 37 163Q195 126 65 41Z" fill="{light}" stroke="{dark}" stroke-width="10"/>
            <ellipse cx="120" cy="24" rx="19" ry="25" fill="{eye}"/><ellipse cx="203" cy="24" rx="19" ry="25" fill="{eye}"/>
            <path d="M120 6v36 M203 6v36" stroke="#1e2934" stroke-width="10"/>
            <path d="M151 73l20 -4 -12 17Z" fill="#a07781"/>
            <path d="M84 91Q0 65 -46 81 M224 91q60 -20 94 -5" stroke="#f5debd" stroke-width="5"/>
            <path d="M52 122Q168 156 251 103" fill="none" stroke="#d7b77d" stroke-width="14"/>'''
    if crown:
        base += '<path d="M-98 -273L-112 -348 -53 -305 0 -390 53 -305 112 -348 98 -273Z" fill="url(#metal)" stroke="#ffe2a8" stroke-width="9"/><circle cy="-318" r="12" fill="#f2d39c"/>'
    if scarf:
        base += '<path d="M-114 115Q0 155 116 105L99 157Q-12 197 -117 155Z" fill="#ba7e77" stroke="#f2c09a" stroke-width="7"/><path d="M83 144l105 160 -45 17 -91 -148" fill="#ba7e77" stroke="#f2c09a" stroke-width="6"/>'
    transform = f"translate({x} {y}) scale({-scale if mirror else scale} {scale})"
    return f'<g transform="{transform}">{base}</g>'


def companions(suit, rank, fur):
    if (suit, rank) not in {("cups","2"),("cups","3"),("cups","10"),
                            ("wands","4"),("pentacles","6"),("pentacles","10")}:
        return ""
    if rank in {"3","10"}:
        return (cat(260, 1130, .42, FUR[1], "happy", mirror=True)
                + cat(940, 1130, .42, FUR[3], "happy"))
    return cat(860, 1120, .52, FUR[2], "happy", mirror=True)


def special_motifs(suit, rank, pal):
    if (suit, rank) == ("wands", "10"):
        return '<path d="M345 1145L795 810M390 1190L850 895M370 1105L770 765" stroke="#d9ad73" stroke-width="26" stroke-linecap="round" opacity=".78"/>'
    if (suit, rank) == ("cups", "8"):
        return '<path d="M340 1470Q740 1290 1000 1060" fill="none" stroke="#f6dfa8" stroke-width="35" opacity=".32"/>'
    if (suit, rank) == ("swords", "10"):
        return '<path d="M0 1020Q600 680 1200 1020" fill="none" stroke="#f8d5a3" stroke-width="17" opacity=".75"/><circle cx="600" cy="945" r="108" fill="#f4c993" opacity=".5"/>'
    if (suit, rank) == ("pentacles", "3"):
        return '<path d="M150 1390H1050M240 1420v140m720 -140v140" stroke="#debd87" stroke-width="32" opacity=".55"/>'
    return ""


def make_svg(card):
    suit, rank = card["id"].split("-")
    pal = SUITS[suit]
    order = list(RANKS).index(rank)
    fur = FUR[(order + list(SUITS).index(suit)*2) % len(FUR)]
    mood = "sad" if (suit,rank) in {("cups","5"),("swords","3"),("swords","9"),("pentacles","5")} else (
        "happy" if rank in {"4","6","9","10"} and suit != "swords" else "alert")
    pose = "sleep" if (suit,rank) in {("swords","4"),("swords","9"),("cups","4")} else (
        "walk" if rank in {"3","7","8","knight"} else "sit")
    x = 450 if rank in {"2","3","6"} else 580 if rank == "ace" else 600
    y = 1075 if pose == "sleep" else 1025
    scale = .9 if pose == "walk" else .88
    if rank in {"queen","king"}:
        scale = .98
    seed = sum((i+1)*ord(ch) for i,ch in enumerate(card["id"]))
    motifs = [emblem(suit, *p, opacity=.96 if rank=="ace" else .78) for p in emblem_positions(rank,suit)]
    # The central cat remains visible among the numbered suit objects.
    body = cat(x,y,scale,fur,mood,pose,crown=rank in {"queen","king"},
               scarf=rank in {"page","knight"},mirror=rank in {"3","7"})
    if (suit,rank) == ("swords","8"):
        body += '<path d="M335 1110Q600 860 865 1110M330 1210Q600 970 870 1210" fill="none" stroke="#d9d6ce" opacity=".54" stroke-width="18"/>'
    decorative = "".join(motifs) + companions(suit,rank,fur)
    if rank == "ace":
        decorative = "".join(motifs) + body
    else:
        decorative = "".join(motifs[:max(1,len(motifs)//2)]) + body + "".join(motifs[max(1,len(motifs)//2):]) + companions(suit,rank,fur)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
      <defs>
        <linearGradient id="sky" x2="0" y2="1"><stop stop-color="{pal["sky"][0]}"/><stop offset=".57" stop-color="{pal["sky"][1]}"/><stop offset="1" stop-color="{pal["sky"][2]}"/></linearGradient>
        <linearGradient id="land" x2=".7" y2="1"><stop stop-color="{pal["land"][0]}"/><stop offset="1" stop-color="{pal["land"][1]}"/></linearGradient>
        <radialGradient id="halo"><stop stop-color="{pal["soft"]}" stop-opacity=".88"/><stop offset="1" stop-color="{pal["soft"]}" stop-opacity="0"/></radialGradient>
        <linearGradient id="fur" x2=".8" y2="1"><stop stop-color="{fur[0]}"/><stop offset=".68" stop-color="{fur[1]}"/><stop offset="1" stop-color="{fur[2]}"/></linearGradient>
        <linearGradient id="metal" x2="1" y2="1"><stop stop-color="#fff0ba"/><stop offset=".46" stop-color="#ad8157"/><stop offset="1" stop-color="#f4d79b"/></linearGradient>
        <linearGradient id="blade" x2="1" y2="0"><stop stop-color="#fff5d5"/><stop offset=".48" stop-color="#9caec2"/><stop offset="1" stop-color="#ecf4ed"/></linearGradient>
      </defs>
      <rect width="1200" height="1800" fill="#0a1322"/>
      <rect x="24" y="24" width="1152" height="1752" rx="35" fill="url(#sky)"/>
      {celestial(suit,rank,seed)}
      {landscape(suit,rank,pal)}
      {story_scene(suit,rank,pal)}
      {decorative}
      {special_motifs(suit,rank,pal)}
      <rect x="42" y="42" width="1116" height="1716" rx="24" fill="none" stroke="#d9b875" stroke-width="9" opacity=".86"/>
      <rect x="63" y="63" width="1074" height="1674" rx="16" fill="none" stroke="#f6e2ac" stroke-width="2" opacity=".58"/>
      <path d="M90 155V90h65 M1045 90h65v65 M90 1645v65h65 M1045 1710h65v-65" fill="none" stroke="#ffe5a9" stroke-width="9" opacity=".82"/>
      <circle cx="600" cy="85" r="8" fill="{pal["accent"]}"/><circle cx="600" cy="1715" r="8" fill="{pal["accent"]}"/>
    </svg>'''
    return svg


def main():
    cards, reversed_cards = load_cards()
    ART.mkdir(parents=True, exist_ok=True)
    for card in cards:
        (ART / f'{card["id"]}.svg').write_text(make_svg(card), encoding="utf-8")
    payload = "const MINOR_CARDS = Object.freeze(" + json.dumps(cards, ensure_ascii=False, separators=(",",":")) + ");\n"
    payload += "const MINOR_REVERSED = Object.freeze(" + json.dumps(reversed_cards, ensure_ascii=False, separators=(",",":")) + ");\n"
    (ROOT / "minor.js").write_text(payload, encoding="utf-8")
    print(f"Built {len(cards)} minor cards; {sum(p.stat().st_size for p in ART.glob('*.svg'))/1024:.1f} KiB SVG art")


if __name__ == "__main__":
    main()
