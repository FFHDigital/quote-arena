import { db, get, run, tx } from "./db";
import { MOCK_SITES } from "../mock/sites";
import { REAL_COUNTRIES, REAL_INSURERS, type CountrySeed } from "./insurerData";
import type { Persona } from "./types";

const COUNTRIES: CountrySeed[] = [{ code: "ZZ", name: "Demo market", flag: "🧪", currency: "GBP", regulator_url: null }, ...REAL_COUNTRIES];

const PRODUCTS = [
  { id: "car", name: "Car", sort: 1 },
  { id: "home", name: "Home", sort: 2 },
  { id: "travel", name: "Travel", sort: 3 },
  { id: "health", name: "Health", sort: 4 },
  { id: "life", name: "Life", sort: 5 },
  { id: "business", name: "Business", sort: 6 },
];

const baseDriver = {
  title: "Mr",
  first_name: "Alex",
  last_name: "Tester",
  full_name: "Alex Tester",
  dob: "1990-04-12",
  email: "persona@example.com",
  occupation: "Software developer",
  marital_status: "Single",
  licence_years: "10",
  claims: "None",
  convictions: "No",
  make: "Ford",
  model: "Focus 1.0 EcoBoost",
  year: "2019",
  car_value: "12000",
  annual_mileage: "8000",
  modified: "No",
  overnight: "Driveway",
  cover: "Comprehensive",
  excess: "£250",
  payment: "Annually",
  best_time: "Morning",
};

const home = { property_type: "Semi-detached house", bedrooms: "3", year_built: "1985", rebuild_cost: "250000", contents_value: "40000" };

// Where a reserved fictional range exists it is used (Ofcom drama numbers, ACMA 0491 570, NANP 555-01xx).
// Elsewhere the phone is a zero-filled number in local format, which no real person can be reached on.
interface Market {
  city: string;
  postcode: string;
  phone: string;
  reg: string;
  licence: string;
  money: string;
  nationality: string;
}

