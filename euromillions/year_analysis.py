"""EuroMillions 2026 yıllık analiz.

Bir çekiliş dosyasındaki (varsayılan draws_2026.json) tüm çekilişleri inceler: sıcak/soğuk sayılar,
bekleyen (uzun süredir çıkmayan) sayılar, tek/çift, alt/üst, toplam,
ardışık sayılar, tekrarlar, ±1-3 komşu deseni ve eşit dağılım (ki-kare) testi.

Kullanım: python3 euromillions/year_analysis.py [draws_5y.json]
"""
import json
import random
import sys
from collections import Counter
from itertools import combinations
from pathlib import Path

from analyze import MAIN_MAX, STAR_MAX, baseline, hits

HERE = Path(__file__).parent


def chi_square(counts, n_values, total):
    exp = total / n_values
    return sum((counts.get(v, 0) - exp) ** 2 / exp for v in range(1, n_values + 1)), exp


def sim_chi_p(chi, k, n_values, n_draws, trials=5000, seed=7):
    """Rastgele çekilişlerde bu kadar büyük ki-kare görme olasılığı."""
    rng = random.Random(seed)
    worse = 0
    for _ in range(trials):
        c = Counter()
        for _ in range(n_draws):
            c.update(rng.sample(range(1, n_values + 1), k))
        if chi_square(c, n_values, n_draws * k)[0] >= chi:
            worse += 1
    return worse / trials


def pct(x):
    return f"{x:.0%}"


