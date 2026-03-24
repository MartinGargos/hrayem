import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus, Platform } from 'react-native';

function exponentialBackoff(attemptIndex: number): number {
  return Math.min(1_000 * 2 ** attemptIndex, 4_000);
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
      retry: 2,
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
