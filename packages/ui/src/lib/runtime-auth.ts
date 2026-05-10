export type RuntimeAuthCredential =
  | { type: 'bearer'; token: string }
  | null;

export type RuntimeAuthCredentialProvider = () => RuntimeAuthCredential | Promise<RuntimeAuthCredential>;

let credentialProvider: RuntimeAuthCredentialProvider = () => null;

const normalizeBearerToken = (token: string | null | undefined): string => {
  if (typeof token !== 'string') return '';
  return token.trim();
};

export const setRuntimeAuthCredentialProvider = (provider: RuntimeAuthCredentialProvider): void => {
  credentialProvider = provider;
};

export const clearRuntimeAuthCredentialProvider = (): void => {
  credentialProvider = () => null;
};

export const setRuntimeBearerToken = (token: string | null | undefined): void => {
  const normalized = normalizeBearerToken(token);
  credentialProvider = () => normalized ? { type: 'bearer', token: normalized } : null;
};

export const getRuntimeAuthCredential = async (): Promise<RuntimeAuthCredential> => {
  const credential = await credentialProvider();
  if (!credential || credential.type !== 'bearer') return null;
  const token = normalizeBearerToken(credential.token);
  return token ? { type: 'bearer', token } : null;
};

export const buildRuntimeAuthHeaders = async (headers?: HeadersInit): Promise<Headers> => {
  const next = new Headers(headers);
  if (next.has('Authorization')) {
    return next;
  }

  const credential = await getRuntimeAuthCredential();
  if (credential?.type === 'bearer') {
    next.set('Authorization', `Bearer ${credential.token}`);
  }
  return next;
};
