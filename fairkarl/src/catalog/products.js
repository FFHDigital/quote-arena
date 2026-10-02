// Product catalogue: 4 cover tiers, typed limits/excesses and structured exclusions.
// Everything an agent needs to answer "am I covered?" without reading a PDF.
import { config } from '../config.js';
import { nicePrice, roundMoney } from '../util.js';

export const PRODUCT = {
  id: 'fk-motor',
  name: 'FairKarl Car Insurance',
  version: config.productVersion,
  effective_from: '2026-10-01',
  changelog: [{ version: '2026-10-01', date: '2026-10-01', change: 'First release.' }],
  term_months: 12,
  territory: 'Your country of registration, plus up to 90 days a year driving anywhere else in the world (third-party cover always; your tier cover too).',
  who_can_drive: 'The main driver and any named drivers. Anyone else with your permission and a full licence, aged 25+, is covered for third-party liability only.',
  use: 'Social, domestic, pleasure and commuting (including to a single place of work). Not for hire, ride-hailing, deliveries or racing.',
};

// Sections of cover. Limits in USD are converted to local currency at quote time.
export const SECTIONS = {
  third_party_liability: { name: 'Third-party liability', description: 'Injury to other people and damage to their property caused by you driving the car.' },
  fire: { name: 'Fire', description: 'Damage to your car caused by fire, lightning or explosion.' },
  theft: { name: 'Theft', description: 'Theft or attempted theft of your car and damage caused by it.' },
  own_damage: { name: 'Accidental damage', description: 'Damage to your car from collisions, vandalism, storm or flood - even if it was your fault.' },
  windscreen: { name: 'Windscreen and glass', description: 'Repair or replacement of windscreen, windows and sunroof glass.' },
  personal_accident: { name: 'Personal accident', description: 'A lump sum if the driver is seriously injured or killed in an accident in the car.' },
  courtesy_car: { name: 'Courtesy car', description: 'A small car while yours is being repaired after a covered claim, or a hire car if yours is written off or stolen.' },
  breakdown: { name: 'Breakdown assistance', description: 'Roadside repair or recovery, 24/7, including at home.' },
  key_replacement: { name: 'Lost or stolen keys', description: 'Replacing lost or stolen keys and locks.' },
  new_for_old: { name: 'New car replacement', description: 'A brand new car of the same make and model if yours is written off or stolen within 12 months of first registration.' },
  legal_expenses: { name: 'Legal expenses', description: 'Legal costs to recover uninsured losses (e.g. your excess) from someone else after an accident that was not your fault.' },
  ncd_protection: { name: 'No-claims protection', description: 'Up to one at-fault claim per year does not move you into a higher driver band at renewal.' },
};

// limit_usd: number | 'market_value' | 'unlimited' | 'legal_minimum_or_more'; excess_usd: what you pay towards a claim.
const TPL = { limit: 'unlimited_injury_plus_property', limit_usd: { bodily_injury: 'unlimited', property_damage: 5_000_000 }, excess_usd: 0, note: 'Always at least the legal minimum in your country.' };

