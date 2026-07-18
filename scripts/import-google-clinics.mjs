#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const ownerId = '4fe3eb83-7c50-4eee-8af7-4a550dacecd9';
const dryRun = process.argv.includes('--dry-run');
const workbookPath = path.resolve(repoRoot, 'DressingRoll_B2B_CRM_V1.xlsx');
const worksheetName = 'Google Places (England)';

const envFilePath = path.resolve(repoRoot, '.env.local');
const envRaw = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
const envValues = Object.fromEntries(envRaw.split(/\r?\n/).filter(Boolean).map((line) => {
  const idx = line.indexOf('=');
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  return [key, value];
}).filter(Boolean));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envValues.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envValues.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  const cleaned = String(value ?? '').replace(/[^0-9+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return '+' + cleaned.slice(1).replace(/^0+/, '');
  return cleaned.replace(/^0+/, '');
}

function normalizeWebsite(value) {
  const cleaned = normalizeText(value).replace(/\/$/, '');
  if (!cleaned) return '';
  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return cleaned.toLowerCase();
  }
}

function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePostcode(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '');
}

function normalizeClinicType(value, allowedClinicTypes = []) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;

  const allowed = allowedClinicTypes
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);

  if (allowed.includes(normalized)) {
    return normalized;
  }

  if (allowed.includes('private')) {
    return 'private';
  }

  if (allowed.length === 1) {
    return allowed[0];
  }

  return null;
}

function normalizeRow(raw, allowedClinicTypes = []) {
  const name = normalizeText(raw.Name || raw.name || raw['Name']);
  const city = normalizeText(raw['City/Area'] || raw.city || raw.City || raw['City/Area']);
  const address = normalizeText(raw.Address || raw.address || raw['Address']);
  const postcode = normalizePostcode(raw.Postcode || raw.postcode || raw['Postcode']);
  const phone = normalizePhone(raw.Phone || raw.phone || raw['Phone']);
  const website = normalizeText(raw.Website || raw.website || raw['Website']);
  const category = normalizeText(raw.Category || raw.category || raw['Category']);
  const searchArea = normalizeText(raw['Search area'] || raw['search area'] || raw['Search area']);
  const clinicType = normalizeClinicType(category, allowedClinicTypes);

  return {
    clinic_name: name,
    clinic_type: clinicType,
    city,
    address_line_1: address,
    postcode,
    phone,
    website,
    source_reference: searchArea,
    owner_id: ownerId,
    country: 'United Kingdom',
    source: 'Google Places',
    status: 'research',
    priority: 'normal',
    email_status: 'unknown',
  };
}

function toInsertPayload(row) {
  return {
    owner_id: row.owner_id,
    clinic_name: row.clinic_name || null,
    clinic_type: row.clinic_type || null,
    city: row.city || null,
    address_line_1: row.address_line_1 || null,
    postcode: row.postcode || null,
    phone: row.phone || null,
    website: row.website || null,
    source_reference: row.source_reference || null,
    country: row.country || null,
    source: row.source || null,
    status: row.status || null,
    priority: row.priority || null,
    email_status: row.email_status || null,
  };
}

function writeImportReport(report) {
  const duplicateCount = (report.duplicatesInsideExcel || 0) + (report.duplicatesAlreadyInSupabase || 0);
  const csvPath = path.resolve(repoRoot, 'import-report.csv');
  const csv = ['imported,duplicate,failed', `${report.insertedRows || 0},${duplicateCount},${report.failedRows || 0}`].join('\n');
  fs.writeFileSync(csvPath, csv, 'utf8');
  console.log(`Wrote ${csvPath}`);
}

async function loadExistingClinics() {
  const { data, error } = await supabase
    .from('clinics')
    .select('id, clinic_name, phone, website, postcode, owner_id')
    .eq('owner_id', ownerId);

  if (error) {
    throw error;
  }

  return data || [];
}

async function loadAllowedClinicTypes() {
  const { data, error } = await supabase.from('clinics').select('clinic_type').limit(1000);
  if (error) {
    throw error;
  }

  return [...new Set((data || []).map((row) => normalizeText(row.clinic_type)).filter(Boolean))];
}

async function main() {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const worksheet = workbook.Sheets?.[worksheetName];
  if (!worksheet) {
    throw new Error(`Worksheet ${worksheetName} not found in ${workbookPath}`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
    raw: false,
  });

  const allowedClinicTypes = await loadAllowedClinicTypes();
  const invalidRows = [];
  const normalizedRows = rows.map((raw) => ({ raw, normalized: normalizeRow(raw, allowedClinicTypes) })).filter(({ normalized }) => {
    if (!normalized.clinic_name) {
      invalidRows.push(normalized);
      return false;
    }
    return true;
  });

  const existingClinics = await loadExistingClinics();
  const existingKeys = new Map();
  for (const clinic of existingClinics) {
    const websiteDomain = normalizeWebsite(clinic.website || '');
    const phone = normalizePhone(clinic.phone || '');
    const postcode = normalizePostcode(clinic.postcode || '');
    const name = normalizeName(clinic.clinic_name || '');
    const keyParts = [websiteDomain, phone, `${postcode}|${name}`].filter(Boolean);
    existingKeys.set(keyParts.join('|'), true);
  }

  const seenInExcel = new Set();
  const duplicateRowsInsideExcel = [];
  const duplicatesAlreadyInSupabase = [];
  const uniqueRowsReady = [];

  for (const { raw, normalized } of normalizedRows) {
    const websiteDomain = normalizeWebsite(normalized.website || '');
    const phone = normalizePhone(normalized.phone || '');
    const postcode = normalizePostcode(normalized.postcode || '');
    const name = normalizeName(normalized.clinic_name || '');
    const keyParts = [websiteDomain, phone, `${postcode}|${name}`].filter(Boolean);
    const key = keyParts.join('|');
    if (!key) {
      invalidRows.push(normalized);
      continue;
    }

    if (seenInExcel.has(key)) {
      duplicateRowsInsideExcel.push(normalized);
      continue;
    }
    seenInExcel.add(key);

    if (existingKeys.has(key)) {
      duplicatesAlreadyInSupabase.push(normalized);
      continue;
    }

    uniqueRowsReady.push(normalized);
  }

  const report = {
    rowsRead: rows.length,
    invalidRows: invalidRows.length,
    duplicatesInsideExcel: duplicateRowsInsideExcel.length,
    duplicatesAlreadyInSupabase: duplicatesAlreadyInSupabase.length,
    uniqueRowsReady: uniqueRowsReady.length,
    insertedRows: 0,
    failedRows: 0,
  };

  console.log('Dry run:', dryRun);
  console.log(JSON.stringify(report, null, 2));
  writeImportReport(report);

  if (dryRun) {
    return;
  }

  for (let index = 0; index < uniqueRowsReady.length; index += 250) {
    const chunk = uniqueRowsReady.slice(index, index + 250).map(toInsertPayload);
    const { error } = await supabase.from('clinics').insert(chunk);
    if (error) {
      report.failedRows += chunk.length;
      console.error('Insert failed', error);
    } else {
      report.insertedRows += chunk.length;
      if (report.insertedRows % 250 === 0) {
        console.log(`[import] ${report.insertedRows} clinics inserted so far`);
      }
    }
  }

  console.log('Final report');
  console.log(JSON.stringify(report, null, 2));
  writeImportReport(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
