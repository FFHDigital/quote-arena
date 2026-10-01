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

// Contact details use reserved fictional ranges (Ofcom drama numbers, ACMA 0491 570, example.com).
const PERSONAS: Record<string, Persona & { country: string; product: string }> = {
  "ZZ-car-v1": { country: "ZZ", product: "car", label: "35-year-old, clean licence, 2019 Ford Focus, London", fields: { ...baseDriver, phone: "07700 900123", postcode: "E1 6AN", address_line: "1 Example Street", city: "London", reg: "AB19 CDE", licence_type: "Full UK" } },
  "GB-car-v1": { country: "GB", product: "car", label: "35-year-old, clean licence, 2019 Ford Focus, London", fields: { ...baseDriver, phone: "07700 900123", postcode: "E1 6AN", address_line: "1 Example Street", city: "London", reg: "AB19 CDE", licence_type: "Full UK" } },
  "GB-home-v1": { country: "GB", product: "home", label: "35-year-old owner of a 3-bed semi, London", fields: { ...baseDriver, ...home, phone: "07700 900123", postcode: "E1 6AN", address_line: "1 Example Street", city: "London" } },
  "IE-car-v1": { country: "IE", product: "car", label: "35-year-old, clean licence, 2019 Ford Focus, Dublin", fields: { ...baseDriver, phone: "REVIEW-BEFORE-USE", postcode: "D02 X285", address_line: "1 Example Street", city: "Dublin", reg: "191-D-12345", licence_type: "Full Irish", excess: "€250" } },
  "IE-home-v1": { country: "IE", product: "home", label: "35-year-old owner of a 3-bed semi, Dublin", fields: { ...baseDriver, ...home, phone: "REVIEW-BEFORE-USE", postcode: "D02 X285", address_line: "1 Example Street", city: "Dublin" } },
  "AU-car-v1": { country: "AU", product: "car", label: "35-year-old, clean licence, 2019 Ford Focus, Sydney", fields: { ...baseDriver, phone: "0491 570 006", postcode: "2000", address_line: "1 Example Street", city: "Sydney", reg: "ABC12D", licence_type: "Full Australian", excess: "$500" } },
  "AU-home-v1": { country: "AU", product: "home", label: "35-year-old owner of a 3-bed house, Sydney", fields: { ...baseDriver, ...home, phone: "0491 570 006", postcode: "2000", address_line: "1 Example Street", city: "Sydney" } },
};

export function seed() {
  tx(() => {
    for (const c of COUNTRIES) {
      run(
        `INSERT INTO countries (code, name, flag, currency, regulator_url) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, flag = excluded.flag, currency = excluded.currency, regulator_url = excluded.regulator_url`,
        c.code, c.name, c.flag, c.currency, c.regulator_url,
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
      const { id } = upsertInsurer(r.country, r.slug, r.name, r.url, r.color, 0, 0, r.group ?? null);
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
const SEED_VERSION = 2;

let seeded = false;
export function ensureSeeded() {
  if (seeded) return;
  const row = get<{ user_version: number }>(`PRAGMA user_version`);
  if ((row?.user_version ?? 0) < SEED_VERSION) {
    seed();
    db().exec(`PRAGMA user_version = ${SEED_VERSION}`);
  }
  seeded = true;
}