export const TIERS = {
  third_party: {
    code: 'third_party', name: 'Third party', order: 1, multiplier: 0.55,
    summary: 'The legal minimum done properly: covers damage and injury you cause to others.',
    sections: { third_party_liability: TPL, legal_expenses: { limit_usd: 100_000, excess_usd: 0 } },
  },
  third_party_fire_theft: {
    code: 'third_party_fire_theft', name: 'Third party, fire & theft', order: 2, multiplier: 0.7,
    summary: 'Third party, plus your own car if it is stolen or catches fire.',
    sections: {
      third_party_liability: TPL, legal_expenses: { limit_usd: 100_000, excess_usd: 0 },
      fire: { limit_usd: 'market_value', excess_usd: 250 }, theft: { limit_usd: 'market_value', excess_usd: 250 },
    },
  },
  comprehensive: {
    code: 'comprehensive', name: 'Comprehensive', order: 3, multiplier: 1.0, recommended: true,
    summary: 'Everything above, plus damage to your own car even when it is your fault, and glass.',
    sections: {
      third_party_liability: TPL, legal_expenses: { limit_usd: 100_000, excess_usd: 0 },
      fire: { limit_usd: 'market_value', excess_usd: 250 }, theft: { limit_usd: 'market_value', excess_usd: 250 },
      own_damage: { limit_usd: 'market_value', excess_usd: 300 }, windscreen: { limit_usd: 'unlimited', excess_usd: 50 },
      personal_accident: { limit_usd: 15_000, excess_usd: 0 }, courtesy_car: { limit_usd: 'while_repaired_by_partner_garage', days: 14, excess_usd: 0 },
    },
  },
  comprehensive_plus: {
    code: 'comprehensive_plus', name: 'Comprehensive Plus', order: 4, multiplier: 1.25,
    summary: 'Our most complete cover: lower excess, breakdown, keys, new-car replacement and no-claims protection.',
    sections: {
      third_party_liability: TPL, legal_expenses: { limit_usd: 150_000, excess_usd: 0 },
      fire: { limit_usd: 'market_value', excess_usd: 100 }, theft: { limit_usd: 'market_value', excess_usd: 100 },
      own_damage: { limit_usd: 'market_value', excess_usd: 150 }, windscreen: { limit_usd: 'unlimited', excess_usd: 0 },
      personal_accident: { limit_usd: 50_000, excess_usd: 0 }, courtesy_car: { limit_usd: 'any_repair_or_total_loss', days: 30, excess_usd: 0 },
      breakdown: { limit_usd: 'unlimited_callouts', excess_usd: 0 }, key_replacement: { limit_usd: 1_500, excess_usd: 0 },
      new_for_old: { limit_usd: 'new_car_price', excess_usd: 150, condition: 'Car under 12 months old from first registration.' },
      ncd_protection: { limit_usd: '1_claim_per_year', excess_usd: 0 },
    },
  },
};
export const TIER_CODES = Object.keys(TIERS);
const TIER_ALIASES = {
  tp: 'third_party', thirdparty: 'third_party', 'third party': 'third_party', liability: 'third_party', basic: 'third_party', minimum: 'third_party',
  tpft: 'third_party_fire_theft', 'third party fire and theft': 'third_party_fire_theft', 'third party fire & theft': 'third_party_fire_theft',
  comp: 'comprehensive', full: 'comprehensive', fully_comprehensive: 'comprehensive', 'fully comprehensive': 'comprehensive', standard: 'comprehensive',
  plus: 'comprehensive_plus', premium: 'comprehensive_plus', 'comprehensive plus': 'comprehensive_plus', comp_plus: 'comprehensive_plus', best: 'comprehensive_plus',
};
export function normaliseTier(t) {
  if (!t) return null;
  const s = String(t).trim().toLowerCase().replace(/-/g, '_');
  if (TIERS[s]) return s;
  return TIER_ALIASES[s] || TIER_ALIASES[s.replace(/_/g, ' ')] || null;
}

