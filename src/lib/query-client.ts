import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus, Platform } from 'react-native';

function exponentialBackoff(attemptIndex: number): number {
  return Math.min(1_000 * 2 ** attemptIndex, 4_000);
}

type RetryableError = {
  code?: string;
  status?: number;
  statusCode?: number;
};

function shouldRetryMutation(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) {
    return false;
  }

  if (!error || typeof error !== 'object') {
    return true;
  }

  const candidate = error as RetryableError;
  const status = candidate.status ?? candidate.statusCode;

  if (candidate.code === 'RATE_LIMITED') {
    return false;
  }

  if (typeof status === 'number' && status >= 400 && status < 500) {
    return false;
  }

  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1_800_000,
      retry: 2,
      retryDelay: exponentialBackoff,
    },
    mutations: {
      retry: shouldRetryMutation,
      retryDelay: exponentialBackoff,
    },
  },
});

export function bindAppStateToQueryFocus(): () => void {
  if (Platform.OS === 'web') {
    return () => undefined;
  }

  const onAppStateChange = (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  };

  const subscription = AppState.addEventListener('change', onAppStateChange);

  return () => subscription.remove();
}