def main():
    fname = sys.argv[1] if len(sys.argv) > 1 else "draws_2026.json"
    draws = json.loads((HERE / fname).read_text())[::-1]  # eskiden yeniye
    n = len(draws)
    print(f"{n} çekiliş: {draws[0]['date']} -> {draws[-1]['date']}\n")

    main_c = Counter(x for d in draws for x in d["main"])
    star_c = Counter(x for d in draws for x in d["stars"])

    # Frekans
    chi, exp = chi_square(main_c, MAIN_MAX, n * 5)
    p = sim_chi_p(chi, 5, MAIN_MAX, n)
    ranked = sorted(range(1, MAIN_MAX + 1), key=lambda v: (-main_c[v], v))
    print(f"ANA SAYI FREKANSI (beklenen {exp:.1f} kez/sayı)")
    print("  En sık 10 :", ", ".join(f"{v}({main_c[v]})" for v in ranked[:10]))
    print("  En az 10  :", ", ".join(f"{v}({main_c[v]})" for v in ranked[-10:][::-1]))
    print(f"  Ki-kare {chi:.1f}, rastgelelikte bu kadar sapma olasılığı p≈{p:.2f}")

    s_chi, s_exp = chi_square(star_c, STAR_MAX, n * 2)
    s_p = sim_chi_p(s_chi, 2, STAR_MAX, n)
    s_ranked = sorted(range(1, STAR_MAX + 1), key=lambda v: (-star_c[v], v))
    print(f"\nYILDIZ FREKANSI (beklenen {s_exp:.1f} kez/yıldız)")
    print("  ", ", ".join(f"{v}({star_c[v]})" for v in s_ranked))
    print(f"  Ki-kare {s_chi:.1f}, p≈{s_p:.2f}")

    # Bekleyen sayılar
    last_seen = {}
    for i, d in enumerate(draws):
        for x in d["main"]:
            last_seen[x] = i
    gaps = {v: n - 1 - last_seen.get(v, -1) for v in range(1, MAIN_MAX + 1)}
    overdue = sorted(gaps, key=lambda v: -gaps[v])[:10]
    print("\nEN UZUN SÜREDİR ÇIKMAYAN (çekiliş sayısı)")
    print("  ", ", ".join(f"{v}({gaps[v]})" for v in overdue))

    # Yapısal özellikler
    odd = Counter(sum(x % 2 for x in d["main"]) for d in draws)
    low = Counter(sum(x <= 25 for x in d["main"]) for d in draws)
    sums = [sum(d["main"]) for d in draws]
    consec = sum(any(b - a == 1 for a, b in zip(sorted(d["main"]), sorted(d["main"])[1:])) for d in draws)
    decades = Counter((x - 1) // 10 for d in draws for x in d["main"])
    print("\nTEK SAYI ADEDİ (5 sayı içinde) -> çekiliş sayısı")
    print("  ", ", ".join(f"{k} tek: {odd[k]}" for k in range(6)))
    print("ALT (1-25) SAYI ADEDİ -> çekiliş sayısı")
    print("  ", ", ".join(f"{k} alt: {low[k]}" for k in range(6)))
    print(f"TOPLAM: ort {sum(sums) / n:.0f} (teorik 127.5), min {min(sums)}, max {max(sums)}, "
          f"%50'si {sorted(sums)[n // 4]}-{sorted(sums)[3 * n // 4]} arası")
    print(f"ARDIŞIK SAYI içeren çekiliş: {consec}/{n} ({pct(consec / n)}, teorik ≈%35)")
    print("ONLUK GRUPLAR:", ", ".join(f"{g * 10 + 1}-{g * 10 + 10}: {decades[g]}" for g in range(5)))

    # Tekrarlar ve ±1-3 deseni
    repeats = [len(set(a["main"]) & set(b["main"])) for a, b in zip(draws, draws[1:])]
    nb = [len(hits(a["main"], b["main"], MAIN_MAX)) for a, b in zip(draws, draws[1:])]
    exp_nb, exp_any = baseline(5, 5, MAIN_MAX)
    print(f"\nBİR ÖNCEKİ ÇEKİLİŞTEN TEKRAR: ort {sum(repeats) / len(repeats):.2f} (teorik 0.50), "
          f"en az 1 tekrar {pct(sum(r > 0 for r in repeats) / len(repeats))} (teorik %42)")
    print(f"±1-3 KOMŞU DESENİ (tüm dönem): ort {sum(nb) / len(nb):.2f} isabet (rastgele {exp_nb:.2f}), "
          f"en az 1 isabet {pct(sum(h > 0 for h in nb) / len(nb))} (rastgele {pct(exp_any)})")

    # Sık çıkan ikililer
    pairs = Counter(p for d in draws for p in combinations(sorted(d["main"]), 2))
    print("\nEN SIK BİRLİKTE ÇIKAN İKİLİLER:",
          ", ".join(f"{a}-{b}({c})" for (a, b), c in pairs.most_common(8)))
    sp = Counter(tuple(sorted(d["stars"])) for d in draws)
    print("EN SIK YILDIZ İKİLİLERİ:", ", ".join(f"{a}-{b}({c})" for (a, b), c in sp.most_common(5)))

    years = sorted({d["date"][-4:] for d in draws})
    if len(years) > 1:
        year_persistence(draws, years)


def year_persistence(draws, years):
    """Bir yılın en sık 10 sayısı ertesi yıl da sık çıkıyor mu?"""
    print("\nYILLARA GÖRE EN SIK 5 SAYI")
    tops = {}
    for y in years:
        yd = [d for d in draws if d["date"].endswith(y)]
        c = Counter(x for d in yd for x in d["main"])
        tops[y] = (c, len(yd))
        print(f"  {y} ({len(yd)} çekiliş):", ", ".join(f"{v}({k})" for v, k in c.most_common(5)))
    print("SICAK SAYILAR ERTESİ YIL (önceki yılın en sık 10'u, sonraki yıldaki ortalama çıkışı)")
    for a, b in zip(years, years[1:]):
        ca, _ = tops[a]
        cb, nb = tops[b]
        hot = [v for v, _ in ca.most_common(10)]
        print(f"  {a} sıcakları {b} içinde: ort {sum(cb[v] for v in hot) / 10:.1f} "
              f"(her sayı için beklenen {nb * 5 / MAIN_MAX:.1f})")


if __name__ == "__main__":
    main()