// Structured exclusions, each linked to the sections it restricts. `circumstance` is the
// boolean flag an agent sets in a coverage check / claim to test it.
export const EXCLUSIONS = [
  { id: 'EX01', circumstance: 'driver_unlicensed', title: 'Unlicensed or disqualified driver', applies_to: ['*'], text: 'No cover if the driver did not hold a valid licence for the car, or was disqualified.', exception: 'Third-party injury claims are still paid to the injured person where the law requires; we may recover the cost from the driver.' },
  { id: 'EX02', circumstance: 'driver_under_influence', title: 'Alcohol or drugs', applies_to: ['*'], text: 'No cover if the driver was over the legal alcohol limit or impaired by drugs.', exception: 'Third-party victims are still paid where the law requires.' },
  { id: 'EX03', circumstance: 'used_for_hire_or_delivery', title: 'Hire, ride-hailing and deliveries', applies_to: ['*'], text: 'No cover while carrying passengers or goods for payment (taxi, Uber/Bolt/Lyft, food or parcel delivery).', exception: 'Car-sharing to split fuel costs is fine.' },
  { id: 'EX04', circumstance: 'racing_or_track', title: 'Racing and track days', applies_to: ['*'], text: 'No cover on a race track, at a track day, or in any timed, speed or rally event.' },
  { id: 'EX05', circumstance: 'wear_and_tear', title: 'Wear, tear and mechanical failure', applies_to: ['own_damage', 'fire', 'theft'], text: 'We do not pay for wear and tear, rust, tyre damage from braking or punctures, or mechanical/electrical breakdown.', exception: 'Comprehensive Plus breakdown assistance covers roadside repair and recovery.' },
  { id: 'EX06', circumstance: 'keys_left_in_or_unlocked', title: 'Keys left in or car unlocked', applies_to: ['theft'], text: 'No theft cover if the keys were left in, on or near the car, or the car was left unlocked or with a window open.', exception: 'Keyless relay theft of a locked car IS covered.' },
  { id: 'EX07', circumstance: 'deliberate_damage_by_insured', title: 'Deliberate damage', applies_to: ['*'], text: 'No cover for damage caused deliberately by you or a driver insured by this policy.' },
  { id: 'EX08', circumstance: 'war_or_nuclear', title: 'War, terrorism and nuclear', applies_to: ['*'], text: 'No cover for war, invasion, civil war, terrorism or nuclear risks.', exception: 'Third-party liability required by law is still covered.' },
  { id: 'EX09', circumstance: 'outside_territory_over_90_days', title: 'Long trips abroad', applies_to: ['*'], text: 'Cover outside your country of registration is limited to 90 days a year in total.' },
  { id: 'EX10', circumstance: 'left_running_unattended', title: 'Engine left running unattended', applies_to: ['theft'], text: 'No theft cover if the car was left unattended with the engine running (for example, defrosting).' },
  { id: 'EX11', circumstance: 'unnamed_driver_under_25', title: 'Unnamed young drivers', applies_to: ['own_damage', 'fire', 'theft', 'windscreen', 'personal_accident'], text: 'Drivers who are not named on the policy are covered for third-party liability only, and only if aged 25 or over.' },
  { id: 'EX12', circumstance: 'undeclared_modifications', title: 'Undeclared modifications', applies_to: ['own_damage', 'theft', 'fire'], text: 'Performance modifications not declared to us are not covered, and claims are reduced in proportion to the extra premium we would have charged.' },
];

// Which sections an incident type draws on. A claim is covered if at least one section is in the tier.
export const INCIDENT_TYPES = {
  collision: { name: 'Collision / accident damage to your car', sections: ['own_damage'] },
  collision_not_at_fault: { name: 'Accident that was someone else\'s fault', sections: ['own_damage', 'legal_expenses'] },
  third_party_damage: { name: 'You damaged someone else\'s car or property', sections: ['third_party_liability'] },
  third_party_injury: { name: 'Someone else was injured', sections: ['third_party_liability'] },
  theft: { name: 'Car stolen', sections: ['theft'] },
  attempted_theft: { name: 'Attempted theft / break-in damage', sections: ['theft'] },
  fire: { name: 'Fire', sections: ['fire'] },
  vandalism: { name: 'Vandalism / malicious damage', sections: ['own_damage'] },
  weather: { name: 'Storm, hail or flood damage', sections: ['own_damage'] },
  windscreen: { name: 'Windscreen or glass damage', sections: ['windscreen'] },
  breakdown: { name: 'Breakdown', sections: ['breakdown'] },
  lost_keys: { name: 'Lost or stolen keys', sections: ['key_replacement'] },
  driver_injury: { name: 'You (the driver) were injured', sections: ['personal_accident'] },
};
const INCIDENT_ALIASES = { accident: 'collision', crash: 'collision', flood: 'weather', storm: 'weather', hail: 'weather', glass: 'windscreen', stolen: 'theft', 'break-in': 'attempted_theft', keys: 'lost_keys', injury: 'third_party_injury' };
export const normaliseIncident = (t) => { const s = String(t || '').trim().toLowerCase(); return INCIDENT_TYPES[s] ? s : INCIDENT_ALIASES[s] || null; };

