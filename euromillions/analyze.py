"""EuroMillions "±1-3 komşu" analizi ve kupon üretici.

Hipotez: bir çekilişte çıkan sayıların 1-3 fazlası/eksiği bir sonraki
çekilişte çıkar. Script son 24 çekilişi (12 hafta, Salı+Cuma) inceler,
gözlemi rastgele çekilişlerle (Monte Carlo) karşılaştırır ve sonraki
çekiliş için 6 kolonluk kupon üretir.

Kullanım: python3 euromillions/analyze.py
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).parent
MAIN_MAX, STAR_MAX = 50, 12
DIFFS = (1, 2, 3)


def neighbours(nums, max_n):
    """Verilen sayılara 1-3 uzaklıktaki sayılar (sayıların kendisi hariç)."""
    out = set()
    for n in nums:
        for d in DIFFS:
            for c in (n - d, n + d):
                if 1 <= c <= max_n:
                    out.add(c)
    return out - set(nums)


def hits(prev, cur, max_n):
    return sorted(set(cur) & neighbours(prev, max_n))


def baseline(prev_k, cur_k, max_n, trials=200_000, seed=1):
    """Rastgele çekilişlerde ortalama isabet ve >=1 isabet olasılığı."""
    rng = random.Random(seed)
    total = at_least_one = 0
    for _ in range(trials):
        prev = rng.sample(range(1, max_n + 1), prev_k)
        cur = rng.sample(range(1, max_n + 1), cur_k)
        h = len(hits(prev, cur, max_n))
        total += h
        at_least_one += h > 0
    return total / trials, at_least_one / trials


def main():
    draws = json.loads((HERE / "draws.json").read_text())[::-1]  # eskiden yeniye
    print(f"{len(draws)} çekiliş: {draws[0]['date']} -> {draws[-1]['date']}\n")

    main_hits, star_hits = [], []
    print(f"{'Önceki':<11}{'Yeni':<11}{'Yeni sayılar':<22}{'±1-3 isabet':<16}Yıldız isabet")
    for prev, cur in zip(draws, draws[1:]):
        mh = hits(prev["main"], cur["main"], MAIN_MAX)
        sh = hits(prev["stars"], cur["stars"], STAR_MAX)
        main_hits.append(len(mh))
        star_hits.append(len(sh))
        print(f"{prev['date']:<11}{cur['date']:<11}{str(cur['main']):<22}{str(mh):<16}{sh}")

    n = len(main_hits)
    obs_avg = sum(main_hits) / n
    obs_any = sum(h > 0 for h in main_hits) / n
    exp_avg, exp_any = baseline(5, 5, MAIN_MAX)
    s_obs_avg = sum(star_hits) / n
    s_obs_any = sum(h > 0 for h in star_hits) / n
    s_exp_avg, s_exp_any = baseline(2, 2, STAR_MAX)

    print("\nANA SAYILAR")
    print(f"  Gözlenen: ortalama {obs_avg:.2f} isabet/çekiliş, en az 1 isabet {obs_any:.0%}")
    print(f"  Rastgele: ortalama {exp_avg:.2f} isabet/çekiliş, en az 1 isabet {exp_any:.0%}")
    print("YILDIZLAR")
    print(f"  Gözlenen: ortalama {s_obs_avg:.2f}, en az 1 isabet {s_obs_any:.0%}")
    print(f"  Rastgele: ortalama {s_exp_avg:.2f}, en az 1 isabet {s_exp_any:.0%}")

    # Kupon: son çekilişin ±1-3 komşularından ağırlıklı seçim.
    last = draws[-1]
    pool = sorted(neighbours(last["main"], MAIN_MAX))
    star_pool = sorted(neighbours(last["stars"], STAR_MAX))
    others = [x for x in range(1, MAIN_MAX + 1) if x not in pool and x not in last["main"]]
    from_pool = max(1, round(obs_avg)) + 1  # gözlenen ortalamanın biraz üstü
    print(f"\nSon çekiliş {last['date']}: {last['main']} + {last['stars']}")
    print(f"Ana havuz (±1-3): {pool}")
    print(f"Yıldız havuzu (±1-3): {star_pool}")
    print(f"\nKUPON (her kolonda {from_pool} sayı havuzdan, {5 - from_pool} dışarıdan):")

    rng = random.Random(last["date"])
    pool_cycle = rng.sample(pool, len(pool))  # her havuz sayısı en az bir kez kullanılsın
    lines = []
    for i in range(6):
        picks = set()
        while len(picks) < from_pool:
            picks.add(pool_cycle[(i * from_pool + len(picks)) % len(pool_cycle)])
        picks |= set(rng.sample(others, 5 - from_pool))
        stars = sorted(rng.sample(star_pool, 2))
        lines.append((sorted(picks), stars))
        print(f"  {i + 1}. {' '.join(f'{x:2d}' for x in sorted(picks))}  |  ★ {stars[0]:2d} {stars[1]:2d}")
    return lines


if __name__ == "__main__":
    main()
