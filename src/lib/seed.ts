import { get, run, tx } from "./db";
import { MOCK_SITES } from "../mock/sites";
import type { Persona } from "./types";

const COUNTRIES = [
  { code: "ZZ", name: "Demo market", flag: "🧪", currency: "GBP", regulator_url: null },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", currency: "GBP", regulator_url: "https://register.fca.org.uk/" },
  { code: "IE", name: "Ireland", flag: "🇮🇪", currency: "EUR", regulator_url: "https://registers.centralbank.ie/" },
  { code: "AU", name: "Australia", flag: "🇦🇺", currency: "AUD", regulator_url: "https://www.apra.gov.au/register-of-authorised-deposit-taking-institutions" },
];

const PRODUCTS = [
  { id: "car", name: "Car", sort: 1 },
  { id: "home", name: "Home", sort: 2 },
  { id: "travel", name: "Travel", sort: 3 },
  { id: "health", name: "Health", sort: 4 },
  { id: "life", name: "Life", sort: 5 },
];

/**
 * Real insurers are seeded inactive for auditing (audit_allowed = 0).
 * An admin must confirm the quote URL and clear the site's terms before any audit runs.
 */
const REAL_INSURERS: { country: string; name: string; slug: string; url: string; color: string; products: string[] }[] = [
  { country: "GB", name: "Aviva", slug: "aviva", url: "https://www.aviva.co.uk", color: "#ffd900", products: ["car", "home"] },
  { country: "GB", name: "Direct Line", slug: "direct-line", url: "https://www.directline.com", color: "#e30613", products: ["car", "home"] },
  { country: "GB", name: "Admiral", slug: "admiral", url: "https://www.admiral.com", color: "#003a70", products: ["car", "home"] },
  { country: "GB", name: "LV=", slug: "lv", url: "https://www.lv.com", color: "#00a650", products: ["car", "home"] },
  { country: "GB", name: "Churchill", slug: "churchill", url: "https://www.churchill.com", color: "#0f3b7d", products: ["car", "home"] },
  { country: "GB", name: "Hastings Direct", slug: "hastings-direct", url: "https://www.hastingsdirect.com", color: "#00205b", products: ["car", "home"] },
  { country: "IE", name: "AXA Ireland", slug: "axa", url: "https://www.axa.ie", color: "#00008f", products: ["car", "home"] },
  { country: "IE", name: "Aviva Ireland", slug: "aviva", url: "https://www.aviva.ie", color: "#ffd900", products: ["car", "home"] },
  { country: "IE", name: "FBD", slug: "fbd", url: "https://www.fbd.ie", color: "#005a9c", products: ["car", "home"] },
  { country: "IE", name: "Allianz Ireland", slug: "allianz", url: "https://www.allianz.ie", color: "#003781", products: ["car", "home"] },
  { country: "AU", name: "NRMA Insurance", slug: "nrma", url: "https://www.nrma.com.au", color: "#0060a9", products: ["car", "home"] },
  { country: "AU", name: "AAMI", slug: "aami", url: "https://www.aami.com.au", color: "#e2001a", products: ["car", "home"] },
  { country: "AU", name: "Budget Direct", slug: "budget-direct", url: "https://www.budgetdirect.com.au", color: "#f58220", products: ["car", "home"] },
  { country: "AU", name: "Youi", slug: "youi", url: "https://www.youi.com.au", color: "#6d2077", products: ["car", "home"] },
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

    const upsertInsurer = (country: string, slug: string, name: string, url: string, color: string, allowed: number, demo: number) => {
      const existing = get<{ id: number }>(`SELECT id FROM insurers WHERE country_code = ? AND slug = ?`, country, slug);
      if (existing) {
        // Keep admin decisions (active, audit_allowed, URLs) on re-seed.
        run(`UPDATE insurers SET name = ?, logo_color = ? WHERE id = ?`, name, color, existing.id);
        return { id: existing.id, created: false };
      }
      const res = run(
        `INSERT INTO insurers (slug, name, country_code, home_url, logo_color, audit_allowed, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        slug, name, country, url, color, allowed, demo,
      );
      return { id: Number(res.lastInsertRowid), created: true };
    };

    for (const site of MOCK_SITES) {
      const { id } = upsertInsurer("ZZ", site.slug, site.name, `/mock/${site.slug}`, site.color, 1, 1);
      run(`INSERT OR IGNORE INTO insurer_products (insurer_id, product_line_id, quote_start_url) VALUES (?, 'car', ?)`, id, `/mock/${site.slug}`);
    }
    for (const r of REAL_INSURERS) {
      const { id } = upsertInsurer(r.country, r.slug, r.name, r.url, r.color, 0, 0);
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

let seeded = false;
export function ensureSeeded() {
  if (seeded) return;
  const row = get<{ n: number }>(`SELECT COUNT(*) AS n FROM countries`);
  if (!row || row.n === 0) seed();
  seeded = true;
}