/** Convert a tier's limits/excesses into a market's currency. Excesses scale with local price level. */
export function localiseTier(tierCode, market, vehicleValueLocal) {
  const t = TIERS[tierCode];
  const ccy = market.currency;
  const conv = (usd, scaled) => (typeof usd === 'number' ? nicePrice(usd * market.fx * (scaled ? market.price_index : 1), ccy) || 0 : usd);
  const sections = {};
  for (const [k, s] of Object.entries(t.sections)) {
    const limit = typeof s.limit_usd === 'object' ? Object.fromEntries(Object.entries(s.limit_usd).map(([a, b]) => [a, conv(b)])) : conv(s.limit_usd);
    sections[k] = {
      section: k, name: SECTIONS[k].name, description: SECTIONS[k].description,
      limit, limit_value: limit === 'market_value' && vehicleValueLocal ? roundMoney(vehicleValueLocal, ccy) : undefined,
      excess: conv(s.excess_usd, true), currency: ccy, ...(s.days ? { days: s.days } : {}), ...(s.condition ? { condition: s.condition } : {}), ...(s.note ? { note: s.note } : {}),
    };
  }
  const notIncluded = Object.keys(SECTIONS).filter((k) => !t.sections[k]).map((k) => ({ section: k, name: SECTIONS[k].name }));
  return {
    code: t.code, name: t.name, summary: t.summary, recommended: !!t.recommended, currency: ccy, sections, not_included: notIncluded,
    exclusions: EXCLUSIONS.filter((e) => e.applies_to.includes('*') || e.applies_to.some((a) => t.sections[a])).map((e) => ({ id: e.id, title: e.title, text: e.text, exception: e.exception, applies_to: e.applies_to })),
  };
}

/**
 * Answer "is this covered?" with clause references. Used by the public coverage-check tool and by claims.
 * @returns {covered, sections_used, excess, limit, exclusions_triggered, explanation}
 */
