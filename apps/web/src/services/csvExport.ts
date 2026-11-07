/**
 * Quote spreadsheet cells while neutralizing formula injection from filenames,
 * source names and other user-controlled metadata.
 */
export function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  // Spreadsheet parsers may discard leading whitespace/control characters.
  // Skip those without an unsafe control-character regex literal.
  const candidate = raw.trimStart();
  let prefix = 0;
  while (prefix < candidate.length && candidate.charCodeAt(prefix) <= 32) prefix++;
  const leadingFormula = '=+@-'.includes(candidate[prefix] || ' ');
  const plainNumber = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim());
  const safe = leadingFormula && !plainNumber ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}
