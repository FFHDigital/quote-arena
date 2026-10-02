// Runtime configuration. Everything has a safe sandbox default so `npm start` just works.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  company: {
    name: process.env.FK_COMPANY_NAME || 'FairKarl',
    legalName: process.env.FK_LEGAL_NAME || 'FairKarl Insurance DAC',
    tagline: 'Fair car insurance for any car, anywhere. Built for people and their AI agents.',
    supportEmail: process.env.FK_SUPPORT_EMAIL || 'help@fairkarl.example',
    regulator: process.env.FK_REGULATOR || 'Central Bank of Ireland (sandbox - authorisation pending)',
    homeCountry: 'IE',
  },
  env: process.env.FK_ENV || 'sandbox', // 'sandbox' | 'production'
  port: Number(process.env.PORT || 8787),
  baseUrl: process.env.FK_BASE_URL || null, // derived from the request when null
  dbPath: process.env.FK_DB_PATH || path.join(root, 'data', 'fairkarl.db'),
  filesDir: process.env.FK_FILES_DIR || path.join(root, 'data', 'files'),
  secret: process.env.FK_SECRET || 'sandbox-secret-change-me',
  staffKey: process.env.FK_STAFF_KEY || 'fk_staff_sandbox',
  apiVersion: '2026-10-01',
  productVersion: '2026-10-01',
  quoteValidityDays: 30,
  coolingOffDays: 14,
  renewalOfferDaysBefore: 30,
  confirmationTtlHours: 72,
  fastTrackClaimUsd: 5000, // auto-settle up to this (USD equivalent) when evidence is complete and nothing is flagged
  maxVehicleValueUsd: 500000, // above this a human underwriter reviews
  rateLimits: { anonymous: 120, agent: 1200, customer: 300, staff: 5000 }, // requests per minute
  root,
};

export const isSandbox = () => config.env !== 'production';
