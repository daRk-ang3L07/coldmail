import * as XLSX from 'xlsx';

// Maps messy real-world spreadsheet headers to our canonical fields.
// First match wins; everything unmatched is kept as a "custom" field.
const HEADER_ALIASES = {
  email: ['email', 'email address', 'e-mail', 'mail', 'email id', 'emailid'],
  first_name: ['first name', 'firstname', 'fname', 'given name'],
  last_name: ['last name', 'lastname', 'lname', 'surname', 'family name'],
  full_name: ['name', 'full name', 'fullname', 'contact name', 'contact'],
  company: ['company', 'organization', 'organisation', 'org', 'employer', 'company name'],
  role: ['role', 'title', 'job title', 'designation', 'position', 'jobtitle'],
};

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

/** Decide which canonical field (if any) a header maps to. */
function classifyHeader(header) {
  const norm = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(norm)) return field;
  }
  return null; // -> custom
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse an uploaded spreadsheet buffer (.xlsx/.xls/.csv) into normalized
 * contact rows.
 *
 * @returns {{
 *   contacts: Array<object>,   // normalized rows with valid emails
 *   columns: object,           // detected header -> canonical field mapping
 *   skipped: number,           // rows dropped for missing/invalid email
 *   total: number              // total data rows seen
 * }}
 */
export function parseContactsBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { contacts: [], columns: {}, skipped: 0, total: 0 };

  const sheet = workbook.Sheets[sheetName];
  // defval:'' so missing cells are empty strings, not undefined.
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  // Build header -> field map from the first row's keys.
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const columns = {};
  for (const h of headers) columns[h] = classifyHeader(h);

  const contacts = [];
  let skipped = 0;

  for (const row of rows) {
    const out = { custom: {} };
    for (const [header, value] of Object.entries(row)) {
      const field = columns[header];
      const val = String(value).trim();
      if (!val) continue;
      if (field) out[field] = val;
      else out.custom[header] = val;
    }

    // Derive full_name from first/last if absent.
    if (!out.full_name && (out.first_name || out.last_name)) {
      out.full_name = [out.first_name, out.last_name].filter(Boolean).join(' ');
    }

    const email = (out.email || '').toLowerCase();
    if (!EMAIL_RE.test(email)) {
      skipped++;
      continue;
    }
    out.email = email;
    contacts.push(out);
  }

  return { contacts, columns, skipped, total: rows.length };
}
