import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { useAuthStore } from '../store/auth-store';
import { throwIfSupabaseError } from '../utils/supabase';
import { retrySupabaseOperationOnce, supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushTokenIfNeeded(): Promise<string | null> {
  const userId = useAuthStore.getState().userId;

  if (!userId) {
    return null;
  }

  const permission = await Notifications.getPermissionsAsync();
  let finalStatus = permission.status;

  if (finalStatus !== 'granted' && permission.canAskAgain) {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const expoToken = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId,
  });
  const storedToken = useAuthStore.getState().pushToken;

  if (storedToken === expoToken.data) {
    return expoToken.data;
  }

  const result = await retrySupabaseOperationOnce(() =>
    supabase.from('device_tokens').upsert(
      {
        user_id: userId,
        token: expoToken.data,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      },
      {
        onConflict: 'user_id,token',
      },
    ),
  );

  throwIfSupabaseError(result.error, 'Unable to register the push token.');

  useAuthStore.getState().setPushToken(expoToken.data);
  return expoToken.data;
}

export async function deleteRegisteredPushToken(): Promise<void> {
  const authStore = useAuthStore.getState();

  if (!authStore.userId || !authStore.pushToken) {
    authStore.setPushToken(null);
    return;
  }

  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('device_tokens')
      .delete()
      .eq('user_id', authStore.userId)
      .eq('token', authStore.pushToken),
  );

  throwIfSupabaseError(result.error, 'Unable to delete the push token.');
  authStore.setPushToken(null);
}
