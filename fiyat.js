// Task Bar Cube - Steam Pazari fiyat toplayici (GitHub Actions'ta 30 dk'da bir calisir, bkz. .github/workflows/fiyatlar.yml).
// Oyun fiyatlari Steam'e her oyuncu ayri ayri sormak yerine bu deponun fiyatlar.json dosyasindan okur (Steam oyunun istegine 429 veriyordu).
// Steam arama sayfasi sayfa basina 10 sonuc verir; sayfalar arasinda beklenir, 429'da bir sure beklenip tekrar denenir.
// Tur yarida kalirsa eski fiyatlar korunur (sadece yeni okunanlar guncellenir); tur tamamlanirsa ilani kalkan esyalar silinir.
const fs = require("fs");

const APPID = 5084200;
const ADRES = `https://steamcommunity.com/market/search/render/?appid=${APPID}&norender=1&currency=1&sort_column=name&sort_dir=asc&count=100&start=`;
const SAYFA_BEKLEME_MS = 4000;
const CEZA_BEKLEME_MS = 60000;
const MAKS_DENEME = 3;
const DOSYA = "fiyatlar.json";

const bekle = ms => new Promise(r => setTimeout(r, ms));

async function sayfaGetir(start) {
  for (let deneme = 1; deneme <= MAKS_DENEME; deneme++) {
    const cevap = await fetch(ADRES + start, { headers: { Accept: "application/json" } });
    if (cevap.status === 429) {
      console.log(`429 (start=${start}), ${CEZA_BEKLEME_MS / 1000} sn bekleniyor (deneme ${deneme})`);
      await bekle(CEZA_BEKLEME_MS);
      continue;
    }
    if (!cevap.ok) throw new Error(`HTTP ${cevap.status} (start=${start})`);
    const veri = await cevap.json();
    if (!veri || !veri.success || !Array.isArray(veri.results)) throw new Error(`gecersiz cevap (start=${start})`);
    return veri;
  }
  throw new Error(`429 devam ediyor (start=${start})`);
}

async function main() {
  let eski = {};
  try {
    const d = JSON.parse(fs.readFileSync(DOSYA, "utf8"));
    for (const e of d.esyalar || []) eski[e.ad] = e.fiyat;
  } catch { /* ilk calisma */ }

  const yeni = {};
  let start = 0, toplam = Infinity, tam = true;
  try {
    while (start < toplam && start < 2000) {
      const veri = await sayfaGetir(start);
      toplam = veri.total_count;
      for (const s of veri.results) {
        if (s && s.hash_name && s.sell_listings > 0 && s.sell_price_text) yeni[s.hash_name] = s.sell_price_text.trim();
      }
      if (veri.results.length === 0) break;
      start += veri.results.length;
      if (start < toplam) await bekle(SAYFA_BEKLEME_MS);
    }
  } catch (e) {
    tam = false;
    console.log("tur yarida kaldi: " + e.message);
  }

  const birlesik = tam ? yeni : Object.assign({}, eski, yeni);
  const esyalar = Object.keys(birlesik).sort().map(ad => ({ ad, fiyat: birlesik[ad] }));
  if (esyalar.length === 0) { console.log("fiyat yok - dosya degistirilmedi"); return; }
  const cikti = { guncelleme: new Date().toISOString(), tam, esyalar };
  fs.writeFileSync(DOSYA, JSON.stringify(cikti, null, 1) + "\n");
  console.log(`${esyalar.length} esya yazildi (tam tur: ${tam})`);
}

main().catch(e => { console.error(e); process.exit(1); });
