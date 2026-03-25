import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { signOutAndClearState } from '../../services/auth';
import { useUIStore } from '../../store/ui-store';
import type { UserProfile } from '../../types/app';
import { ActionButton } from '../auth/AuthPrimitives';
import { FoundationScreen } from '../foundation/FoundationScreen';

type HomeEntryScreenProps = {
  profile: UserProfile;
};

export function HomeEntryScreen({ profile }: HomeEntryScreenProps) {
  const { t } = useTranslation();
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);

  async function handleLogout() {
    try {
      await signOutAndClearState();
    } catch {
      setAuthNotice({
        messageKey: 'auth.errors.logoutFailed',
        tone: 'error',
      });
    }
  }

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');

  return (
    <FoundationScreen
      topSlot={
        <View style={styles.accountCard}>
          <View style={styles.accountCopy}>
            <Text style={styles.eyebrow}>{t('auth.home.eyebrow')}</Text>
            <Text style={styles.title}>{displayName || t('auth.home.defaultName')}</Text>
            <Text style={styles.subtitle}>
              {profile.city || t('foundation.noCity')} · {t(`auth.language.${profile.language}`)}
            </Text>
          </View>
          <ActionButton label={t('auth.home.logout')} onPress={handleLogout} variant="secondary" />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  accountCard: {
    borderRadius: 24,
    padding: 18,
    gap: 14,
    backgroundColor: '#fff9f1',
    borderWidth: 1,
    borderColor: '#eedfca',
  },
  accountCopy: {
    gap: 6,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
});
