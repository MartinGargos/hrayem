import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { useAuthStore } from '../store/auth-store';
import { throwIfSupabaseError } from '../utils/supabase';
import { retrySupabaseOperationOnce, supabase } from './supabase';
import {
  cachePushToken,
  clearCachedPushToken,
  readCachedPushToken,
  readOrCreatePushTokenOwnershipKey,
} from './push-token-cache';

type StoredPushTokenRecord = string;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getDevicePlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

async function claimPushToken(token: string, ownershipKey: string): Promise<void> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase.rpc('claim_device_token', {
      push_ownership_key: ownershipKey,
      push_platform: getDevicePlatform(),
      push_token: token,
    }),
  );

  throwIfSupabaseError(result.error, 'Unable to register the push token.');
}

async function deletePushTokenRow(token: string, ownershipKey: string): Promise<void> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase.rpc('delete_device_token', {
      push_ownership_key: ownershipKey,
      push_token: token,
    }),
  );

  throwIfSupabaseError(result.error, 'Unable to delete the push token.');
}

async function readStoredPushTokenRecord(): Promise<StoredPushTokenRecord | null> {
  const authStore = useAuthStore.getState();
  const inMemoryToken = authStore.pushToken?.trim() ?? '';

  if (inMemoryToken) {
    return inMemoryToken;
  }

  return readCachedPushToken();
}

function isUnavailablePushTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes('physical device') ||
    message.includes('simulator') ||
    message.includes('emulator') ||
    message.includes('projectid') ||
    message.includes('project id') ||
    message.includes('not available')
  );
}

export async function registerPushTokenIfNeeded(): Promise<string | null> {
  const authStore = useAuthStore.getState();
  const userId = authStore.userId;

  if (!userId) {
    authStore.setPushToken(null);
    return null;
  }

  const permission = await Notifications.getPermissionsAsync();
  let finalStatus = permission.status;

  if (finalStatus !== 'granted' && permission.canAskAgain) {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  if (finalStatus !== 'granted') {
    await deleteRegisteredPushToken();
    return null;
  }

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;

  if (!projectId) {
    throw new Error('Missing EAS project ID for push token registration.');
  }

  let nextToken: string | null = null;

  try {
    const expoToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    nextToken = expoToken.data.trim() || null;
  } catch (error) {
    if (isUnavailablePushTokenError(error)) {
      await deleteRegisteredPushToken();
      return null;
    }

    throw error;
  }

  if (!nextToken) {
    await deleteRegisteredPushToken();
    return null;
  }

  const storedToken = useAuthStore.getState().pushToken;
  const previousKnownToken = storedToken ?? (await readCachedPushToken());
  const ownershipKey = await readOrCreatePushTokenOwnershipKey();

  await claimPushToken(nextToken, ownershipKey);

  if (previousKnownToken && previousKnownToken !== nextToken) {
    await deletePushTokenRow(previousKnownToken, ownershipKey);
  }

  await cachePushToken(nextToken);
  useAuthStore.getState().setPushToken(nextToken);
  return nextToken;
}

export async function deleteRegisteredPushToken(): Promise<StoredPushTokenRecord | null> {
  const authStore = useAuthStore.getState();
  const storedRecord = await readStoredPushTokenRecord();

  if (!storedRecord) {
    authStore.setPushToken(null);
    await clearCachedPushToken();
    return null;
  }

  const ownershipKey = await readOrCreatePushTokenOwnershipKey();
  await deletePushTokenRow(storedRecord, ownershipKey);
  authStore.setPushToken(null);
  await clearCachedPushToken();
  return storedRecord;
}

export async function restoreRegisteredPushToken(
  storedRecord: StoredPushTokenRecord | null,
): Promise<void> {
  if (!storedRecord) {
    return;
  }

  const ownershipKey = await readOrCreatePushTokenOwnershipKey();
  await claimPushToken(storedRecord, ownershipKey);
  await cachePushToken(storedRecord);
  useAuthStore.getState().setPushToken(storedRecord);
}
