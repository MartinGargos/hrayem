import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appMetadata } from '../../utils/env';

export function LoadingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 24,
          paddingBottom: Math.max(insets.bottom + 18, 30),
        },
      ]}
    >
      <StatusBar style="dark" />
      <View style={styles.centerCard}>
        <View style={[styles.gridLine, styles.gridLineVertical]} />
        <View style={[styles.gridLine, styles.gridLineHorizontal]} />
        <View style={styles.logoMark}>
          <Text style={styles.logoText}>H/</Text>
        </View>
        <Text style={styles.eyebrow}>HRAYEM</Text>
        <Text style={styles.title}>{t('auth.loading.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.loading.subtitle')}</Text>
        <View style={styles.dots}>
          <View style={[styles.dot, styles.dotActive]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>
      <Text style={styles.versionText}>
        v {appMetadata.version} · {t('auth.loading.city')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
    backgroundColor: '#f7f0e6',
  },
  centerCard: {
    width: '100%',
    maxWidth: 380,
    minHeight: 430,
    marginTop: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ece5db',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: '#ebe5dc',
  },
  gridLineVertical: {
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
  },
  gridLineHorizontal: {
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
  },
  logoMark: {
    width: 84,
    height: 84,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#061427',
    shadowColor: '#061427',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 26,
    elevation: 2,
  },
  logoText: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    color: '#c8ff28',
  },
  eyebrow: {
    marginTop: 30,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#ff5f43',
  },
  title: {
    marginTop: 22,
    textAlign: 'center',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '900',
    color: '#061427',
  },
  subtitle: {
    marginTop: 18,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    color: '#68635e',
  },
  dots: {
    marginTop: 34,
    flexDirection: 'row',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#9aa1a8',
  },
  dotActive: {
    backgroundColor: '#26394f',
  },
  versionText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#aaa39a',
  },
});
