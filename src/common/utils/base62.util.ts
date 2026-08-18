const BASE62_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class Base62Util {
  /**
   * Encodes a non-negative integer into a Base62 string.
   */
  static encode(num: number): string {
    if (num === 0) return BASE62_CHARS[0];

    let result = '';
    let current = Math.floor(num);

    while (current > 0) {
      const remainder = current % 62;
      result = BASE62_CHARS[remainder] + result;
      current = Math.floor(current / 62);
    }

    return result;
  }

  /**
   * Decodes a Base62 string back into a non-negative integer.
   */
  static decode(str: string): number {
    let num = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const index = BASE62_CHARS.indexOf(char);
      if (index === -1) {
        throw new Error(`Invalid Base62 character: '${char}'`);
      }
      num = num * 62 + index;
    }
    return num;
  }
}
