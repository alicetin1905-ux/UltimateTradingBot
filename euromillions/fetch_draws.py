"""Çekiliş verisini pedro-mealha/euromillions-api üzerinden günceller.

API: https://euromillions.api.pedromealha.dev/v1/draws?year=YYYY
(https://github.com/pedro-mealha/euromillions-api, MIT lisanslı)

Mevcut draws_2026.json ve draws_5y.json dosyalarına yeni çekilişleri
ekler (mevcut kayıtlar korunur) ve API'deki büyük ikramiye bilgisini
jackpots.json'a yazar. API istek sınırı (429) için tekrar dener.

Kullanım: python3 euromillions/fetch_draws.py
"""
import datetime
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
API = "https://euromillions.api.pedromealha.dev/v1/draws?year={}"
YEARS_BACK = 5


def get_year(year, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(API.format(year), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == tries - 1:
                raise
            time.sleep(20 * (i + 1))


def to_local(d):
    y, m, dd = d["date"].split("-")
    return {"date": f"{dd}-{m}-{y}", "main": [int(x) for x in d["numbers"]],
            "stars": [int(x) for x in d["stars"]]}


def parse(date):
    return datetime.datetime.strptime(date, "%d-%m-%Y").date()


def merge(fname, new, since):
    path = HERE / fname
    rows = {o["date"]: o for o in json.loads(path.read_text())} if path.exists() else {}
    added = [o["date"] for o in new if o["date"] not in rows and parse(o["date"]) >= since]
    rows.update({o["date"]: o for o in new if parse(o["date"]) >= since})
    out = sorted((o for o in rows.values() if parse(o["date"]) >= since), key=lambda o: parse(o["date"]), reverse=True)
    path.write_text(json.dumps(out, indent=1))
    print(f"{fname}: {len(out)} çekiliş, {len(added)} yeni {added[:5]}")


def main():
    today = datetime.date.today()
    raw = []
    for year in range(today.year - YEARS_BACK, today.year + 1):
        raw += get_year(year)
        time.sleep(3)
    draws = [to_local(d) for d in raw]

    merge("draws_2026.json", draws, datetime.date(2026, 1, 1))
    since = today.replace(year=today.year - YEARS_BACK)
    merge("draws_5y.json", draws, since)

    jackpots = sorted(
        ({"date": to_local(d)["date"], "jackpot": next((p["prize"] for p in d["prizes"]
                                                        if p["matched_numbers"] == 5 and p["matched_stars"] == 2), None)}
         for d in raw if d.get("has_winner") and parse(to_local(d)["date"]) >= since),
        key=lambda o: parse(o["date"]), reverse=True)
    (HERE / "jackpots.json").write_text(json.dumps(jackpots, indent=1))
    print(f"jackpots.json: son {YEARS_BACK} yılda {len(jackpots)} büyük ikramiye kazanıldı")


if __name__ == "__main__":
    main()