const MARKETS: Record<string, Market> = {
  ZZ: { city: "London", postcode: "E1 6AN", phone: "07700 900123", reg: "AB19 CDE", licence: "Full UK", money: "£", nationality: "British" },
  GB: { city: "London", postcode: "E1 6AN", phone: "07700 900123", reg: "AB19 CDE", licence: "Full UK", money: "£", nationality: "British" },
  IE: { city: "Dublin", postcode: "D02 X285", phone: "087 000 0000", reg: "191-D-12345", licence: "Full Irish", money: "€", nationality: "Irish" },
  AU: { city: "Sydney", postcode: "2000", phone: "0491 570 006", reg: "ABC12D", licence: "Full Australian", money: "$", nationality: "Australian" },
  US: { city: "Columbus, OH", postcode: "43215", phone: "614-555-0123", reg: "ABC1234", licence: "Full US", money: "$", nationality: "American" },
  CA: { city: "Toronto, ON", postcode: "M5V 2T6", phone: "416-555-0123", reg: "ABCD 123", licence: "Full G licence", money: "$", nationality: "Canadian" },
  AR: { city: "Buenos Aires", postcode: "C1001", phone: "11 0000-0000", reg: "AB123CD", licence: "Licencia de conducir", money: "$", nationality: "Argentina" },
  CL: { city: "Santiago", postcode: "8320000", phone: "9 0000 0000", reg: "ABCD12", licence: "Clase B", money: "$", nationality: "Chilena" },
  KW: { city: "Kuwait City", postcode: "13001", phone: "5000 0000", reg: "12/34567", licence: "Kuwaiti licence", money: "KWD ", nationality: "Kuwaiti" },
  AE: { city: "Dubai", postcode: "00000", phone: "050 000 0000", reg: "A 12345", licence: "UAE licence", money: "AED ", nationality: "British" },
  BH: { city: "Manama", postcode: "317", phone: "3000 0000", reg: "123456", licence: "Bahraini licence", money: "BHD ", nationality: "British" },
  SA: { city: "Riyadh", postcode: "11564", phone: "050 000 0000", reg: "ABC 1234", licence: "Saudi licence", money: "SAR ", nationality: "British" },
  JO: { city: "Amman", postcode: "11118", phone: "079 000 0000", reg: "12-34567", licence: "Jordanian licence", money: "JOD ", nationality: "British" },
  HK: { city: "Hong Kong", postcode: "000000", phone: "5000 0000", reg: "AB 1234", licence: "Full HK", money: "HK$", nationality: "British" },
  ZA: { city: "Johannesburg", postcode: "2001", phone: "060 000 0000", reg: "AB 12 CD GP", licence: "Code B", money: "R", nationality: "South African" },
  MY: { city: "Kuala Lumpur", postcode: "50450", phone: "012-000 0000", reg: "WAB 1234", licence: "Competent Driving Licence", money: "RM", nationality: "Malaysian" },
  TH: { city: "Bangkok", postcode: "10330", phone: "080 000 0000", reg: "1กข 1234", licence: "Thai licence", money: "฿", nationality: "Thai" },
  CZ: { city: "Praha", postcode: "110 00", phone: "600 000 000", reg: "1AB 2345", licence: "Skupina B", money: "Kč ", nationality: "Česká" },
  CN: { city: "Shanghai", postcode: "200000", phone: "130 0000 0000", reg: "沪A12345", licence: "C1", money: "¥", nationality: "Chinese" },
  GR: { city: "Athens", postcode: "105 57", phone: "690 000 0000", reg: "ΙΚΧ 1234", licence: "Category B", money: "€", nationality: "Greek" },
  UA: { city: "Kyiv", postcode: "01001", phone: "050 000 0000", reg: "AA 1234 BB", licence: "Category B", money: "₴", nationality: "Ukrainian" },
  ID: { city: "Jakarta", postcode: "10110", phone: "0812 0000 0000", reg: "B 1234 ABC", licence: "SIM A", money: "Rp", nationality: "Indonesian" },
  BR: { city: "São Paulo", postcode: "01000-000", phone: "(11) 90000-0000", reg: "ABC1D23", licence: "Categoria B", money: "R$", nationality: "Brasileira" },
  LK: { city: "Colombo", postcode: "00100", phone: "070 000 0000", reg: "WP CAB-1234", licence: "Light vehicle", money: "Rs ", nationality: "Sri Lankan" },
  UY: { city: "Montevideo", postcode: "11000", phone: "090 000 000", reg: "SAB 1234", licence: "Categoría A", money: "$", nationality: "Uruguaya" },
  CO: { city: "Bogotá", postcode: "110111", phone: "300 000 0000", reg: "ABC123", licence: "B1", money: "$", nationality: "Colombiana" },
  IN: { city: "Mumbai", postcode: "400001", phone: "90000 00000", reg: "MH01AB1234", licence: "LMV", money: "₹", nationality: "Indian" },
  VN: { city: "Hanoi", postcode: "100000", phone: "090 000 0000", reg: "29A-123.45", licence: "B2", money: "₫", nationality: "Vietnamese" },
  FR: { city: "Paris", postcode: "75001", phone: "06 00 00 00 00", reg: "AB-123-CD", licence: "Permis B", money: "€", nationality: "Française" },
};

const PRODUCT_FIELDS: Record<string, { label: (city: string) => string; fields: Record<string, string> }> = {
  car: { label: (c) => `35-year-old, clean licence, 2019 Ford Focus, ${c}`, fields: {} },
  home: { label: (c) => `35-year-old owner of a 3-bed house, ${c}`, fields: home },
  travel: {
    label: (c) => `35-year-old, one-week single trip from ${c}`,
    fields: { destination: "Spain", trip_type: "Single trip", travellers: "1", departure_offset_days: "30", trip_length_days: "7", pre_existing_conditions: "No" },
  },
  health: { label: (c) => `35-year-old non-smoker, individual cover, ${c}`, fields: { smoker: "No", height_cm: "178", weight_kg: "75", pre_existing_conditions: "No", cover_for: "Just me" } },
  life: { label: (c) => `35-year-old non-smoker, 20-year term cover, ${c}`, fields: { smoker: "No", term_years: "20", cover_amount: "250000", height_cm: "178", weight_kg: "75" } },
  business: {
    label: (c) => `Small IT consultancy, 5 staff, ${c}`,
    fields: { business_name: "Example Consulting", trade: "IT consultant", employees: "5", turnover: "500000", years_trading: "5", cover: "Public liability" },
  },
};

