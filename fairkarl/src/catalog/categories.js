// The 12 vehicle categories. Every car in the world lands in exactly one of them.
// base_usd = fair annual price for COMPREHENSIVE cover, driver band B, in a market with price_index 1.0.

export const CATEGORIES = [
  { code: 'MICRO', name: 'City car', base_usd: 520, examples: ['Fiat 500', 'Toyota Aygo', 'Hyundai i10', 'Kia Picanto', 'VW up!'], description: 'Small, low-powered city cars.' },
  { code: 'COMPACT', name: 'Compact hatchback', base_usd: 640, examples: ['VW Golf', 'Toyota Corolla hatch', 'Ford Focus', 'Honda Civic', 'Peugeot 208'], description: 'Everyday small family cars and low-powered coupes.' },
  { code: 'FAMILY', name: 'Family saloon / estate', base_usd: 720, examples: ['Skoda Octavia', 'Toyota Camry', 'VW Passat', 'Mazda 6', 'Hyundai Sonata'], description: 'Mid-size saloons and estates.' },
  { code: 'SUV_COMPACT', name: 'Compact SUV / crossover', base_usd: 780, examples: ['Nissan Qashqai', 'Toyota RAV4', 'Hyundai Tucson', 'VW T-Roc', 'Honda CR-V'], description: 'Small and mid-size SUVs and crossovers.' },
  { code: 'SUV_LARGE', name: 'Large SUV / 4x4', base_usd: 960, examples: ['Toyota Land Cruiser', 'Range Rover Sport', 'BMW X5', 'Volvo XC90', 'Chevrolet Tahoe'], description: 'Large, seven-seat or premium SUVs and 4x4s.' },
  { code: 'MPV_VAN', name: 'People carrier / private van', base_usd: 760, examples: ['VW Touran', 'Toyota Sienna', 'Ford Transit Custom (private use)', 'Kia Carnival'], description: 'MPVs and vans used privately (not for deliveries or hire).' },
  { code: 'PICKUP', name: 'Pickup truck', base_usd: 880, examples: ['Ford F-150', 'Toyota Hilux', 'Ford Ranger', 'Ram 1500'], description: 'Pickup trucks used privately.' },
  { code: 'EXECUTIVE', name: 'Executive / premium', base_usd: 1150, examples: ['BMW 5 Series', 'Mercedes-Benz E-Class', 'Audi A6', 'Lexus ES'], description: 'Premium-brand saloons, estates and coupes.' },
  { code: 'EV', name: 'Electric car', base_usd: 900, examples: ['Tesla Model 3', 'VW ID.4', 'Hyundai Ioniq 5', 'BYD Atto 3', 'Nissan Leaf'], description: 'Battery-electric cars (not performance or prestige).' },
  { code: 'PERFORMANCE', name: 'Performance / sports', base_usd: 1650, examples: ['Porsche 911', 'BMW M3', 'Ford Mustang GT', 'Tesla Model S Plaid', 'Toyota GR Supra'], description: 'High-powered or sports cars.' },
  { code: 'PRESTIGE', name: 'Prestige / supercar', base_usd: 3200, examples: ['Ferrari', 'Lamborghini', 'Rolls-Royce', 'Bentley', 'McLaren'], description: 'Supercars, hypercars and luxury cars worth over USD 150,000.' },
  { code: 'CLASSIC', name: 'Classic (25+ years, limited use)', base_usd: 380, examples: ['1990s Mazda MX-5', 'Classic Mini', 'VW Beetle (air-cooled)', 'Mercedes W123'], description: 'Cars 25 or more years old driven under 8,000 km a year.' },
];

export const CATEGORY_BY_CODE = Object.fromEntries(CATEGORIES.map((c) => [c.code, c]));