export function checkCoverage({ tier, incident_type, circumstances = {}, market, vehicleValueLocal, driver_named = true, driver_age }) {
  const t = TIERS[tier];
  const inc = INCIDENT_TYPES[incident_type];
  const local = localiseTier(tier, market, vehicleValueLocal);
  const wanted = inc.sections;
  const inTier = wanted.filter((s) => t.sections[s]);
  const flags = { ...circumstances };
  if (!driver_named && (driver_age == null || driver_age < 25)) flags.unnamed_driver_under_25 = true;
  const triggered = EXCLUSIONS.filter((e) => flags[e.circumstance] && (e.applies_to.includes('*') || e.applies_to.some((a) => wanted.includes(a))));
  const tplLegal = wanted.includes('third_party_liability') && triggered.every((e) => ['EX01', 'EX02', 'EX08'].includes(e.id));
  let covered = inTier.length > 0 && (triggered.length === 0 || tplLegal);
  const main = inTier[0] && local.sections[inTier[0]];
  let explanation;
  if (!inTier.length) {
    const tiersWith = TIER_CODES.filter((c) => wanted.some((s) => TIERS[c].sections[s])).map((c) => TIERS[c].name);
    explanation = `${t.name} does not include ${wanted.map((s) => SECTIONS[s].name).join(' or ')}. ${tiersWith.length ? `It is included in: ${tiersWith.join(', ')}.` : ''}`.trim();
  } else if (triggered.length && !tplLegal) {
    explanation = `Not covered because of exclusion ${triggered.map((e) => `${e.id} (${e.title}): ${e.text}`).join(' ')}`;
  } else if (triggered.length && tplLegal) {
    explanation = `The injured or affected third party is covered as the law requires, but exclusion ${triggered.map((e) => e.id).join(', ')} applies, so we may recover our costs from the driver.`;
  } else {
    explanation = `Covered under ${main.name}. Excess: ${main.excess} ${market.currency}. Limit: ${main.limit_value ?? (typeof main.limit === 'object' ? JSON.stringify(main.limit) : main.limit)}${typeof main.limit === 'number' ? ' ' + market.currency : ''}.`;
  }
  return {
    covered, incident_type, incident_name: inc.name, cover_tier: tier, sections_used: inTier, section_detail: inTier.map((s) => local.sections[s]),
    excess: main ? { amount: main.excess, currency: market.currency } : null,
    limit: main ? (main.limit_value ?? main.limit) : null,
    exclusions_triggered: triggered.map((e) => ({ id: e.id, title: e.title, text: e.text, exception: e.exception })),
    explanation, wording_reference: `${PRODUCT.id} v${PRODUCT.version} - sections ${inTier.join(', ') || 'n/a'}${triggered.length ? '; exclusions ' + triggered.map((e) => e.id).join(', ') : ''}`,
  };
}

// Eligibility / appetite, published so agents can pre-screen before quoting.
export const ELIGIBILITY_RULES = [
  { id: 'EL01', rule: 'The main driver must be at least the legal driving age in the country (usually 17 or 18) and no older than 90.', outcome: 'decline' },
  { id: 'EL02', rule: 'Every driver must hold a full or provisional licence valid in the country of registration.', outcome: 'decline' },
  { id: 'EL03', rule: 'No more than 3 at-fault claims per driver in the last 5 years.', outcome: 'decline' },
  { id: 'EL04', rule: 'No more than 1 major motoring conviction (drink/drug driving, dangerous driving, driving uninsured) per driver in the last 5 years.', outcome: 'decline' },
  { id: 'EL05', rule: 'The car must be worth no more than USD 500,000 for instant cover; above that, a human underwriter prices it within 1 business day.', outcome: 'refer' },
  { id: 'EL06', rule: 'The car must not be used for hire, ride-hailing, deliveries or racing.', outcome: 'decline' },
  { id: 'EL07', rule: 'We cannot insure cars registered in countries under international sanctions (currently North Korea, Iran, Syria, Cuba).', outcome: 'decline' },
  { id: 'EL08', rule: 'Up to 5 drivers per policy.', outcome: 'decline' },
  { id: 'EL09', rule: 'Cars must be road-legal and registered (or about to be registered) in the policyholder\'s country of residence.', outcome: 'decline' },
];

