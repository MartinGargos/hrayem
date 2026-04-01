import { useAuthStore } from '../store/auth-store';
import { requirePublicEnvValue } from '../utils/env';
import { retryOnceAfterUnauthorized } from '../utils/supabase';
import { refreshSupabaseSession } from './supabase';

type EdgeFunctionFailure<TCode extends string> = {
  error?: {
    code?: TCode;
    message?: string;
  };
};

type EdgeFunctionMethod = 'POST' | 'PATCH' | 'DELETE';

function readEdgeFunctionFailure<TCode extends string>(
  value: EdgeFunctionFailure<TCode> | { data: unknown } | null,
): EdgeFunctionFailure<TCode>['error'] | null {
  if (!value || !('error' in value)) {
    return null;
  }

  return value.error ?? null;
}

export class EdgeFunctionError<TCode extends string = string> extends Error {
  code: TCode | null;
  status: number;

  constructor(message: string, code: TCode | null, status: number) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.code = code;
    this.status = status;
  }
}

export async function callEdgeFunctionRoute<TResponse, TCode extends string = string>(
  functionName: string,
  path: string,
  body: Record<string, unknown>,
  options?: {
    method?: EdgeFunctionMethod;
  },
): Promise<TResponse> {
  const functionUrl = `${requirePublicEnvValue('supabaseUrl')}/functions/v1/${functionName}`;
  const supabaseAnonKey = requirePublicEnvValue('supabaseAnonKey');

  return retryOnceAfterUnauthorized(
    async () => {
      const accessToken = useAuthStore.getState().accessToken;

      if (!accessToken) {
        throw new EdgeFunctionError<TCode>(
          'Missing authenticated session.',
          'UNAUTHORIZED' as TCode,
          401,
        );
      }

      const response = await fetch(`${functionUrl}${path}`, {
        method: options?.method ?? 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      let parsedBody: EdgeFunctionFailure<TCode> | { data: TResponse } | null = null;

      try {
        parsedBody = (await response.json()) as EdgeFunctionFailure<TCode> | { data: TResponse };
      } catch {
        parsedBody = null;
      }

      if (!response.ok) {
        const failure = readEdgeFunctionFailure(parsedBody);

        if (response.status === 401) {
          throw {
            status: 401,
            message: failure?.message ?? 'Unauthorized.',
          };
        }

        throw new EdgeFunctionError<TCode>(
          failure?.message ?? 'The server returned an unexpected response.',
          failure?.code ?? null,
          response.status,
        );
      }

      if (!parsedBody || !('data' in parsedBody) || !parsedBody.data) {
        throw new EdgeFunctionError<TCode>(
          'The server returned an unexpected response.',
          null,
          500,
        );
      }

      return parsedBody.data;
    },
    async () => {
      const refreshedSession = await refreshSupabaseSession();

      if (!refreshedSession) {
        throw new EdgeFunctionError<TCode>(
          'Your session expired. Please log in again.',
          'UNAUTHORIZED' as TCode,
          401,
        );
      }
    },
  );
}
