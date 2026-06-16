/**
 * Reproduction test for issue #1679:
 * "x-opencode-directory header crashes file operations when workspace path
 *  contains non-ASCII characters (e.g. Chinese)"
 *
 * Root cause: directoryHeaders() / buildDirectoryHeaders() pass raw directory
 * paths as HTTP header values, but the Fetch API's `new Headers()` enforces
 * ISO-8859-1 encoding. Non-Latin characters (CJK, emoji, etc.) throw:
 *   "Cannot convert argument to a ByteString because the character at index X
 *    has a value of Y which is greater than 255."
 *
 * Impact: all file operations (list, read, write, stat, search, delete, rename)
 * and other API calls using the x-opencode-directive header fail when the
 * workspace path contains non-ASCII characters.
 */
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeUrlQuery, RuntimeUrlResolver } from '@openchamber/ui/lib/runtime-url';

const runtimeFetchMock = vi.fn();

vi.mock('@openchamber/ui/lib/runtime-fetch', () => ({
  runtimeFetch: runtimeFetchMock,
}));

const toUrl = (path: string, query?: RuntimeUrlQuery): string => {
  const params = query instanceof URLSearchParams ? query : new URLSearchParams();
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
};

const urls: RuntimeUrlResolver = {
  api: toUrl,
  authenticatedAsset: toUrl,
  auth: toUrl,
  health: (query?: RuntimeUrlQuery) => toUrl('/health', query),
  rawFile: (path: string) => toUrl('/api/fs/raw', new URLSearchParams({ path })),
  sse: toUrl,
  websocket: toUrl,
};

/** Issue #1679: workspace path with CJK characters */
const CJK_PATH = 'D:\\Myprojects\\人才制度-论文';
const UNIX_CJK_PATH = '/home/user/测试项目';

describe('x-opencode-directory header with non-ASCII paths — issue #1679', () => {
  describe('BROWSER BEHAVIOR: Headers constructor rejects non-ASCII values', () => {
    it('throws for Windows CJK path', () => {
      expect(() => {
        new Headers({ 'x-opencode-directory': CJK_PATH });
      }).toThrow(/Cannot convert argument to a ByteString/i);
    });

    it('throws for Unix CJK path', () => {
      expect(() => {
        new Headers({ 'x-opencode-directory': UNIX_CJK_PATH });
      }).toThrow(/Cannot convert argument to a ByteString/i);
    });

    it('throws for emoji in path', () => {
      expect(() => {
        new Headers({ 'x-opencode-directory': '/home/user/🚀project' });
      }).toThrow(/Cannot convert argument to a ByteString/i);
    });
  });

  describe('encodeURIComponent prevents the crash', () => {
    it('allows CJK path after encoding', () => {
      const encoded = encodeURIComponent(CJK_PATH);
      expect(() => {
        new Headers({ 'x-opencode-directory': encoded });
      }).not.toThrow();
    });

    it('round-trips correctly through encode/decode', () => {
      expect(decodeURIComponent(encodeURIComponent(CJK_PATH))).toBe(CJK_PATH);
      expect(decodeURIComponent(encodeURIComponent(UNIX_CJK_PATH))).toBe(UNIX_CJK_PATH);
    });
  });

  describe('file operations pass raw non-ASCII directory as header value', () => {
    it('statFile sends non-ASCII header value', async () => {
      const { createWebFilesAPI } = await import('./files');
      const api = createWebFilesAPI({ urls, getDirectory: () => CJK_PATH });

      runtimeFetchMock.mockResolvedValueOnce(
        Response.json({ path: '/test/file.txt', isFile: true, size: 12 }),
      );
      await api.statFile?.('/test/file.txt');

      // The raw non-ASCII path is set as a header value — would crash in browser
      expect(runtimeFetchMock).toHaveBeenLastCalledWith(
        '/api/fs/stat?path=%2Ftest%2Ffile.txt',
        { headers: { 'x-opencode-directory': CJK_PATH } },
      );
    });

    it('readFile sends non-ASCII header value', async () => {
      const { createWebFilesAPI } = await import('./files');
      const api = createWebFilesAPI({ urls, getDirectory: () => UNIX_CJK_PATH });

      runtimeFetchMock.mockResolvedValueOnce(new Response('content'));
      await api.readFile?.('/test/file.txt');

      expect(runtimeFetchMock).toHaveBeenLastCalledWith(
        '/api/fs/read?path=%2Ftest%2Ffile.txt',
        { cache: 'default', headers: { 'x-opencode-directory': UNIX_CJK_PATH } },
      );
    });

    it('listDirectory sends non-ASCII header value', async () => {
      const { createWebFilesAPI } = await import('./files');
      const api = createWebFilesAPI({ urls, getDirectory: () => CJK_PATH });

      runtimeFetchMock.mockResolvedValueOnce(
        Response.json({ directory: CJK_PATH, entries: [] }),
      );
      await api.listDirectory?.('/');

      expect(runtimeFetchMock).toHaveBeenLastCalledWith(
        '/api/fs/list?path=%2F',
        { headers: { 'x-opencode-directory': CJK_PATH } },
      );
    });

    it('writeFile sends non-ASCII header value', async () => {
      const { createWebFilesAPI } = await import('./files');
      const api = createWebFilesAPI({ urls, getDirectory: () => CJK_PATH });

      runtimeFetchMock.mockResolvedValueOnce(Response.json({ success: true, path: '/test/file.txt' }));
      await api.writeFile?.('/test/file.txt', 'content');

      expect(runtimeFetchMock).toHaveBeenLastCalledWith(
        '/api/fs/write',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-opencode-directory': CJK_PATH },
          body: JSON.stringify({ path: '/test/file.txt', content: 'content' }),
        },
      );
    });

    it('delete sends non-ASCII header value', async () => {
      const { createWebFilesAPI } = await import('./files');
      const api = createWebFilesAPI({ urls, getDirectory: () => CJK_PATH });

      runtimeFetchMock.mockResolvedValueOnce(Response.json({ success: true }));
      await api.delete?.('/test/file.txt');

      expect(runtimeFetchMock).toHaveBeenLastCalledWith(
        '/api/fs/delete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-opencode-directory': CJK_PATH },
          body: JSON.stringify({ path: '/test/file.txt' }),
        },
      );
    });

    it('search sends non-ASCII header value', async () => {
      const { createWebFilesAPI } = await import('./files');
      const api = createWebFilesAPI({ urls, getDirectory: () => CJK_PATH });

      runtimeFetchMock.mockResolvedValueOnce(Response.json(['file.txt']));
      await api.search?.({ query: 'test', directory: CJK_PATH });

      expect(runtimeFetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/find/file'),
        { headers: { 'x-opencode-directory': CJK_PATH } },
      );
    });
  });
});