const PERSONAS: Record<string, Persona & { country: string; product: string }> = Object.fromEntries(
  Object.entries(MARKETS).flatMap(([country, m]) =>
    Object.entries(PRODUCT_FIELDS)
      .filter(([product]) => country !== "ZZ" || product === "car")
      .map(([product, p]) => [
        `${country}-${product}-v1`,
        {
          country,
          product,
          label: p.label(m.city),
          fields: {
            ...baseDriver,
            ...p.fields,
            phone: m.phone,
            postcode: m.postcode,
            address_line: "1 Example Street",
            city: m.city,
            reg: m.reg,
            licence_type: m.licence,
            nationality: m.nationality,
            excess: `${m.money}250`,
          },
        },
      ]),
  ),
);

export function seed() {
  tx(() => {
    for (const c of COUNTRIES) {
      run(
        `INSERT INTO countries (code, name, flag, currency, regulator_url, enabled) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, flag = excluded.flag, currency = excluded.currency, regulator_url = excluded.regulator_url, enabled = excluded.enabled`,
        c.code, c.name, c.flag, c.currency, c.regulator_url, c.enabled === false ? 0 : 1,
      );
    }
    for (const p of PRODUCTS) {
      run(`INSERT INTO product_lines (id, name, sort) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort`, p.id, p.name, p.sort);
    }

    const upsertInsurer = (country: string, slug: string, name: string, url: string, color: string, allowed: number, demo: number, group: string | null = null) => {
      const existing = get<{ id: number }>(`SELECT id FROM insurers WHERE country_code = ? AND slug = ?`, country, slug);
      if (existing) {
        // Keep admin decisions (active, audit_allowed, URLs) on re-seed.
        run(`UPDATE insurers SET name = ?, logo_color = ?, parent_group = ? WHERE id = ?`, name, color, group, existing.id);
        return { id: existing.id, created: false };
      }
      const res = run(
        `INSERT INTO insurers (slug, name, country_code, home_url, logo_color, audit_allowed, is_demo, parent_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        slug, name, country, url, color, allowed, demo, group,
      );
      return { id: Number(res.lastInsertRowid), created: true };
    };

    for (const site of MOCK_SITES) {
      const { id } = upsertInsurer("ZZ", site.slug, site.name, `/mock/${site.slug}`, site.color, 1, 1);
      run(`INSERT OR IGNORE INTO insurer_products (insurer_id, product_line_id, quote_start_url) VALUES (?, 'car', ?)`, id, `/mock/${site.slug}`);
    }
    for (const r of REAL_INSURERS) {
      const { id } = upsertInsurer(r.country, r.slug, r.name, r.url, r.color, 1, 0, r.group ?? null);
      for (const p of r.products) {
        run(`INSERT OR IGNORE INTO insurer_products (insurer_id, product_line_id, quote_start_url) VALUES (?, ?, ?)`, id, p, r.url);
      }
    }

    for (const [id, p] of Object.entries(PERSONAS)) {
      run(
        `INSERT INTO personas (id, country_code, product_line_id, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        id, p.country, p.product, JSON.stringify({ label: p.label, fields: p.fields } satisfies Persona),
      );
    }
  });
}

// Bump when the seed data changes so existing databases pick it up on next start.
const SEED_VERSION = 4;

let seeded = false;
export function ensureSeeded() {
  if (seeded) return;
  const row = get<{ user_version: number }>(`PRAGMA user_version`);
  const version = row?.user_version ?? 0;
  if (version < SEED_VERSION) {
    seed();
    // v3: real insurers are open for audits by default.
    if (version > 0 && version < 3) run(`UPDATE insurers SET audit_allowed = 1 WHERE is_demo = 0`);
    db().exec(`PRAGMA user_version = ${SEED_VERSION}`);
  }
  seeded = true;
}
