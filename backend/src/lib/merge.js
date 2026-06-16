// Merge engine: replaces {{placeholder}} (optionally {{placeholder|fallback}})
// in a template with values from a contact. Case-insensitive keys, supports
// custom spreadsheet columns, and a fallback for empty/missing values.

/** Build the lookup context (alias -> value) for one contact. */
function buildContext(contact) {
  const c = contact || {};
  const firstName =
    c.first_name || (c.full_name ? String(c.full_name).trim().split(/\s+/)[0] : '');

  const ctx = {
    email: c.email || '',
    firstname: firstName,
    first_name: firstName,
    lastname: c.last_name || '',
    last_name: c.last_name || '',
    fullname: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '),
    full_name: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '),
    name: c.full_name || firstName || '',
    company: c.company || '',
    role: c.role || '',
    title: c.role || '',
  };

  // Custom spreadsheet columns -> normalized keys (lowercased, spaces->_).
  for (const [k, v] of Object.entries(c.custom || {})) {
    ctx[k.toLowerCase().replace(/\s+/g, '_')] = v;
  }
  return ctx;
}

const PLACEHOLDER_RE = /\{\{\s*([\w.\s]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/** Replace placeholders in a single string. */
export function mergeString(template, contact) {
  const ctx = buildContext(contact);
  return String(template || '').replace(PLACEHOLDER_RE, (_m, rawKey, fallback) => {
    const key = rawKey.trim().toLowerCase().replace(/\s+/g, '_');
    const value = ctx[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
    return fallback !== undefined ? fallback : '';
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

/** Turn a merged plain-text body into simple, deliverability-friendly HTML. */
export function textToHtml(text) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/**
 * Merge a template against a contact.
 * @returns {{ subject: string, text: string, html: string }}
 */
export function mergeTemplate(template, contact) {
  const subject = mergeString(template.subject, contact);
  const text = mergeString(template.body, contact);
  return { subject, text, html: textToHtml(text) };
}

/** Find unique placeholder names used in a template (for UI hints). */
export function extractPlaceholders(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(PLACEHOLDER_RE)) {
    found.add(m[1].trim());
  }
  return [...found];
}

// A ready-to-edit cold-email-to-HR starter. {{...}} = per-contact merge;
// [ ... ] = fill in ONCE with your own details before sending.
export const STARTER_TEMPLATE = {
  name: 'Cold outreach to HR (starter)',
  subject: '{{firstName|Hello}} — [Your Name], interested in [Role] at {{company|your team}}',
  body: `Hi {{firstName|there}},

I came across {{company|your company}} and was really impressed by [mention something specific — a product, value, or recent news]. I'm reaching out because I'd love to be considered for [the Role / roles on your team].

A quick snapshot of me:
- [Your current title] with [X years] of experience in [domain]
- [A concrete achievement with a number — e.g. "cut X by 30%"]
- [Key skills / stack relevant to the role]

My resume and portfolio are here: [link]. Would you be open to a quick 15-minute chat, or could you point me to the right person?

Thanks for your time,
[Your Name]
[Phone] · [LinkedIn] · [Portfolio]

P.S. If you'd prefer I don't follow up, just reply "no thanks" and I won't reach out again.`,
};
