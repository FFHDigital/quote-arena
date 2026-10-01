/**
 * Fictional insurer websites served by this app under /mock/<slug>.
 * They give the audit engine safe, legal targets with known difficulty,
 * so the whole pipeline can be exercised without touching real insurers.
 */

export type MockFieldType = "text" | "email" | "tel" | "date" | "number" | "password" | "select" | "radio" | "checkbox";

export interface MockField {
  id: string;
  label: string;
  type: MockFieldType;
  required?: boolean;
  options?: string[];
  help?: string;
  /** Regex the value must match; shown as an inline error otherwise. */
  pattern?: string;
  patternError?: string;
  /** Renders a lookup button next to this field that prefills other fields. */
  lookup?: { button: string; fills: Record<string, string> };
  /** Only visible after a lookup has filled it. */
  hiddenUntilLookup?: boolean;
}

export interface MockStep {
  title: string;
  intro?: string;
  fields: MockField[];
  button: string;
}

export interface MockSite {
  slug: string;
  name: string;
  color: string;
  tagline: string;
  /** Pages between the home page and the quote form; each needs one click. */
  navPath: { heading: string; body: string; link: string }[];
  homeCta: string | null;
  /** When true the quote form is embedded on the home page itself. */
  formOnHome?: boolean;
  /** Fixed desktop width: breaks small screens on purpose. */
  fixedWidth?: number;
  steps: MockStep[];
  final:
    | { kind: "price"; text: string }
    | { kind: "callback" }
    | { kind: "account-wall" };
}

const claims = ["Please select", "None", "1", "2 or more"];

