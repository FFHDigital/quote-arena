// Markets: every country is insurable. Each market has ONE price index (local cost level),
// a currency + FX rate (local units per USD), and the local premium tax. That keeps the
// quote space per market at exactly 192 prices (12 categories x 4 driver bands x 4 tiers).
//
// FX and tax rates are sandbox reference values: wire a daily FX feed and confirm local tax
// with each market's regulator before go-live.

const M = (code, name, currency, fx, priceIndex, taxRate, taxName, ombudsman, extra = {}) =>
  ({ code, name, currency, fx, price_index: priceIndex, tax: { rate: taxRate, name: taxName }, ombudsman, min_driver_age: 17, ...extra });

const EU_OMB = { name: 'FIN-NET (EU cross-border network)', url: 'https://finance.ec.europa.eu/consumer-finance-and-payments/retail-financial-services/financial-dispute-resolution-network-fin-net_en' };

const LIST = [
  M('IE', 'Ireland', 'EUR', 0.86, 1.15, 0.03, 'Stamp duty on non-life premiums', { name: 'Financial Services and Pensions Ombudsman (FSPO)', url: 'https://www.fspo.ie' }),
  M('GB', 'United Kingdom', 'GBP', 0.75, 1.1, 0.12, 'Insurance Premium Tax', { name: 'Financial Ombudsman Service', url: 'https://www.financial-ombudsman.org.uk' }),
  M('US', 'United States', 'USD', 1, 1.3, 0.025, 'State premium tax (avg.)', { name: 'Your state Department of Insurance', url: 'https://content.naic.org/state-insurance-departments' }, { min_driver_age: 16 }),
  M('CA', 'Canada', 'CAD', 1.38, 1.25, 0.04, 'Provincial premium tax (avg.)', { name: 'General Insurance OmbudService', url: 'https://www.giocanada.org' }, { min_driver_age: 16 }),
  M('AU', 'Australia', 'AUD', 1.52, 1.1, 0.1, 'GST', { name: 'Australian Financial Complaints Authority', url: 'https://www.afca.org.au' }, { min_driver_age: 16 }),
  M('NZ', 'New Zealand', 'NZD', 1.7, 1.0, 0.15, 'GST', { name: 'Insurance & Financial Services Ombudsman', url: 'https://www.ifso.nz' }, { min_driver_age: 16 }),
  M('DE', 'Germany', 'EUR', 0.86, 1.0, 0.19, 'Versicherungsteuer', { name: 'Versicherungsombudsmann', url: 'https://www.versicherungsombudsmann.de' }),
  M('FR', 'France', 'EUR', 0.86, 1.0, 0.18, 'Taxe sur les conventions d\'assurance', { name: 'La Médiation de l\'Assurance', url: 'https://www.mediation-assurance.org' }),
  M('ES', 'Spain', 'EUR', 0.86, 0.85, 0.08, 'Impuesto sobre las primas de seguros', EU_OMB, { min_driver_age: 18 }),
  M('IT', 'Italy', 'EUR', 0.86, 1.05, 0.125, 'Imposta sulle assicurazioni', { name: 'Arbitro Assicurativo', url: 'https://www.ivass.it' }, { min_driver_age: 18 }),
  M('NL', 'Netherlands', 'EUR', 0.86, 1.0, 0.21, 'Assurantiebelasting', { name: 'Kifid', url: 'https://www.kifid.nl' }, { min_driver_age: 18 }),
  M('BE', 'Belgium', 'EUR', 0.86, 1.0, 0.0925, 'Taxe annuelle sur les contrats d\'assurance', { name: 'Ombudsman des Assurances', url: 'https://www.ombudsman-insurance.be' }, { min_driver_age: 18 }),
  M('PT', 'Portugal', 'EUR', 0.86, 0.75, 0.09, 'Imposto do selo', EU_OMB, { min_driver_age: 18 }),
  M('AT', 'Austria', 'EUR', 0.86, 1.0, 0.11, 'Versicherungssteuer', EU_OMB),
  M('CH', 'Switzerland', 'CHF', 0.8, 1.25, 0.05, 'Stempelabgabe', { name: 'Ombudsman of Private Insurance', url: 'https://www.versicherungsombudsman.ch' }, { min_driver_age: 18 }),
  M('SE', 'Sweden', 'SEK', 9.5, 1.0, 0.0, 'None', EU_OMB, { min_driver_age: 18 }),
  M('NO', 'Norway', 'NOK', 10.1, 1.15, 0.0, 'None', { name: 'Finansklagenemnda', url: 'https://www.finkn.no' }, { min_driver_age: 18 }),
  M('DK', 'Denmark', 'DKK', 6.4, 1.05, 0.0, 'None', EU_OMB, { min_driver_age: 18 }),
  M('FI', 'Finland', 'EUR', 0.86, 0.95, 0.24, 'Vakuutusmaksuvero', EU_OMB, { min_driver_age: 18 }),
  M('PL', 'Poland', 'PLN', 3.65, 0.6, 0.0, 'None', { name: 'Rzecznik Finansowy', url: 'https://rf.gov.pl' }, { min_driver_age: 18 }),
  M('CZ', 'Czechia', 'CZK', 21, 0.6, 0.0, 'None', EU_OMB, { min_driver_age: 18 }),
  M('GR', 'Greece', 'EUR', 0.86, 0.7, 0.15, 'Insurance premium tax', EU_OMB, { min_driver_age: 18 }),
  M('HU', 'Hungary', 'HUF', 345, 0.55, 0.15, 'Insurance tax', EU_OMB),
  M('RO', 'Romania', 'RON', 4.35, 0.5, 0.0, 'None', EU_OMB, { min_driver_age: 18 }),
  M('JP', 'Japan', 'JPY', 148, 0.95, 0.0, 'None', { name: 'General Insurance Consultation Center', url: 'https://www.sonpo.or.jp' }, { min_driver_age: 18 }),
  M('KR', 'South Korea', 'KRW', 1390, 0.8, 0.0, 'None', { name: 'Financial Supervisory Service', url: 'https://www.fss.or.kr' }, { min_driver_age: 18 }),
  M('SG', 'Singapore', 'SGD', 1.29, 1.1, 0.09, 'GST', { name: 'FIDReC', url: 'https://www.fidrec.com.sg' }, { min_driver_age: 18 }),
  M('HK', 'Hong Kong', 'HKD', 7.8, 1.0, 0.0, 'None', { name: 'Insurance Complaints Bureau', url: 'https://www.icb.org.hk' }, { min_driver_age: 18 }),
  M('IN', 'India', 'INR', 88, 0.3, 0.18, 'GST', { name: 'Insurance Ombudsman', url: 'https://www.cioins.co.in' }, { min_driver_age: 18 }),
  M('AE', 'United Arab Emirates', 'AED', 3.67, 0.9, 0.05, 'VAT', { name: 'Sanadak', url: 'https://sanadak.gov.ae' }, { min_driver_age: 18 }),
  M('SA', 'Saudi Arabia', 'SAR', 3.75, 0.8, 0.15, 'VAT', { name: 'Insurance Authority', url: 'https://www.ia.gov.sa' }, { min_driver_age: 18 }),
  M('ZA', 'South Africa', 'ZAR', 17.6, 0.6, 0.15, 'VAT', { name: 'National Financial Ombud Scheme', url: 'https://www.nfosa.co.za' }),
  M('NG', 'Nigeria', 'NGN', 1530, 0.35, 0.075, 'VAT', { name: 'NAICOM Complaints Bureau', url: 'https://www.naicom.gov.ng' }, { min_driver_age: 18 }),
  M('KE', 'Kenya', 'KES', 129, 0.35, 0.0, 'None', { name: 'Insurance Regulatory Authority', url: 'https://www.ira.go.ke' }, { min_driver_age: 18 }),
  M('BR', 'Brazil', 'BRL', 5.4, 0.55, 0.0738, 'IOF', { name: 'Consumidor.gov.br', url: 'https://www.consumidor.gov.br' }, { min_driver_age: 18 }),
  M('MX', 'Mexico', 'MXN', 18.5, 0.55, 0.16, 'IVA', { name: 'CONDUSEF', url: 'https://www.condusef.gob.mx' }, { min_driver_age: 18 }),
  M('AR', 'Argentina', 'ARS', 1400, 0.45, 0.21, 'IVA', { name: 'Superintendencia de Seguros', url: 'https://www.argentina.gob.ar/superintendencia-de-seguros' }),
  M('CL', 'Chile', 'CLP', 950, 0.6, 0.19, 'IVA', { name: 'Defensoría del Asegurado', url: 'https://www.ddachile.cl' }, { min_driver_age: 18 }),
  M('CO', 'Colombia', 'COP', 3900, 0.45, 0.19, 'IVA', { name: 'Defensor del Consumidor Financiero', url: 'https://www.superfinanciera.gov.co' }, { min_driver_age: 18 }),
  M('TR', 'Türkiye', 'TRY', 41, 0.45, 0.05, 'BSMV', { name: 'Sigorta Tahkim Komisyonu', url: 'https://www.sigortatahkim.org.tr' }, { min_driver_age: 18 }),
  M('IL', 'Israel', 'ILS', 3.35, 0.9, 0.0, 'None', { name: 'Capital Market Authority', url: 'https://www.gov.il/en/departments/capital_market_insurance_and_savings_authority' }),
  M('MY', 'Malaysia', 'MYR', 4.2, 0.45, 0.08, 'SST', { name: 'Ombudsman for Financial Services', url: 'https://www.ofs.org.my' }),
  M('TH', 'Thailand', 'THB', 32.5, 0.4, 0.07, 'VAT', { name: 'Office of Insurance Commission', url: 'https://www.oic.or.th' }, { min_driver_age: 18 }),
  M('ID', 'Indonesia', 'IDR', 16400, 0.35, 0.0, 'None', { name: 'OJK', url: 'https://www.ojk.go.id' }),
  M('PH', 'Philippines', 'PHP', 57, 0.35, 0.12, 'Documentary stamp & premium tax', { name: 'Insurance Commission', url: 'https://www.insurance.gov.ph' }),
  M('VN', 'Vietnam', 'VND', 26300, 0.35, 0.1, 'VAT', { name: 'Insurance Supervisory Authority', url: 'https://mof.gov.vn' }, { min_driver_age: 18 }),
  M('CN', 'China', 'CNY', 7.1, 0.6, 0.06, 'VAT', { name: 'NFRA consumer hotline 12378', url: 'https://www.nfra.gov.cn' }, { min_driver_age: 18 }),
  M('EG', 'Egypt', 'EGP', 48, 0.3, 0.0, 'None', { name: 'Financial Regulatory Authority', url: 'https://fra.gov.eg' }, { min_driver_age: 18 }),
];

