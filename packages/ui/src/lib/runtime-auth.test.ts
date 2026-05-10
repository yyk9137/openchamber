import { describe, expect, test } from 'bun:test';
import {
  buildRuntimeAuthHeaders,
  clearRuntimeAuthCredentialProvider,
  setRuntimeAuthCredentialProvider,
  setRuntimeBearerToken,
} from './runtime-auth';

describe('runtime auth headers', () => {
  test('does not add authorization by default', async () => {
    clearRuntimeAuthCredentialProvider();
    const headers = await buildRuntimeAuthHeaders({ Accept: 'application/json' });

    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(false);
  });

  test('adds bearer token when configured', async () => {
    try {
      setRuntimeBearerToken('token-123');
      const headers = await buildRuntimeAuthHeaders();

      expect(headers.get('Authorization')).toBe('Bearer token-123');
    } finally {
      clearRuntimeAuthCredentialProvider();
    }
  });

  test('preserves explicit authorization header', async () => {
    try {
      setRuntimeAuthCredentialProvider(() => ({ type: 'bearer', token: 'runtime-token' }));
      const headers = await buildRuntimeAuthHeaders({ Authorization: 'Bearer explicit-token' });

      expect(headers.get('Authorization')).toBe('Bearer explicit-token');
    } finally {
      clearRuntimeAuthCredentialProvider();
    }
  });
});
