// Task Bar Cube - Steam Pazari fiyat toplayici (GitHub Actions'ta 30 dk'da bir calisir, bkz. .github/workflows/fiyatlar.yml).
// Oyun fiyatlari Steam'e her oyuncu ayri ayri sormak yerine bu deponun fiyatlar.json dosyasindan okur (Steam oyunun istegine 429 veriyordu).
//
// 1) Once Steam'in RESMI yayinci servisi: ISteamEconomy/GetMarketPrices (yayinci Web API anahtari, GitHub Secret STEAM_PUBLISHER_KEY).
//    Donus bicimi belgelenmedigi icin ham cevap ham_api.json'a yazilir (anahtar YAZILMAZ) ve icindeki ad + fiyat alanlari aranir.
// 2) Anahtar yoksa / sonuc cikmazsa herkese acik pazar aramasi (sayfa basina 10 sonuc, sayfalar arasi bekleme, 429'da tekrar).
// Hicbir fiyat alinamazsa eski fiyatlar.json oldugu gibi kalir.
const fs = require("fs");

const APPID = 5084200;
const ARAMA = `https://steamcommunity.com/market/search/render/?appid=${APPID}&norender=1&currency=1&sort_column=name&sort_dir=asc&count=100&start=`;
const SAYFA_BEKLEME_MS = 4000;
const CEZA_BEKLEME_MS = 60000;
const MAKS_DENEME = 3;
const DOSYA = "fiyatlar.json";

const bekle = ms => new Promise(r => setTimeout(r, ms));

// Sent cinsinden sayiyi "$0.04" bicimine cevirir.
const dolar = sent => "$" + (Number(sent) / 100).toFixed(2);

// Belgelenmemis cevapta ad/fiyat ciftlerini bul: ad alani (market_hash_name / hash_name / name) ve fiyat alani
// (sell_price_text / lowest_price metni ya da sent cinsinden sell_price / lowest_price_cents / price) olan her nesne.
function ciftleriBul(dugum, cikti) {
  if (Array.isArray(dugum)) { for (const x of dugum) ciftleriBul(x, cikti); return; }
  if (!dugum || typeof dugum !== "object") return;
  const ad = dugum.market_hash_name || dugum.hash_name || dugum.market_name || dugum.name;
  let fiyat = null;
  if (typeof dugum.sell_price_text === "string") fiyat = dugum.sell_price_text;
  else if (typeof dugum.lowest_price === "string") fiyat = dugum.lowest_price;
  else for (const k of ["sell_price", "lowest_price", "lowest_price_cents", "min_price", "price"])
    if (typeof dugum[k] === "number" && dugum[k] > 0) { fiyat = dolar(dugum[k]); break; }
  if (typeof ad === "string" && fiyat) cikti[ad] = fiyat.trim();
  for (const v of Object.values(dugum)) if (v && typeof v === "object") ciftleriBul(v, cikti);
}

async function resmiServis() {
  const anahtar = process.env.STEAM_PUBLISHER_KEY;
  if (!anahtar) { console.log("STEAM_PUBLISHER_KEY yok - resmi servis atlandi"); return {}; }
  try {
    const cevap = await fetch(`https://partner.steam-api.com/ISteamEconomy/GetMarketPrices/v1/?key=${encodeURIComponent(anahtar)}&appid=${APPID}`);
    const metin = await cevap.text();
    console.log(`GetMarketPrices HTTP ${cevap.status}, ${metin.length} karakter`);
    fs.writeFileSync("ham_api.json", metin.split(anahtar).join("***")); // teshis icin; anahtar asla yazilmaz
    if (!cevap.ok) return {};
    const cikti = {};
    ciftleriBul(JSON.parse(metin), cikti);
    console.log(`resmi servisten ${Object.keys(cikti).length} fiyat`);
    return cikti;
  } catch (e) {
    console.log("resmi servis hatasi: " + e.message);
    return {};
  }
}

async function sayfaGetir(start) {
  for (let deneme = 1; deneme <= MAKS_DENEME; deneme++) {
    const cevap = await fetch(ARAMA + start, { headers: { Accept: "application/json" } });
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

async function pazarAramasi() {
  const yeni = {};
  let start = 0, toplam = Infinity, tam = true;
  try {
    while (start < toplam && start < 2000) {
      const veri = await sayfaGetir(start);
      toplam = veri.total_count;
      for (const s of veri.results)
        if (s && s.hash_name && s.sell_listings > 0 && s.sell_price_text) yeni[s.hash_name] = s.sell_price_text.trim();
      if (veri.results.length === 0) break;
      start += veri.results.length;
      if (start < toplam) await bekle(SAYFA_BEKLEME_MS);
    }
  } catch (e) {
    tam = false;
    console.log("pazar aramasi yarida kaldi: " + e.message);
  }
  return { yeni, tam };
}

async function main() {
  let eski = {};
  try {
    const d = JSON.parse(fs.readFileSync(DOSYA, "utf8"));
    for (const e of d.esyalar || []) eski[e.ad] = e.fiyat;
  } catch { /* ilk calisma */ }

  let yeni = await resmiServis(), tam = Object.keys(yeni).length > 0, kaynak = "api";
  if (!tam) ({ yeni, tam } = await pazarAramasi(), kaynak = "arama");

  const birlesik = tam ? yeni : Object.assign({}, eski, yeni);
  const esyalar = Object.keys(birlesik).sort().map(ad => ({ ad, fiyat: birlesik[ad] }));
  if (esyalar.length === 0) { console.log("fiyat alinamadi - dosya degistirilmedi"); return; }
  fs.writeFileSync(DOSYA, JSON.stringify({ guncelleme: new Date().toISOString(), kaynak, tam, esyalar }, null, 1) + "\n");
  console.log(`${esyalar.length} esya yazildi (kaynak: ${kaynak}, tam: ${tam})`);
}

main().catch(e => { console.error(e); process.exit(1); });
