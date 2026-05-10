import { buildRuntimeAuthHeaders } from './runtime-auth';
import { getRuntimeUrlResolver, type RuntimeUrlQuery } from './runtime-url';

export interface RuntimeFetchOptions extends RequestInit {
  query?: RuntimeUrlQuery;
}

const shouldResolveApiPath = (input: string): boolean => {
  return input.startsWith('/api/') || input === '/api' || input.startsWith('/auth/') || input === '/auth' || input === '/health';
};

export const buildRuntimeFetchUrl = (input: string, query?: RuntimeUrlQuery): string => {
  if (input === '/health') return getRuntimeUrlResolver().health(query);
  if (input.startsWith('/auth/') || input === '/auth') return getRuntimeUrlResolver().auth(input, query);
  if (shouldResolveApiPath(input)) return getRuntimeUrlResolver().api(input, query);
  return input;
};

export const runtimeFetch = async (input: string | URL | Request, init: RuntimeFetchOptions = {}): Promise<Response> => {
  const { query, ...requestInit } = init;
  const headers = await buildRuntimeAuthHeaders(requestInit.headers);
  const resolvedInput = typeof input === 'string'
    ? buildRuntimeFetchUrl(input, query)
    : input;

  return fetch(resolvedInput, {
    ...requestInit,
    headers,
  });
};
