/**
 * Reproduction test for issue #1686:
 * "Failed to construct 'Headers': String contains non ISO-8859-1 code point"
 * on paths with Unicode characters.
 *
 * Root cause: `new Headers()` in the Fetch API rejects header values
 * containing characters outside the Latin-1 range (U+0000–U+00FF).
 * Directory paths with CJK, emoji, accented Latin, etc. passed as
 * `x-opencode-directory` headers cause synchronous throws.
 *
 * This test reproduces the bug at the two key choke points:
 *   1. `new Headers()` directly with a Unicode value
 *   2. `mergeHeaders()` from runtime-fetch.ts when a caller (like
 *      createWebFilesAPI) passes a Unicode path as x-opencode-directory
 *
 * All three runtime environments (browser, Node.js, Bun) share the
 * same Headers spec, so any of them reproduces the failure.
 */

import { describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Reproduction 1: raw `new Headers()` rejects non-Latin-1 values
// ---------------------------------------------------------------------------
describe('new Headers rejects non-ISO-8859-1 values (root cause)', () => {
  // ASCII paths work fine.
  test('ASCII header values are accepted', () => {
    const headers = new Headers({ 'x-opencode-directory': '/home/user/project' });
    expect(headers.get('x-opencode-directory')).toBe('/home/user/project');
  });

  // Unicode paths throw.
  test('Chinese characters in header value throw TypeError', () => {
    expect(() => {
      new Headers({ 'x-opencode-directory': '/home/用户/project' });
    }).toThrow(); // throws: "invalid value" (Bun) or "non ISO-8859-1" (Chrome)
  });

  test('Japanese characters in header value throw TypeError', () => {
    expect(() => {
      new Headers({ 'x-opencode-directory': '/home/ユーザー/project' });
    }).toThrow();
  });

  test('emoji in header value throw TypeError', () => {
    expect(() => {
      new Headers({ 'x-opencode-directory': '/home/user/📁/project' });
    }).toThrow();
  });

  test('accented Latin characters are IN Latin-1 range (do not throw)', () => {
    // U+00E1 (á) is within Latin-1 (U+0000-U+00FF), so it's allowed.
    expect(() => {
      new Headers({ 'x-opencode-directory': '/home/usuário/projetos' });
    }).not.toThrow();
  });

  test('characters above U+00FF throw', () => {
    // Chinese, Japanese, Cyrillic are all outside Latin-1.
    expect(() => {
      new Headers({ 'x-opencode-directory': 'C:\\Users\\用户名\\桌面\\project' });
    }).toThrow();
    expect(() => {
      new Headers({ 'x-opencode-directory': '/home/пользователь/project' });
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Reproduction 2: mergeHeaders() from runtime-fetch.ts with Unicode path
// ---------------------------------------------------------------------------
describe('mergeHeaders fails with Unicode paths (the actual call site)', () => {
  // This reproduces the exact code path in runtime-fetch.ts lines 99-108:
  //
  //   const mergeHeaders = async (inputHeaders, initHeaders, attachAuth) => {
  //     const headers = new Headers(inputHeaders);       // line 100
  //     if (initHeaders) {
  //       new Headers(initHeaders).forEach((value, key) => headers.set(key, value)); // line 102
  //     }
  //     ...
  //   };
  //
  // When files.ts calls:
  //   runtimeFetch(url, { headers: { 'x-opencode-directory': '/home/用户/project' } })
  //
  // The initHeaders is passed through to mergeHeaders(), which passes it to
  // `new Headers()` at line 102 — and that throws.

  test('mergeHeaders throws when initHeaders contains Unicode path', async () => {
    // This mirrors the exact signature of mergeHeaders from runtime-fetch.ts
    const mergeHeaders = async (inputHeaders?: HeadersInit, initHeaders?: HeadersInit): Promise<Headers> => {
      const headers = new Headers(inputHeaders);
      if (initHeaders) {
        // Line 102 — this is where it blows up
        new Headers(initHeaders).forEach((value, key) => headers.set(key, value));
      }
      return headers;
    };

    // Simulate what files.ts does: pass a Unicode path in x-opencode-directory
    const unicodeDirectory = '/home/用户/project';
    const initHeaders = { 'x-opencode-directory': unicodeDirectory };

    // mergeHeaders will throw because new Headers(initHeaders) at line 102 fails
    expect(() => mergeHeaders(undefined, initHeaders)).toThrow();
  });

  test('mergeHeaders works with ASCII paths', async () => {
    const mergeHeaders = async (inputHeaders?: HeadersInit, initHeaders?: HeadersInit): Promise<Headers> => {
      const headers = new Headers(inputHeaders);
      if (initHeaders) {
        new Headers(initHeaders).forEach((value, key) => headers.set(key, value));
      }
      return headers;
    };

    const headers = await mergeHeaders(undefined, { 'x-opencode-directory': '/home/user/project' });
    expect(headers.get('x-opencode-directory')).toBe('/home/user/project');
  });
});

// ---------------------------------------------------------------------------
// Reproduction 3: directoryHeaders() from files.ts with Unicode path
// ---------------------------------------------------------------------------
describe('directoryHeaders produces values that crash new Headers()', () => {
  // This reproduces the directoryHeaders helper in files.ts lines 49-52:
  //
  //   const directoryHeaders = (getDirectory?, override?) => {
  //     const directory = override || getDirectory?.();
  //     return directory ? { 'x-opencode-directory': directory } : undefined;
  //   };

  const directoryHeaders = (getDirectory?: () => string | undefined, override?: string): Record<string, string> | undefined => {
    const directory = override || getDirectory?.();
    return directory ? { 'x-opencode-directory': directory } : undefined;
  };

  test('directoryHeaders with Unicode path returns raw header map', () => {
    const headers = directoryHeaders(() => '/home/用户/project');
    expect(headers).toEqual({ 'x-opencode-directory': '/home/用户/project' });
    // This raw map, when passed to new Headers(), will throw
    expect(() => new Headers(headers!)).toThrow();
  });

  test('directoryHeaders with ASCII path works', () => {
    const headers = directoryHeaders(() => '/home/user/project');
    expect(headers).toEqual({ 'x-opencode-directory': '/home/user/project' });
    expect(() => new Headers(headers!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Reproduction 4: End-to-end runtimeFetch with Unicode directory
// ---------------------------------------------------------------------------
describe('runtimeFetch throws when headers contain Unicode path (end-to-end)', () => {
  test('fetch call with x-opencode-directory containing Unicode throws', async () => {
    // Reproduce the actual call flow:
    //   1. files.ts creates header: { 'x-opencode-directory': '/home/用户/project' }
    //   2. runtimeFfetch is called with those headers
    //   3. mergeHeaders passes them to new Headers() → TypeError

    // We can't easily call runtimeFetch directly because it uses globals,
    // but we can demonstrate the exact failing path.
    const makeRequest = () => {
      // Simulate what happens inside runtimeFetch when mergeHeaders calls
      // new Headers(initHeaders) at line 102
      const directory = '/home/用户/project';
      const headers = { 'x-opencode-directory': directory };
      // This is line 102 in runtime-fetch.ts
      new Headers(headers);
    };

    expect(makeRequest).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Verification: the fix approach (encodeURIComponent) resolves the issue
// ---------------------------------------------------------------------------
describe('encodeURIComponent fixes the issue (verification of proposed fix)', () => {
  const toLatin1SafeHeaders = (init?: HeadersInit): Headers => {
    if (!init) return new Headers();
    const safe = new Headers();
    const entries = init instanceof Headers
      ? Array.from(init.entries())
      : init instanceof Array ? init : Object.entries(init);
    for (const [key, value] of entries) {
      const strValue = String(value);
      safe.set(key, /[^\x00-\xFF]/.test(strValue) ? encodeURIComponent(strValue) : strValue);
    }
    return safe;
  };

  test('Unicode path is encoded and accepted by Headers', () => {
    const headers = toLatin1SafeHeaders({ 'x-opencode-directory': '/home/用户/project' });
    expect(headers.get('x-opencode-directory')).toBe(encodeURIComponent('/home/用户/project'));
    // No crash!
  });

  test('ASCII path passes through unchanged', () => {
    const headers = toLatin1SafeHeaders({ 'x-opencode-directory': '/home/user/project' });
    expect(headers.get('x-opencode-directory')).toBe('/home/user/project');
  });

  test('Japanese path is encoded correctly', () => {
    const headers = toLatin1SafeHeaders({ 'x-opencode-directory': '/home/ユーザー/project' });
    expect(headers.get('x-opencode-directory')).toBe(encodeURIComponent('/home/ユーザー/project'));
  });

  test('emoji path is encoded correctly', () => {
    const headers = toLatin1SafeHeaders({ 'x-opencode-directory': '/home/user/📁/project' });
    expect(headers.get('x-opencode-directory')).toBe(encodeURIComponent('/home/user/📁/project'));
  });

  test('decodeURIComponent is the exact inverse', () => {
    const original = '/home/用户/project';
    const encoded = encodeURIComponent(original);
    expect(decodeURIComponent(encoded)).toBe(original);
  });

  test('mixed encoding and decoding round-trips correctly', () => {
    const paths = [
      '/home/user/project',
      '/home/用户/project', 
      '/home/ユーザー/project',
      'C:\\Users\\用户名\\桌面\\project',
      '/home/пользователь/project',
      '/home/user/📁/project',
    ];
    for (const path of paths) {
      const encoded = /[^\x00-\xFF]/.test(path) ? encodeURIComponent(path) : path;
      const decoded = !encoded.includes('%') ? encoded : decodeURIComponent(encoded);
      expect(decoded).toBe(path);
    }
  });
});
