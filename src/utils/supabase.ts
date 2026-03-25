type ErrorWithStatus = {
  code?: string;
  status?: number;
  statusCode?: number;
  message?: string;
};

export function isSupabaseUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as ErrorWithStatus;

  return candidate.status === 401 || candidate.statusCode === 401 || candidate.code === 'PGRST301';
}

export async function retryOnceAfterUnauthorized<T>(
  run: () => Promise<T>,
  refresh: () => Promise<void>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isSupabaseUnauthorizedError(error)) {
      throw error;
    }

    await refresh();
    return run();
  }
}

export function throwIfSupabaseError(
  error: ErrorWithStatus | null | undefined,
  fallbackMessage: string,
): void {
  if (!error) {
    return;
  }

  throw new Error(error.message || fallbackMessage);
}
