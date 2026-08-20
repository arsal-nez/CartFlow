import { sanitizeText } from '../../../src/utils/sanitize';

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<b>Bold</b> name')).toBe('Bold name');
    expect(sanitizeText('Trail Bottle<script>alert(1)</script>')).toBe('Trail Bottlealert(1)');
  });

  it('collapses whitespace runs, including tabs and newlines, to a single space', () => {
    expect(sanitizeText('  Trail   Bottle\t\n')).toBe('Trail Bottle');
  });

  it('drops ASCII control characters', () => {
    const withControlChars = [
      'A',
      String.fromCharCode(1),
      'B',
      String.fromCharCode(127),
      'CD',
    ].join('');
    expect(sanitizeText(withControlChars)).toBe('ABCD');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeText('  padded  ')).toBe('padded');
  });

  it('leaves already-clean text untouched', () => {
    expect(sanitizeText('Trail Bottle')).toBe('Trail Bottle');
  });
});
