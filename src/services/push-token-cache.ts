import * as SecureStore from 'expo-secure-store';

const PUSH_TOKEN_CLEANUP_KEY = 'hrayem-push-token-cleanup';

export async function readCachedPushToken(): Promise<string | null> {
  const value = await SecureStore.getItemAsync(PUSH_TOKEN_CLEANUP_KEY);
  const normalizedValue = value?.trim() ?? '';

  return normalizedValue ? normalizedValue : null;
}

export async function cachePushToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(PUSH_TOKEN_CLEANUP_KEY, token);
}

export async function clearCachedPushToken(): Promise<void> {
  await SecureStore.deleteItemAsync(PUSH_TOKEN_CLEANUP_KEY);
}
