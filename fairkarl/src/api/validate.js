// Minimal, forgiving JSON-Schema validation: coerces obvious type slips ("35" -> 35, "true" -> true),
// drops nothing, and returns errors written so a model can fix the call on the next try.

function coerce(schema, v) {
  if (v == null || !schema) return v;
  const t = schema.type;
  if ((t === 'number' || t === 'integer') && typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.replace(/[, ]/g, '')))) return Number(v.replace(/[, ]/g, ''));
  if (t === 'boolean' && typeof v === 'string') return ['true', 'yes', '1', 'on'].includes(v.toLowerCase()) ? true : ['false', 'no', '0', 'off'].includes(v.toLowerCase()) ? false : v;
  if (t === 'array' && !Array.isArray(v)) {
    if (typeof v === 'string') { try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch { /* comma list */ } return v.split(',').map((s) => s.trim()).filter(Boolean); }
    return [v];
  }
  if (t === 'object' && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  if (t === 'string' && typeof v === 'number') return String(v);
  return v;
}

export function validate(schema, input, path = '') {
  const errors = [];
  if (!schema || schema.type !== 'object') return { value: input, errors };
  const value = { ...(input || {}) };
  for (const [k, s] of Object.entries(schema.properties || {})) {
    if (value[k] === undefined || value[k] === null || value[k] === '') { if (value[k] === '') delete value[k]; continue; }
    value[k] = coerce(s, value[k]);
    const f = path ? `${path}.${k}` : k;
    const v = value[k];
    const typeOk = { string: typeof v === 'string', number: typeof v === 'number' && isFinite(v), integer: Number.isInteger(v), boolean: typeof v === 'boolean', array: Array.isArray(v), object: v && typeof v === 'object' && !Array.isArray(v) }[s.type];
    if (s.type && typeOk === false) { errors.push({ field: f, code: 'wrong_type', message: `Expected ${s.type}.`, fix: `Send ${f} as ${s.type}${s.examples ? `, e.g. ${JSON.stringify(s.examples[0])}` : ''}.` }); continue; }
    if (s.enum && !s.enum.includes(v) && !s['x-lenient']) errors.push({ field: f, code: 'invalid_value', message: `"${v}" is not allowed.`, fix: `Use one of: ${s.enum.join(', ')}.` });
    if (s.type === 'object' && s.properties) { const r = validate(s, v, f); value[k] = r.value; errors.push(...r.errors); }
    if (s.type === 'array' && s.items?.type === 'object') value[k] = v.map((it, i) => { const r = validate(s.items, it, `${f}[${i}]`); errors.push(...r.errors); return r.value; });
    if (typeof v === 'number' && s.minimum != null && v < s.minimum) errors.push({ field: f, code: 'too_small', message: `Must be at least ${s.minimum}.`, fix: `Send a value >= ${s.minimum}.` });
    if (typeof v === 'number' && s.maximum != null && v > s.maximum) errors.push({ field: f, code: 'too_large', message: `Must be at most ${s.maximum}.`, fix: `Send a value <= ${s.maximum}.` });
  }
  for (const r of schema.required || []) {
    if (value[r] === undefined || value[r] === null) {
      const s = schema.properties?.[r] || {};
      errors.push({ field: path ? `${path}.${r}` : r, code: 'required', message: `${r} is required.`, fix: s.description ? `${s.description}${s.examples ? ` Example: ${JSON.stringify(s.examples[0])}` : ''}` : `Add ${r}.` });
    }
  }
  return { value, errors };
}
