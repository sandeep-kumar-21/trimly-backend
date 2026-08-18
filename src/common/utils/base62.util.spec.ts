import { Base62Util } from './base62.util';

describe('Base62Util', () => {
  it('should encode 0 to "0"', () => {
    expect(Base62Util.encode(0)).toBe('0');
  });

  it('should encode and decode positive integers correctly', () => {
    const testCases = [1, 61, 62, 125, 999999, 123456789];
    for (const num of testCases) {
      const encoded = Base62Util.encode(num);
      const decoded = Base62Util.decode(encoded);
      expect(decoded).toBe(num);
    }
  });

  it('should throw error when decoding invalid base62 characters', () => {
    expect(() => Base62Util.decode('invalid!char')).toThrow('Invalid Base62 character');
  });
});