const PRESTIGE_MAKES = ['ferrari', 'lamborghini', 'rolls-royce', 'rolls royce', 'bentley', 'mclaren', 'bugatti', 'pagani', 'koenigsegg', 'aston martin', 'maybach', 'rimac'];
const PREMIUM_MAKES = ['bmw', 'mercedes', 'mercedes-benz', 'audi', 'lexus', 'jaguar', 'genesis', 'maserati', 'land rover', 'range rover', 'porsche', 'volvo', 'infiniti', 'acura', 'cadillac', 'lincoln', 'alfa romeo', 'ds', 'polestar'];
const PERFORMANCE_MODELS = [/911/, /\bm[2-8]\b/, /\brs ?\d/, /\bamg\b/, /corvette/, /mustang (gt|mach 1|shelby)/, /camaro (ss|zl1)/, /supra/, /gt-?r\b/, /\btype r\b/, /plaid/, /cayman|boxster/, /\bs\d? ?plaid/, /viper/, /challenger (srt|hellcat)/, /charger (srt|hellcat)/, /\bgti\b.*clubsport/, /\bwrx sti\b/, /\b(i|e)?8\b.*bmw/];
const MICRO_MODELS = [/\b500\b/, /aygo/, /\bi10\b/, /picanto/, /\bup!?\b/, /twingo/, /\bc1\b/, /\b108\b/, /spark/, /panda/, /alto/, /kwid/, /\bmii\b/, /citigo/, /\bmorning\b/, /\bwagon ?r\b/, /\bk-?car\b/, /smart/, /\bnano\b/, /\bdacia spring\b/, /\bspring\b/];
const SUV_LARGE_MODELS = [/land cruiser/, /range rover(?! evoque)/, /\bx[5-7]\b/, /\bq[78]\b/, /xc90/, /tahoe/, /suburban/, /expedition/, /escalade/, /\bgl[se]\b/, /g-?class|g-?wagon/, /patrol/, /cayenne/, /touareg/, /defender/, /discovery(?! sport)/, /explorer/, /highlander/, /palisade/, /telluride/, /\bmodel x\b/, /yukon/, /sequoia/, /\bq7\b/, /pajero/, /fortuner/, /everest/, /urus/, /bentayga|cullinan|dbx/];
const PICKUP_MODELS = [/f-?150/, /f-?250/, /hilux/, /ranger/, /\bram\b/, /silverado/, /sierra/, /tacoma/, /tundra/, /navara/, /amarok/, /l200|triton/, /d-?max/, /colorado/, /frontier/, /ridgeline/, /maverick/, /cybertruck/, /gladiator/, /bt-?50/];
const MPV_MODELS = [/touran/, /sienna/, /carnival/, /sedona/, /odyssey/, /pacifica/, /transit/, /sprinter/, /vito|v-class/, /multivan|transporter|caravelle/, /berlingo/, /kangoo/, /zafira/, /galaxy|s-max/, /alphard|vellfire/, /caddy/, /\bproace\b/, /\btrafic\b/, /\bhiace\b/, /\bstaria\b/];
const SUV_MODELS = [/qashqai/, /rav ?4/, /tucson/, /t-?roc/, /cr-?v/, /tiguan/, /sportage/, /kona/, /juke/, /captur/, /\b2008\b|\b3008\b|\b5008\b/, /\bx[1-4]\b/, /\bq[2-5]\b/, /\bgla|glb|glc\b/, /\bcx-?\d/, /forester/, /outback/, /\bhr-?v\b/, /yaris cross/, /c-hr/, /puma/, /kuga|escape/, /evoque|discovery sport/, /\bxc[46]0\b/, /ateca|karoq|kodiaq/, /duster/, /creta/, /seltos/, /rogue|x-?trail/, /equinox|trax/, /\bmodel y\b/, /\bid\.?4\b|\bid\.?5\b/, /ioniq 5/, /\bev6\b/, /atto 3/, /macan/, /\bnx\b|\brx\b|\bux\b/, /compass|cherokee|wrangler|renegade/, /bronco/, /santa fe|sorento/];
const SALOON_MODELS = [/octavia|superb/, /camry/, /passat/, /mazda ?6/, /sonata/, /accord/, /mondeo|fusion/, /insignia/, /\bc-?class\b|\be-?class\b|\bs-?class\b/, /\b[3-7] series\b/, /\ba[3-8]\b/, /\bes\b|\bis\b|\bls\b/, /\bmodel 3\b|\bmodel s\b/, /\bseal\b/, /altima|sentra/, /elantra/, /jetta/, /\bk5\b|optima/, /\b508\b/, /talisman/, /legacy/, /\bs[6-9]0\b|\bv[6-9]0\b/];
const EV_HINTS = [/\bmodel [3sxy]\b/, /\bid\.?\d/, /ioniq/, /\bev\d?\b/, /e-?tron/, /\bleaf\b/, /\bzoe\b/, /atto|dolphin|\bseal\b|\bhan\b/, /polestar/, /\bi[3-7x]\b/, /\beq[abcsev]\b/, /taycan/, /mach-?e/, /bolt/, /lyriq/, /\bmg4\b/, /\bez-?\d\b/, /e-?208|e-?2008/, /\bkona electric\b/, /\bspring\b/, /\bcybertruck\b/, /rivian|r1[st]/, /lucid/];

