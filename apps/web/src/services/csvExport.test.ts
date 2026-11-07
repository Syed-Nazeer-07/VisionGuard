import { describe, expect, it } from 'vitest';
import { csvCell } from './csvExport';

describe('CSV report cell escaping', () => {
  it('quotes commas, double quotes and newlines', () => {
    expect(csvCell('A,"B"')).toBe('"A,""B"""');
    expect(csvCell('Road\nCamera')).toBe('"Road\nCamera"');
  });
  it('neutralizes formulas, including whitespace-prefixed attacks', () => {
    expect(csvCell('=HYPERLINK("http://bad.example")')).toBe('"\'=HYPERLINK(""http://bad.example"")"');
    expect(csvCell(' \t+SUM(1,1)')).toBe('"\' \t+SUM(1,1)"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
  });
  it('preserves plain numeric measurements', () => {
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(-3.2)).toBe('"-3.2"');
    expect(csvCell(null)).toBe('""');
  });
});
