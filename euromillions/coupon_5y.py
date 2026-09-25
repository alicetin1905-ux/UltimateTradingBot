"""5 yıllık istatistiğe göre 6 kolonluk EuroMillions kuponu.

Kurallar (draws_5y.json'dan hesaplanır):
- Her kolonda 5 yılın en sık 15 sayısından 2, son çekilişin ±1-3
  komşularından 1, kalanlardan 2 sayı.
- Kolonlar en yaygın yapıda: 2-3 tek sayı, 2-3 küçük (1-25) sayı,
  toplam 5 yılın orta %50 aralığında, en az 2 sayı 32-50 arası
  (ikramiye paylaşma riskini düşürür).
- 6 kolonda 30 farklı sayı (tekrar yok), yıldızlar 5 yılın en sık
  6 yıldızından farklı ikililer.

Kullanım: python3 euromillions/coupon_5y.py
"""
import json
import random
from collections import Counter
from pathlib import Path

from analyze import MAIN_MAX, STAR_MAX, neighbours

HERE = Path(__file__).parent


def valid(line, lo, hi):
    odd = sum(x % 2 for x in line)
    low = sum(x <= 25 for x in line)
    return 2 <= odd <= 3 and 2 <= low <= 3 and lo <= sum(line) <= hi and sum(x >= 32 for x in line) >= 2


def main():
    draws = json.loads((HERE / "draws_5y.json").read_text())  # yeniden eskiye
    main_c = Counter(x for d in draws for x in d["main"])
    star_c = Counter(x for d in draws for x in d["stars"])
    sums = sorted(sum(d["main"]) for d in draws)
    lo, hi = sums[len(sums) // 4], sums[3 * len(sums) // 4]

    last = draws[0]
    hot = [v for v, _ in main_c.most_common(15)]
    near = sorted(neighbours(last["main"], MAIN_MAX) - set(hot))
    rest = [v for v in range(1, MAIN_MAX + 1) if v not in hot and v not in near and v not in last["main"]]
    top_stars = [v for v, _ in star_c.most_common(6)]

    print(f"Son çekiliş {last['date']}: {last['main']} + {last['stars']}")
    print(f"5 yılın en sık 15 sayısı: {sorted(hot)}")
    print(f"±1-3 komşular (sıcaklar hariç): {near}")
    print(f"En sık 6 yıldız: {sorted(top_stars)}")
    print(f"Hedef toplam aralığı: {lo}-{hi}\n")

    rng = random.Random(last["date"])
    for _ in range(100_000):
        h, n, r = rng.sample(hot, 12), rng.sample(near, 6), rng.sample(rest, 12)
        lines = [sorted(h[2 * i:2 * i + 2] + [n[i]] + r[2 * i:2 * i + 2]) for i in range(6)]
        if all(valid(line, lo, hi) for line in lines):
            break
    else:
        raise SystemExit("Uygun kupon bulunamadı")

    s = rng.sample(top_stars, 6)
    star_pairs = [sorted((s[i], s[(i + 1) % 6])) for i in range(6)]  # 6 farklı ikili
    print("KUPON")
    for i, (line, st) in enumerate(zip(lines, star_pairs), 1):
        print(f"  {i}. {' '.join(f'{x:2d}' for x in line)}  |  ★ {st[0]:2d} {st[1]:2d}   (toplam {sum(line)})")


if __name__ == "__main__":
    main()