const has = (list, s) => list.some((re) => re.test(s));

/**
 * Deterministic classifier. Returns {category, reasons[], vehicle_value_usd, referral?}.
 * Inputs are forgiving: only make, model and year are needed; everything else sharpens the answer.
 */
export function classifyVehicle(v, { valueUsd, currentYear = new Date().getUTCFullYear() } = {}) {
  const make = String(v.make || '').toLowerCase().trim();
  const model = String(v.model || '').toLowerCase().trim();
  const s = `${make} ${model}`;
  const body = String(v.body_type || '').toLowerCase();
  const fuel = String(v.powertrain || v.fuel || '').toLowerCase();
  const kw = Number(v.power_kw || (v.power_hp ? v.power_hp * 0.7457 : 0)) || 0;
  const age = v.year ? currentYear - Number(v.year) : 0;
  const annualKm = Number(v.annual_km ?? v.annual_mileage_km ?? 0) || (v.annual_miles ? v.annual_miles * 1.609 : 0);
  const value = Number(valueUsd || 0);
  const reasons = [];
  const out = (category, why) => { reasons.push(why); return { category, name: CATEGORY_BY_CODE[category].name, reasons, inputs_used: { make, model, year: v.year, body_type: body || null, powertrain: fuel || null, power_kw: kw || null, value_usd: value || null, annual_km: annualKm || null } }; };

  if (age >= 25 && annualKm > 0 && annualKm <= 8000) return out('CLASSIC', `${age} years old and driven ${Math.round(annualKm)} km a year (classic: 25+ years, under 8,000 km).`);
  if (age >= 25 && !annualKm) reasons.push('Car is 25+ years old: tell us annual_km (under 8,000) to qualify for the cheaper Classic category.');
  if (PRESTIGE_MAKES.some((m) => make.includes(m)) || value > 150000) return out('PRESTIGE', value > 150000 ? `Value over USD 150,000 (USD ${Math.round(value).toLocaleString('en')}).` : `${v.make} is a prestige marque.`);
  if (kw >= 220 || has(PERFORMANCE_MODELS, s) || (['coupe', 'convertible', 'roadster', 'sports'].includes(body) && kw >= 150)) {
    return out('PERFORMANCE', kw >= 220 ? `Power ${Math.round(kw)} kW is above 220 kW.` : `${v.make} ${v.model} is a performance model.`);
  }
  const isEv = ['electric', 'ev', 'bev', 'battery electric'].includes(fuel) || (!fuel && has(EV_HINTS, s));
  if (isEv) return out('EV', 'Battery-electric powertrain.');
  if (body === 'pickup' || body === 'pickup truck' || has(PICKUP_MODELS, s)) return out('PICKUP', 'Pickup truck body.');
  if (['mpv', 'van', 'minivan', 'people carrier'].includes(body) || (!body && has(MPV_MODELS, s))) return out('MPV_VAN', 'People carrier / van body.');
  const premium = PREMIUM_MAKES.some((m) => make.includes(m));
  const isSuv = ['suv', '4x4', 'crossover', 'off-road'].includes(body) || (!body && (has(SUV_LARGE_MODELS, s) || has(SUV_MODELS, s)));
  if (isSuv) {
    if (has(SUV_LARGE_MODELS, s) || Number(v.seats) >= 7 || value > 45000 || kw >= 150 || premium && value > 35000) return out('SUV_LARGE', 'Large, seven-seat or premium SUV.');
    return out('SUV_COMPACT', 'Compact / mid-size SUV or crossover.');
  }
  if (premium) return out('EXECUTIVE', `${v.make} is a premium brand.`);
  if (has(MICRO_MODELS, s) || (kw && kw < 55 && body !== 'estate')) return out('MICRO', kw && kw < 55 ? `Low power (${Math.round(kw)} kW).` : `${v.make} ${v.model} is a city car.`);
  if (['saloon', 'sedan', 'estate', 'wagon', 'station wagon', 'liftback'].includes(body) || (!body && has(SALOON_MODELS, s))) return out('FAMILY', 'Saloon / estate body.');
  if (['hatchback', 'coupe', 'convertible', 'roadster'].includes(body)) return out('COMPACT', 'Hatchback or low-powered coupe.');
  return out('COMPACT', 'No specific match, so we use the Compact category (tell us body_type to refine).');
}