export const MOCK_SITES: MockSite[] = [
  {
    slug: "swiftly",
    name: "Swiftly Insure",
    color: "#0f9d8a",
    tagline: "Car insurance in two minutes.",
    navPath: [],
    homeCta: "Get a car quote",
    steps: [
      {
        title: "Your car",
        intro: "Enter your registration and we'll find the rest.",
        fields: [
          { id: "reg", label: "Registration number", type: "text", required: true, lookup: { button: "Find my car", fills: { make: "Ford", model: "Focus 1.0 EcoBoost", year: "2019" } } },
          { id: "make", label: "Make", type: "text", required: true, hiddenUntilLookup: true },
          { id: "model", label: "Model", type: "text", required: true, hiddenUntilLookup: true },
          { id: "year", label: "Year of manufacture", type: "text", required: true, hiddenUntilLookup: true },
        ],
        button: "Continue",
      },
      {
        title: "About you",
        fields: [
          { id: "dob", label: "Date of birth", type: "date", required: true },
          { id: "postcode", label: "Postcode", type: "text", required: true, lookup: { button: "Find address", fills: { address: "1 Example Street, London" } } },
          { id: "address", label: "Address", type: "text", required: true, hiddenUntilLookup: true },
          { id: "licence_years", label: "Years you have held a full licence", type: "select", required: true, options: ["Please select", "Less than 1", "1-2", "3-5", "6-9", "10 or more"] },
          { id: "claims", label: "Claims in the last 5 years", type: "select", required: true, options: claims },
        ],
        button: "Get my price",
      },
    ],
    final: { kind: "price", text: "Your price: £412.30 per year" },
  },
  {
    slug: "steady",
    name: "Steady Mutual",
    color: "#1d4ed8",
    tagline: "Protecting members since 1887.",
    navPath: [
      { heading: "Welcome to Steady Mutual", body: "Explore our range of insurance products for members.", link: "Our products" },
      { heading: "Our products", body: "Home, car, travel and life cover for members.", link: "Car insurance" },
      { heading: "Car insurance", body: "Comprehensive and third-party cover with a member discount.", link: "Start a car insurance quote" },
    ],
    homeCta: null,
    steps: [
      {
        title: "Step 1 of 4: Vehicle details",
        fields: [
          { id: "make", label: "Vehicle manufacturer", type: "select", required: true, options: ["Please select", "Audi", "BMW", "Ford", "Toyota", "Volkswagen"] },
          { id: "model", label: "Model", type: "text", required: true },
          { id: "year", label: "Year of manufacture", type: "number", required: true },
          { id: "car_value", label: "Estimated vehicle value (£)", type: "number", required: true },
          { id: "modified", label: "Has the vehicle been modified?", type: "radio", required: true, options: ["Yes", "No"] },
          { id: "overnight", label: "Where is the vehicle kept overnight?", type: "select", required: true, options: ["Please select", "Garage", "Driveway", "Street"] },
        ],
        button: "Next",
      },
      {
        title: "Step 2 of 4: Proposer details",
        fields: [
          { id: "title", label: "Title", type: "select", required: true, options: ["Please select", "Mr", "Mrs", "Ms", "Mx", "Dr"] },
          { id: "first_name", label: "Forename(s)", type: "text", required: true },
          { id: "last_name", label: "Surname", type: "text", required: true },
          { id: "dob", label: "Date of birth", type: "date", required: true },
          { id: "email", label: "Email address", type: "email", required: true },
          { id: "phone", label: "Telephone number", type: "tel", required: true, pattern: "^[0-9]{10,11}$", patternError: "Telephone number is invalid (error code T-114)." },
          { id: "address_line", label: "Address line 1", type: "text", required: true },
          { id: "city", label: "Town", type: "text", required: true },
          { id: "postcode", label: "Postcode", type: "text", required: true },
          { id: "occupation", label: "Occupation", type: "text", required: true },
          { id: "marital", label: "Marital status", type: "select", required: true, options: ["Please select", "Single", "Married", "Civil partnership", "Divorced", "Widowed"] },
        ],
        button: "Next",
      },
      {
        title: "Step 3 of 4: Driving history",
        fields: [
          { id: "licence_type", label: "Licence type", type: "select", required: true, options: ["Please select", "Full UK", "Provisional", "EU", "International"] },
          { id: "licence_years", label: "Years licence held", type: "number", required: true },
          { id: "claims", label: "Claims in the last 5 years", type: "select", required: true, options: claims },
          { id: "convictions", label: "Any motoring convictions?", type: "radio", required: true, options: ["Yes", "No"] },
          { id: "mileage", label: "Annual mileage", type: "number", required: true },
        ],
        button: "Next",
      },
      {
        title: "Step 4 of 4: Cover",
        fields: [
          { id: "cover", label: "Level of cover", type: "select", required: true, options: ["Please select", "Comprehensive", "Third party, fire and theft", "Third party only"] },
          { id: "start_date", label: "Cover start date", type: "date", required: true },
          { id: "excess", label: "Voluntary excess", type: "select", required: true, options: ["Please select", "£0", "£100", "£250", "£500"] },
          { id: "payment", label: "Payment frequency", type: "select", required: true, options: ["Please select", "Annually", "Monthly"] },
          { id: "assumptions", label: "I confirm the assumptions are correct", type: "checkbox", required: true },
        ],
        button: "Calculate premium",
      },
    ],
    final: { kind: "price", text: "Your premium: £538.90 per year" },
  },
  {
    slug: "fortress",
    name: "Fortress Assurance",
    color: "#7c3aed",
    tagline: "Serious cover for serious drivers.",
    navPath: [],
    homeCta: "Get a quote",
    steps: [
      {
        title: "Create your account to get a quote",
        intro: "You need a Fortress account before we can show you a price. We'll email you a verification code.",
        fields: [
          { id: "email", label: "Email address", type: "email", required: true },
          { id: "password", label: "Create a password", type: "password", required: true },
          { id: "password2", label: "Confirm password", type: "password", required: true },
          { id: "robot", label: "I'm not a robot (CAPTCHA)", type: "checkbox", required: true },
        ],
        button: "Create account",
      },
    ],
    final: { kind: "account-wall" },
  },
  {
    slug: "harbour",
    name: "Harbour Cover",
    color: "#b45309",
    tagline: "Talk to a real person.",
    navPath: [{ heading: "Harbour Cover", body: "Our advisers find the right policy for you.", link: "Car insurance" }],
    homeCta: null,
    steps: [
      {
        title: "Talk to an adviser",
        intro: "We don't offer online quotes. Leave your details and an adviser will call you back within 2 working days.",
        fields: [
          { id: "full_name", label: "Full name", type: "text", required: true },
          { id: "phone", label: "Phone number", type: "tel", required: true },
          { id: "best_time", label: "Best time to call", type: "select", required: true, options: ["Please select", "Morning", "Afternoon", "Evening"] },
        ],
        button: "Request a callback",
      },
    ],
    final: { kind: "callback" },
  },
  {
    slug: "nimble",
    name: "Nimble Direct",
    color: "#dc2626",
    tagline: "One page. One price.",
    navPath: [],
    homeCta: null,
    formOnHome: true,
    fixedWidth: 1100,
    steps: [
      {
        title: "Get your quote on one page",
        fields: [
          { id: "reg", label: "Car registration", type: "text", required: true, lookup: { button: "Look up car", fills: { make: "Ford", model: "Focus", year: "2019" } } },
          { id: "make", label: "Make", type: "text", required: true },
          { id: "model", label: "Model", type: "text", required: true },
          { id: "year", label: "Year", type: "text", required: true },
          { id: "first_name", label: "First name", type: "text", required: true },
          { id: "last_name", label: "Last name", type: "text", required: true },
          { id: "dob", label: "Date of birth", type: "date", required: true },
          { id: "email", label: "Email", type: "email", required: true },
          { id: "postcode", label: "Postcode", type: "text", required: true, lookup: { button: "Find address", fills: { address: "1 Example Street, London" } } },
          { id: "address", label: "Address", type: "text", required: true },
          { id: "licence_years", label: "Years licence held", type: "number", required: true },
          { id: "claims", label: "Claims in the last 5 years", type: "select", required: true, options: claims },
          { id: "mileage", label: "Annual mileage", type: "number", required: false, help: "Optional. We'll assume 8,000 if you leave it blank." },
          { id: "marketing", label: "Send me offers by email", type: "checkbox", required: false },
        ],
        button: "Show my price",
      },
    ],
    final: { kind: "price", text: "£38.20 per month" },
  },
];

export function mockSite(slug: string): MockSite | undefined {
  return MOCK_SITES.find((s) => s.slug === slug);
}
