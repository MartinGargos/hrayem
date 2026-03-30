import * as SecureStore from 'expo-secure-store';

const PUSH_TOKEN_CLEANUP_KEY = 'hrayem-push-token-cleanup';
const PUSH_TOKEN_OWNERSHIP_KEY = 'hrayem-push-token-ownership';

function normalizeStoredValue(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim() ?? '';

  return normalizedValue ? normalizedValue : null;
}

function generatePushTokenOwnershipKey(): string {
  const cryptoObject = globalThis.crypto;

  if (!cryptoObject) {
    throw new Error('Secure random generator is unavailable for push token ownership.');
  }

  if (typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }

  if (typeof cryptoObject.getRandomValues !== 'function') {
    throw new Error('Secure random generator is unavailable for push token ownership.');
  }

  const bytes = cryptoObject.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readCachedPushToken(): Promise<string | null> {
  return normalizeStoredValue(await SecureStore.getItemAsync(PUSH_TOKEN_CLEANUP_KEY));
}

export async function cachePushToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(PUSH_TOKEN_CLEANUP_KEY, token);
}

export async function clearCachedPushToken(): Promise<void> {
  await SecureStore.deleteItemAsync(PUSH_TOKEN_CLEANUP_KEY);
}

export async function readOrCreatePushTokenOwnershipKey(): Promise<string> {
  const existingValue = normalizeStoredValue(
    await SecureStore.getItemAsync(PUSH_TOKEN_OWNERSHIP_KEY),
  );

  if (existingValue) {
    return existingValue;
  }

  const nextValue = generatePushTokenOwnershipKey();
  await SecureStore.setItemAsync(PUSH_TOKEN_OWNERSHIP_KEY, nextValue);
  return nextValue;
}