// Countries where we cannot legally write cover (international sanctions). Everything else is open.
export const BLOCKED = { KP: 'North Korea', IR: 'Iran', SY: 'Syria', CU: 'Cuba' };

const BY_CODE = Object.fromEntries(LIST.map((m) => [m.code, m]));
let regionNames;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { regionNames = null; }

const COUNTRY_ALIASES = {
  UK: 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB', 'NORTHERN IRELAND': 'GB', USA: 'US', 'UNITED STATES OF AMERICA': 'US',
  AMERICA: 'US', UAE: 'AE', HOLLAND: 'NL', 'REPUBLIC OF IRELAND': 'IE', EIRE: 'IE', KOREA: 'KR', TURKEY: 'TR',
};

/** Accepts ISO code ("ie"), name ("Ireland") or alias ("UK"). Returns ISO-3166 alpha-2 or null. */
export function normaliseCountry(input) {
  if (!input) return null;
  const s = String(input).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s === 'UK' ? 'GB' : s;
  if (COUNTRY_ALIASES[s]) return COUNTRY_ALIASES[s];
  const hit = LIST.find((m) => m.name.toUpperCase() === s);
  if (hit) return hit.code;
  if (regionNames) {
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const c = String.fromCharCode(a, b);
      try { if (regionNames.of(c)?.toUpperCase() === s) return c; } catch { /* not a region */ }
    }
  }
  return null;
}

/** Any country works: unlisted countries get a USD-priced default market. */
export function getMarket(code) {
  const c = normaliseCountry(code);
  if (!c) return null;
  if (BY_CODE[c]) return { ...BY_CODE[c], status: 'live' };
  if (BLOCKED[c]) return { code: c, name: BLOCKED[c], status: 'unavailable', reason: 'International sanctions prevent us from offering cover in this country.' };
  let name = c;
  try { name = regionNames?.of(c) || c; } catch { /* keep code */ }
  return {
    code: c, name, currency: 'USD', fx: 1, price_index: 0.7, tax: { rate: 0, name: 'Local taxes, if any, are included' },
    ombudsman: { name: 'Your national insurance regulator or financial ombudsman', url: null }, min_driver_age: 18, status: 'live',
    note: 'Priced in USD using our default global price level.',
  };
}

export const listMarkets = () => LIST.map((m) => ({ code: m.code, name: m.name, currency: m.currency, price_index: m.price_index, tax: m.tax, min_driver_age: m.min_driver_age, ombudsman: m.ombudsman, status: 'live' }));
export const toLocal = (usd, market) => usd * market.fx;
export const toUsd = (local, market) => local / market.fx;