/** Plain-text IPID (Insurance Product Information Document) for a tier in a market. */
export function ipidText(tierCode, market) {
  const l = localiseTier(tierCode, market);
  const lines = [
    `INSURANCE PRODUCT INFORMATION DOCUMENT (IPID)`,
    `Company: ${config.company.legalName}. Product: ${PRODUCT.name} - ${l.name}. Version ${PRODUCT.version}, effective ${PRODUCT.effective_from}.`,
    `This document is a summary. Full terms are in the policy wording (${PRODUCT.id} v${PRODUCT.version}).`,
    ``, `WHAT IS THIS TYPE OF INSURANCE?`, `Annual motor insurance for a private car. ${l.summary}`,
    ``, `WHAT IS INSURED?`,
    ...Object.values(l.sections).map((s) => `+ ${s.name}: ${s.description} Limit: ${typeof s.limit === 'object' ? Object.entries(s.limit).map(([k, v]) => `${k} ${v}`).join(', ') : s.limit}${typeof s.limit === 'number' ? ' ' + l.currency : ''}. Excess: ${s.excess} ${l.currency}.`),
    ``, `WHAT IS NOT INSURED?`, ...l.not_included.map((s) => `- ${s.name}`), ...l.exclusions.map((e) => `- ${e.id} ${e.title}: ${e.text}`),
    ``, `ARE THERE ANY RESTRICTIONS ON COVER?`, `! Excesses apply as shown above.`, `! ${PRODUCT.who_can_drive}`, `! Use: ${PRODUCT.use}`,
    ``, `WHERE AM I COVERED?`, PRODUCT.territory,
    ``, `WHAT ARE MY OBLIGATIONS?`, `- Give accurate answers and tell us (or ask your agent to tell us) about changes to the car, drivers or address.`, `- Report claims as soon as you reasonably can.`, `- Keep the car roadworthy and secure.`,
    ``, `WHEN AND HOW DO I PAY?`, `Annually, or in 12 monthly instalments at 0% interest (APR 0%). No fees for paying monthly, changing or cancelling.`,
    ``, `WHEN DOES THE COVER START AND END?`, `On the start date shown on your schedule, for 12 months. Renewal is your choice: we never auto-renew unless you turned auto-renew on.`,
    ``, `HOW DO I CANCEL THE CONTRACT?`, `Any time, online, by API or through your agent. Within ${config.coolingOffDays} days (cooling-off) or later, you get back the unused part of your premium, pro rata, with no fees. The only exception: no refund after we pay a total-loss claim.`,
  ];
  return lines.join('\n');
}

export function wordingText(market) {
  const parts = [
    `${PRODUCT.name} - POLICY WORDING v${PRODUCT.version} (effective ${PRODUCT.effective_from})`, `Insurer: ${config.company.legalName}.`, '',
    '1. THE CONTRACT. This policy, your schedule and your certificate form the contract. We rely on the information you or your authorised agent gave us.',
    `2. WHO CAN DRIVE. ${PRODUCT.who_can_drive}`, `3. USE. ${PRODUCT.use}`, `4. TERRITORY. ${PRODUCT.territory}`, '5. SECTIONS OF COVER (which apply depends on your tier - see your schedule):',
    ...Object.entries(SECTIONS).map(([k, s], i) => `   5.${i + 1} ${s.name} (${k}). ${s.description}`),
    '6. GENERAL EXCLUSIONS:', ...EXCLUSIONS.map((e) => `   ${e.id} ${e.title}. ${e.text}${e.exception ? ' Exception: ' + e.exception : ''}`),
    '7. CLAIMS. Report by API, MCP, app, web or phone. We tell you exactly what evidence we need, decide covered claims under the fast-track limit automatically once evidence is complete, and a human reviews every decline on request.',
    `8. CANCELLATION. You may cancel at any time and receive a pro-rata refund of unused premium with no fees. Cooling-off period: ${config.coolingOffDays} days.`,
    '9. RENEWAL. We offer renewal 30 days before expiry at the same price a new customer with the same car and record would pay. We never charge loyal customers more.',
    '10. AUTHORISED AGENTS. You may authorise an AI or human agent to act for you within limits you set (a mandate). You can see everything an agent did in your activity log and revoke access instantly.',
    `11. COMPLAINTS. Lodge a complaint any way you like. We acknowledge immediately, update you at least every 20 business days and give a final response within 40 business days. If you are unhappy you may go to: ${market?.ombudsman?.name || 'your national ombudsman'}.`,
    '12. AI USE. We use automated rules (and may use AI models) to classify vehicles, check coverage and fast-track claims. Prices come from a published table, not from profiling. You can ask for a human to review any automated decision.',
    '13. LAW. The law of the country in which the car is registered applies, unless agreed otherwise.',
  ];
  return parts.join('\n');
}
