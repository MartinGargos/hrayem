import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useUIStore } from '../store/ui-store';

function deriveOfflineState(isConnected: boolean | null, isInternetReachable: boolean | null) {
  return isConnected === false || isInternetReachable === false;
}

export function OfflineBanner() {
  const isOffline = useUIStore((state) => state.isOffline);
  const { t } = useTranslation();

  useEffect(() => {
    const applyNetworkState = (
      nextIsConnected: boolean | null,
      nextIsInternetReachable: boolean | null,
    ) => {
      const nextOfflineState = deriveOfflineState(nextIsConnected, nextIsInternetReachable);

      useUIStore.getState().setOffline(nextOfflineState);
      onlineManager.setOnline(!nextOfflineState);
    };

    void NetInfo.fetch().then((state) => {
      applyNetworkState(state.isConnected, state.isInternetReachable);
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      applyNetworkState(state.isConnected, state.isInternetReachable);
    });

    return unsubscribe;
  }, []);

  if (!isOffline) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{t('offline.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#d45d37',
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff8f0',
    textAlign: 'center',
  },
});
