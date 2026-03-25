import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export function LoadingScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Hrayem</Text>
      <Text style={styles.title}>{t('auth.loading.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.loading.subtitle')}</Text>
      <ActivityIndicator color="#183153" size="large" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f7f0e6',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  title: {
    marginTop: 12,
    fontSize: 30,
    fontWeight: '800',
    color: '#183153',
  },
  subtitle: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 24,
    color: '#395065',
  },
  spinner: {
    marginTop: 22,
  },
});
