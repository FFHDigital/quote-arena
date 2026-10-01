/**
 * Real insurers by market. Seeded open for audits (audit_allowed = 1); an admin can switch one off in /admin.
 * Products: c car, h home, t travel, he health, l life, b business.
 */

export interface CountrySeed {
  code: string;
  name: string;
  flag: string;
  currency: string;
  regulator_url: string | null;
}

export const REAL_COUNTRIES: CountrySeed[] = [
  { code: "AR", name: "Argentina", flag: "🇦🇷", currency: "ARS", regulator_url: "https://www.argentina.gob.ar/superintendencia-de-seguros" },
  { code: "BH", name: "Bahrain", flag: "🇧🇭", currency: "BHD", regulator_url: "https://www.cbb.gov.bh/" },
  { code: "CA", name: "Canada", flag: "🇨🇦", currency: "CAD", regulator_url: "https://www.osfi-bsif.gc.ca/" },
  { code: "CL", name: "Chile", flag: "🇨🇱", currency: "CLP", regulator_url: "https://www.cmfchile.cl/" },
  { code: "CN", name: "China", flag: "🇨🇳", currency: "CNY", regulator_url: "https://www.nfra.gov.cn/" },
  { code: "CZ", name: "Czech Republic", flag: "🇨🇿", currency: "CZK", regulator_url: "https://www.cnb.cz/" },
  { code: "GR", name: "Greece", flag: "🇬🇷", currency: "EUR", regulator_url: "https://www.bankofgreece.gr/" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰", currency: "HKD", regulator_url: "https://www.ia.org.hk/" },
  { code: "IE", name: "Ireland", flag: "🇮🇪", currency: "EUR", regulator_url: "https://registers.centralbank.ie/" },
  { code: "JO", name: "Jordan", flag: "🇯🇴", currency: "JOD", regulator_url: "https://www.cbj.gov.jo/" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼", currency: "KWD", regulator_url: "https://iru.gov.kw/" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾", currency: "MYR", regulator_url: "https://www.bnm.gov.my/" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦", currency: "SAR", regulator_url: "https://www.ia.gov.sa/" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", currency: "ZAR", regulator_url: "https://www.fsca.co.za/" },
  { code: "TH", name: "Thailand", flag: "🇹🇭", currency: "THB", regulator_url: "https://www.oic.or.th/" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", currency: "AED", regulator_url: "https://www.centralbank.ae/" },
  { code: "US", name: "United States", flag: "🇺🇸", currency: "USD", regulator_url: "https://content.naic.org/" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", currency: "GBP", regulator_url: "https://register.fca.org.uk/" },
  { code: "AU", name: "Australia", flag: "🇦🇺", currency: "AUD", regulator_url: "https://www.apra.gov.au/" },
];

export interface InsurerSeed {
  country: string;
  name: string;
  url: string;
  color: string;
  products: string;
  group?: string;
}

const FFH = "Fairfax";

// [name, url, color, products, group?] per country.
type Row = [string, string, string, string, string?];

const BY_COUNTRY: Record<string, Row[]> = {
  AR: [
    ["Meridional Seguros", "https://www.meridionalseguros.seg.ar", "#0b4ea2", "c h t b", FFH],
    ["Sancor Seguros", "https://www.sancorseguros.com.ar", "#00539b", "c h t l b"],
    ["Federación Patronal", "https://www.fedpat.com.ar", "#003b71", "c h l b"],
    ["La Caja", "https://www.lacaja.com.ar", "#d4002a", "c h l"],
    ["San Cristóbal Seguros", "https://www.sancristobal.com.ar", "#00498f", "c h b"],
    ["Seguros Rivadavia", "https://www.segurosrivadavia.com", "#0067b1", "c h b"],
    ["Allianz Argentina", "https://www.allianz.com.ar", "#003781", "c h b"],
    ["Zurich Argentina", "https://www.zurich.com.ar", "#2167ae", "c h t l"],
    ["Mercantil Andina", "https://www.mercantilandina.com.ar", "#0a3a7a", "c h b"],
    ["La Segunda", "https://www.lasegunda.com.ar", "#006837", "c h l b"],
    ["Galicia Seguros", "https://www.galiciaseguros.com.ar", "#f37021", "c h t l"],
    ["Provincia Seguros", "https://www.provinciaseguros.com.ar", "#00a1de", "c h b"],
  ],
  BH: [
    ["GIG Bahrain", "https://www.gig.com.bh", "#00205b", "c h t he l b", FFH],
    ["Bahrain National Insurance", "https://www.bnhgroup.com", "#005eb8", "c h t he b"],
    ["Solidarity Bahrain", "https://www.solidaritybahrain.com", "#00857c", "c h t he"],
    ["Takaful International", "https://www.takafulweb.com", "#00654e", "c h t he"],
    ["Arabia Insurance", "https://www.arabiainsurance.com", "#a6192e", "c h t b"],
  ],
  CA: [
    ["Northbridge Insurance", "https://www.northbridgeinsurance.ca", "#00395d", "b", FFH],
    ["Federated Insurance", "https://www.federated.ca", "#004b87", "b", FFH],
    ["Intact Insurance", "https://www.intact.ca", "#e31837", "c h b"],
    ["Desjardins Insurance", "https://www.desjardins.com", "#00874e", "c h t l"],
    ["Aviva Canada", "https://www.aviva.ca", "#ffd900", "c h b"],
    ["TD Insurance", "https://www.tdinsurance.com", "#008a00", "c h t l"],
    ["The Co-operators", "https://www.cooperators.ca", "#0060a9", "c h l b"],
    ["Definity (Economical)", "https://www.economical.com", "#003b5c", "c h b"],
    ["Wawanesa", "https://www.wawanesa.com", "#c8102e", "c h l"],
    ["belairdirect", "https://www.belairdirect.com", "#00a3e0", "c h t"],
    ["Sonnet", "https://www.sonnet.ca", "#ff5c39", "c h"],
    ["Sun Life", "https://www.sunlife.ca", "#ffcb05", "he l"],
    ["Manulife", "https://www.manulife.ca", "#00a758", "he l t"],
    ["Canada Life", "https://www.canadalife.com", "#c8102e", "he l"],
  ],
  CL: [
    ["Southbridge Seguros", "https://www.southbridgeseguros.cl", "#003a70", "c h t b", FFH],
    ["BCI Seguros", "https://www.bciseguros.cl", "#ff6600", "c h t he l"],
    ["Mapfre Chile", "https://www.mapfre.cl", "#d81e05", "c h t b"],
    ["HDI Seguros", "https://www.hdi.cl", "#006e3c", "c h t b"],
    ["Zurich Chile", "https://www.zurich.cl", "#2167ae", "c h l"],
    ["Chubb Chile", "https://www.chubb.com/cl-es/", "#01c1d6", "c h t"],
    ["Reale Seguros", "https://www.reale.cl", "#004a8f", "c h"],
    ["Consorcio", "https://www.consorcio.cl", "#00539f", "c he l"],
    ["MetLife Chile", "https://www.metlife.cl", "#0090da", "he l"],
  ],
  CN: [
    ["Ping An Insurance", "https://www.pingan.com", "#f05a28", "c h t he l"],
    ["China Life", "https://www.chinalife.com.cn", "#007a3d", "he l"],
    ["PICC", "https://www.picc.com.cn", "#c8102e", "c h t b"],
    ["China Pacific Insurance (CPIC)", "https://www.cpic.com.cn", "#0057a8", "c h l"],
    ["China Taiping", "https://www.cntaiping.com", "#c8102e", "c l"],
    ["New China Life", "https://www.newchinalife.com", "#d7000f", "he l"],
    ["Taikang Insurance", "https://www.taikang.com", "#00468b", "he l"],
    ["Sunshine Insurance", "https://www.sinosig.com", "#f39800", "c he l"],
    ["ZhongAn Online", "https://www.zhongan.com", "#00b38a", "t he"],
    ["China Continent Insurance", "https://www.ccic-net.com.cn", "#0067b1", "c h b"],
  ],
  CZ: [
    ["Colonnade Insurance", "https://www.colonnade.cz", "#00205b", "c h b", FFH],
    ["Kooperativa", "https://www.koop.cz", "#003f8a", "c h t l b"],
    ["Generali Česká pojišťovna", "https://www.generaliceska.cz", "#c21b17", "c h t l b"],
    ["Allianz pojišťovna", "https://www.allianz.cz", "#003781", "c h t l"],
    ["ČSOB Pojišťovna", "https://www.csobpoj.cz", "#0055a5", "c h t l"],
    ["UNIQA", "https://www.uniqa.cz", "#0055a2", "c h t l"],
    ["Direct pojišťovna", "https://www.direct.cz", "#ff6b00", "c h"],
    ["ČPP", "https://www.cpp.cz", "#e30613", "c h t"],
    ["NN Životní pojišťovna", "https://www.nn.cz", "#ee7f00", "l"],
    ["Pillow pojišťovna", "https://www.pillow.cz", "#2d2b6b", "c h t"],
  ],
  GR: [
    ["Eurolife FFH", "https://www.eurolife.gr", "#00205b", "c h he l", FFH],
    ["Ethniki Asfalistiki", "https://www.ethnikiasfalistiki.gr", "#005aaa", "c h he l"],
    ["Interamerican", "https://www.interamerican.gr", "#e2001a", "c h t he l"],
    ["Generali Hellas", "https://www.generali.gr", "#c21b17", "c h he l"],
    ["Allianz Hellas", "https://www.allianz.com.gr", "#003781", "c h he l"],
    ["NN Hellas", "https://www.nnhellas.gr", "#ee7f00", "he l"],
    ["Interlife", "https://www.interlife.gr", "#00599c", "c h"],
    ["ERGO Hellas", "https://www.ergohellas.gr", "#e30613", "c h t"],
    ["Hellas Direct", "https://www.hellasdirect.gr", "#0f62fe", "c h"],
    ["Anytime", "https://www.anytime.gr", "#ff6a13", "c h t"],
  ],
  HK: [
    ["Falcon Insurance", "https://www.falconinsurance.com.hk", "#00205b", "c h t he b", FFH],
    ["AIA Hong Kong", "https://www.aia.com.hk", "#d31145", "he l t"],
    ["Prudential Hong Kong", "https://www.prudential.com.hk", "#ed1b2e", "he l"],
    ["Manulife Hong Kong", "https://www.manulife.com.hk", "#00a758", "he l t"],
    ["AXA Hong Kong", "https://www.axa.com.hk", "#00008f", "c h t he l"],
    ["FWD Hong Kong", "https://www.fwd.com.hk", "#e87722", "t he l"],
    ["Zurich Hong Kong", "https://www.zurich.com.hk", "#2167ae", "c h t l"],
    ["Bupa Hong Kong", "https://www.bupa.com.hk", "#0079c8", "he"],
    ["Blue Cross", "https://www.bluecross.com.hk", "#0057a8", "t he"],
    ["MSIG Hong Kong", "https://www.msig.com.hk", "#d2232a", "c h t"],
    ["Chubb Hong Kong", "https://www.chubb.com/hk-en/", "#01c1d6", "c h t he"],
  ],
  IE: [
    ["Allied World (Europe)", "https://www.alliedworldinsurance.com", "#00205b", "b", FFH],
    ["AXA Ireland", "https://www.axa.ie", "#00008f", "c h t"],
    ["Aviva Ireland", "https://www.aviva.ie", "#ffd900", "c h t l"],
    ["FBD", "https://www.fbd.ie", "#005a9c", "c h b"],
    ["Allianz Ireland", "https://www.allianz.ie", "#003781", "c h t b"],
    ["Zurich Ireland", "https://www.zurich.ie", "#2167ae", "c h l"],
    ["Intact Insurance Ireland (RSA)", "https://intactinsurance.ie", "#e0001b", "c h b"],
    ["123.ie", "https://www.123.ie", "#00a99d", "c h t"],
    ["Liberty Insurance", "https://www.libertyinsurance.ie", "#1a1446", "c h"],
    ["Irish Life", "https://www.irishlife.ie", "#00843d", "he l"],
    ["Laya Healthcare", "https://www.layahealthcare.ie", "#6b2c91", "he t"],
    ["Vhi", "https://www.vhi.ie", "#00a3ad", "he t"],
  ],
  JO: [
    ["GIG Jordan", "https://www.gig.com.jo", "#00205b", "c h t he l b", FFH],
    ["Jordan Insurance Company", "https://www.jicjo.com", "#00539f", "c h t he"],
    ["Middle East Insurance", "https://www.meico.com.jo", "#003c71", "c h t he"],
    ["Al Nisr Al Arabi", "https://www.al-nisr.com", "#a6192e", "c h l"],
    ["Jerusalem Insurance", "https://www.jico.jo", "#0072bc", "c h he"],
    ["Solidarity First Insurance", "https://www.solidarity.com.jo", "#00857c", "c h he"],
    ["Euro Arab Insurance", "https://www.euroarabins.com", "#004b8d", "c h t he"],
    ["Islamic Insurance Company", "https://www.islamicinsurance.jo", "#00693e", "c h he"],
  ],
  KW: [
    ["GIG Kuwait", "https://www.gig.com.kw", "#00205b", "c h t he l b", FFH],
    ["Kuwait Insurance Company", "https://www.kic.com.kw", "#004b87", "c h t he"],
    ["Warba Insurance", "https://www.warbaonline.com", "#0067b1", "c h t he"],
    ["Al Ahleia Insurance", "https://www.alahleia.com", "#003a70", "c h t he l"],
    ["Boubyan Takaful", "https://www.boubyantakaful.com", "#7a2531", "c h t"],
    ["Wethaq Takaful", "https://www.wethaq.com", "#00857c", "c h he"],
  ],
  MY: [
    ["Pacific Insurance", "https://www.pacificinsurance.com.my", "#00205b", "c h t he b", FFH],
    ["Allianz Malaysia", "https://www.allianz.com.my", "#003781", "c h t he l"],
    ["Etiqa", "https://www.etiqa.com.my", "#ffc20e", "c h t he l"],
    ["Zurich Malaysia", "https://www.zurich.com.my", "#2167ae", "c h t l"],
    ["AIA Malaysia", "https://www.aia.com.my", "#d31145", "he l"],
    ["Great Eastern", "https://www.greateasternlife.com/my/en", "#c8102e", "c he l"],
    ["Prudential Malaysia", "https://www.prudential.com.my", "#ed1b2e", "he l"],
    ["Tokio Marine Malaysia", "https://www.tokiomarine.com/my/en.html", "#00754a", "c h t"],
    ["Takaful Malaysia", "https://www.takaful-malaysia.com.my", "#00693e", "c h t he l"],
    ["Berjaya Sompo", "https://www.berjayasompo.com.my", "#c8102e", "c h t"],
    ["MSIG Malaysia", "https://www.msig.com.my", "#d2232a", "c h t"],
  ],
  SA: [
    ["GIG Saudi", "https://www.gig.sa", "#00205b", "c h t he b", FFH],
    ["Tawuniya", "https://www.tawuniya.com", "#00843d", "c h t he"],
    ["Bupa Arabia", "https://www.bupa.com.sa", "#0079c8", "he"],
    ["Al Rajhi Takaful", "https://www.alrajhitakaful.com", "#005eb8", "c h t he"],
    ["Malath Insurance", "https://www.malath.com.sa", "#0067b1", "c he"],
    ["Walaa Insurance", "https://www.walaa.com", "#ef7d00", "c h t he"],
    ["MedGulf", "https://www.medgulf.com.sa", "#00539f", "c he"],
    ["Allianz Saudi Fransi", "https://www.allianzsf.com.sa", "#003781", "c h t he"],
    ["SAICO", "https://www.saico.com.sa", "#a6192e", "c h t"],
    ["Arabian Shield", "https://www.arabianshield.com", "#004b87", "c he"],
  ],
  ZA: [
    ["Bryte Insurance", "https://www.brytesa.com", "#00205b", "c h b", FFH],
    ["Santam", "https://www.santam.co.za", "#00205b", "c h b"],
    ["OUTsurance", "https://www.outsurance.co.za", "#f37021", "c h l b"],
    ["Discovery Insure", "https://www.discovery.co.za", "#004a8f", "c h t he l"],
    ["Old Mutual Insure", "https://www.oldmutual.co.za", "#009677", "c h l b"],
    ["Hollard", "https://www.hollard.co.za", "#7a1f5c", "c h t l b"],
    ["King Price", "https://www.kingprice.co.za", "#002f6c", "c h"],
    ["MiWay", "https://www.miway.co.za", "#e2007a", "c h b"],
    ["Momentum", "https://www.momentum.co.za", "#c8102e", "c h he l"],
    ["Sanlam", "https://www.sanlam.co.za", "#0075c9", "he l"],
    ["Dial Direct", "https://www.dialdirect.co.za", "#e30613", "c h"],
    ["Budget Insurance", "https://www.budgetinsurance.co.za", "#00a651", "c h"],
  ],
  TH: [
    ["Falcon Insurance Thailand", "https://www.falconinsurance.co.th", "#00205b", "c h t he b", FFH],
    ["Viriyah Insurance", "https://www.viriyah.co.th", "#e30613", "c h t"],
    ["Dhipaya Insurance", "https://www.dhipaya.co.th", "#00468b", "c h t he"],
    ["Bangkok Insurance", "https://www.bangkokinsurance.com", "#003a8c", "c h t he"],
    ["Muang Thai Insurance", "https://www.muangthaiinsurance.com", "#e4007f", "c h t"],
    ["Tokio Marine Thailand", "https://www.tokiomarine.com/th/th.html", "#00754a", "c h t"],
    ["AIA Thailand", "https://www.aia.co.th", "#d31145", "he l"],
    ["Krungthai-AXA Life", "https://www.krungthai-axa.co.th", "#00008f", "he l"],
    ["FWD Thailand", "https://www.fwd.co.th", "#e87722", "he l"],
    ["Allianz Ayudhya", "https://www.allianz.co.th", "#003781", "he l"],
    ["Thai Life Insurance", "https://www.thailife.com", "#00508f", "he l"],
    ["Roojai", "https://www.roojai.com", "#ff6a00", "c he"],
  ],
  AE: [
    ["GIG Gulf", "https://www.gig-gulf.com", "#00205b", "c h t he l b", FFH],
    ["Sukoon Insurance", "https://www.sukoon.com", "#5f249f", "c h t he l"],
    ["Orient Insurance", "https://www.insuranceuae.com", "#e2231a", "c h t he"],
    ["ADNIC", "https://www.adnic.ae", "#00539f", "c h t he"],
    ["Daman", "https://www.damaninsurance.ae", "#00a3ad", "he"],
    ["Dubai Insurance", "https://www.dubins.ae", "#a6192e", "c h t he"],
    ["Emirates Insurance", "https://www.eminsco.com", "#c8102e", "c h b"],
    ["Al Wathba Insurance", "https://www.awnic.com", "#00539b", "c h t"],
    ["Liva Insurance", "https://www.livainsurance.ae", "#6d2077", "c h t he"],
    ["Salama Insurance", "https://www.salama.ae", "#00693e", "c h t l"],
  ],
  US: [
    ["Crum & Forster", "https://www.cfins.com", "#003a70", "b", FFH],
    ["Zenith Insurance", "https://www.thezenith.com", "#00539f", "b", FFH],
    ["Allied World", "https://www.awac.com", "#00205b", "b", FFH],
    ["State Farm", "https://www.statefarm.com", "#d62311", "c h l"],
    ["Progressive", "https://www.progressive.com", "#0077c8", "c h"],
    ["GEICO", "https://www.geico.com", "#154278", "c h"],
    ["Allstate", "https://www.allstate.com", "#0033a0", "c h l"],
    ["USAA", "https://www.usaa.com", "#12395b", "c h l"],
    ["Liberty Mutual", "https://www.libertymutual.com", "#1a1446", "c h"],
    ["Farmers Insurance", "https://www.farmers.com", "#003087", "c h l"],
    ["Nationwide", "https://www.nationwide.com", "#1c57a5", "c h l b"],
    ["Travelers", "https://www.travelers.com", "#e01a22", "c h b"],
    ["American Family", "https://www.amfam.com", "#c8102e", "c h l"],
    ["Lemonade", "https://www.lemonade.com", "#ff0083", "c h l"],
  ],
  GB: [
    ["Aviva", "https://www.aviva.co.uk", "#ffd900", "c h"],
    ["Direct Line", "https://www.directline.com", "#e30613", "c h"],
    ["Admiral", "https://www.admiral.com", "#003a70", "c h"],
    ["LV=", "https://www.lv.com", "#00a650", "c h"],
    ["Churchill", "https://www.churchill.com", "#0f3b7d", "c h"],
    ["Hastings Direct", "https://www.hastingsdirect.com", "#00205b", "c h"],
  ],
  AU: [
    ["NRMA Insurance", "https://www.nrma.com.au", "#0060a9", "c h"],
    ["AAMI", "https://www.aami.com.au", "#e2001a", "c h"],
    ["Budget Direct", "https://www.budgetdirect.com.au", "#f58220", "c h"],
    ["Youi", "https://www.youi.com.au", "#6d2077", "c h"],
  ],
};

const PRODUCT_CODES: Record<string, string> = { c: "car", h: "home", t: "travel", he: "health", l: "life", b: "business" };

// Keeps slugs from the first release (e.g. GB "aviva", IE "axa") so existing audits stay attached.
const SLUG_OVERRIDES: Record<string, string> = {
  "IE:AXA Ireland": "axa",
  "IE:Aviva Ireland": "aviva",
  "IE:Allianz Ireland": "allianz",
  "AU:NRMA Insurance": "nrma",
};

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const REAL_INSURERS: (Omit<InsurerSeed, "products"> & { slug: string; products: string[] })[] = Object.entries(BY_COUNTRY).flatMap(([country, rows]) =>
  rows.map(([name, url, color, products, group]) => ({
    country,
    name,
    slug: SLUG_OVERRIDES[`${country}:${name}`] ?? slugify(name),
    url,
    color,
    group,
    products: products.split(" ").map((p) => PRODUCT_CODES[p]),
  })),
);
