import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRemoteClientAuthRuntime } from './remote-clients.js';

const createRuntime = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-remote-clients-test-'));
  const runtime = createRemoteClientAuthRuntime({
    fsPromises: fs,
    path,
    crypto,
    storePath: path.join(dir, 'remote-clients.json'),
  });
  return { dir, runtime };
};

describe('remote client auth runtime', () => {
  it('creates, authenticates, lists, and revokes client tokens', async () => {
    const { dir, runtime } = await createRuntime();
    try {
      const created = await runtime.createClient({ label: 'Laptop' });
      expect(created.token.startsWith('oc_client_')).toBe(true);
      expect(created.client.label).toBe('Laptop');

      const listed = await runtime.listClients();
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(created.client.id);
      expect('tokenHash' in listed[0]).toBe(false);

      const authenticated = await runtime.authenticateBearerToken(created.token);
      expect(authenticated?.ok).toBe(true);
      expect(authenticated?.clientId).toBe(created.client.id);

      const afterUse = await runtime.listClients();
      expect(typeof afterUse[0].lastUsedAt).toBe('string');

      const revoked = await runtime.revokeClient(created.client.id);
      expect(revoked.revoked).toBe(true);
      expect(await runtime.authenticateBearerToken(created.token)).toBe(null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
