import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, addHours, formatISO, subMinutes } from 'date-fns';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ExpoLinking from 'expo-linking';
import * as Sentry from '@sentry/react-native';
import { useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { CURATED_CITIES } from '../../constants/cities';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { useUserStore } from '../../store/user-store';
import { appMetadata, publicEnv } from '../../utils/env';
import {
  formatChatTimestamp,
  formatEventDate,
  formatEventTime,
  formatRelativeTime,
} from '../../utils/dates';

const foundationQueryKey = ['milestone-0', 'foundation-query'] as const;

let foundationQueryFetchCount = 0;

async function fetchFoundationQuerySnapshot() {
  foundationQueryFetchCount += 1;
  await new Promise((resolve) => setTimeout(resolve, 160));

  return {
    fetchCount: foundationQueryFetchCount,
    fetchedAt: new Date().toISOString(),
    nextEventAt: formatISO(addDays(addHours(new Date(), 2), 1)),
    lastChatAt: formatISO(subMinutes(new Date(), 18)),
  };
}

type CardProps = {
  title: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

function Card({ title, children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

type MetricRowProps = {
  label: string;
  value: string;
};

function MetricRow({ label, value }: MetricRowProps) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: 'primary' | 'secondary';
};

function ActionButton({ label, onPress, variant = 'primary' }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityHint={label}
      accessibilityLabel={label}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' ? styles.secondaryButton : styles.primaryButton,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'secondary' ? styles.secondaryButtonLabel : styles.primaryButtonLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type FoundationScreenProps = {
  topSlot?: ReactNode;
};

export function FoundationScreen({ topSlot }: FoundationScreenProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const authErrorKey = useAuthStore((state) => state.errorMessageKey);
  const authStatus = useAuthStore((state) => state.status);
  const isOffline = useUIStore((state) => state.isOffline);
  const language = useUserStore((state) => state.language);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const setLanguage = useUserStore((state) => state.setLanguage);
  const [sentryMessage, setSentryMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: foundationQueryKey,
    queryFn: fetchFoundationQuerySnapshot,
  });

  const authStatusLabel = t(`foundation.authState.${authStatus}`);
  const deepLinkPreview = ExpoLinking.createURL('event/example-id', {
    scheme: appMetadata.scheme,
  });

  const querySnapshot = query.data ?? {
    fetchCount: 0,
    fetchedAt: new Date().toISOString(),
    nextEventAt: new Date().toISOString(),
    lastChatAt: new Date().toISOString(),
  };

  async function handleLanguageChange(nextLanguage: 'cs' | 'en') {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLanguage(nextLanguage);
    setSentryMessage(null);
  }

  async function handleQueryRefresh() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await queryClient.invalidateQueries({ queryKey: foundationQueryKey });
  }

  async function handleSentryTest() {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Sentry.captureException(new Error('Milestone 0 Sentry smoke test'));
    setSentryMessage(t('foundation.sentrySent'));
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {topSlot}
      <View style={styles.heroCard}>
        <Image
          accessibilityLabel={t('foundation.iconAlt')}
          contentFit="cover"
          source={require('../../../assets/icon.png')}
          style={styles.heroIcon}
        />
        <Text style={styles.eyebrow}>{t('foundation.eyebrow')}</Text>
        <Text style={styles.heroTitle}>{t('foundation.title')}</Text>
        <Text style={styles.heroSubtitle}>{t('foundation.subtitle')}</Text>
        <Text style={styles.languageLabel}>{t('foundation.languageLabel')}</Text>

        <View style={styles.buttonRow}>
          <ActionButton
            label={t('foundation.switchToCzech')}
            onPress={() => handleLanguageChange('cs')}
            variant={language === 'cs' ? 'primary' : 'secondary'}
          />
          <ActionButton
            label={t('foundation.switchToEnglish')}
            onPress={() => handleLanguageChange('en')}
            variant={language === 'en' ? 'primary' : 'secondary'}
          />
        </View>
      </View>

      <Card title={t('foundation.queryCardTitle')}>
        <MetricRow
          label={t('foundation.queryFetchCount')}
          value={String(querySnapshot.fetchCount)}
        />
        <MetricRow
          label={t('foundation.queryFetchedAt')}
          value={formatChatTimestamp(querySnapshot.fetchedAt, language)}
        />
        <MetricRow
          label={t('foundation.queryRefreshing')}
          value={query.isFetching ? t('foundation.booleanYes') : t('foundation.booleanNo')}
        />
        <ActionButton label={t('foundation.queryRefetch')} onPress={handleQueryRefresh} />
        {query.isLoading ? (
          <Text style={styles.supportingText}>{t('foundation.queryLoading')}</Text>
        ) : null}
      </Card>

      <Card title={t('foundation.authCardTitle')}>
        <MetricRow label={t('foundation.authStatusLabel')} value={authStatusLabel} />
        <MetricRow
          label={t('foundation.authErrorLabel')}
          value={authErrorKey ? t(authErrorKey) : t('foundation.emptyValue')}
        />
      </Card>

      <Card title={t('foundation.networkCardTitle')}>
        <MetricRow
          label={t('foundation.networkStatusLabel')}
          value={isOffline ? t('foundation.networkOffline') : t('foundation.networkOnline')}
        />
        <MetricRow label={t('foundation.networkScheme')} value={appMetadata.scheme} />
        <MetricRow
          label={t('foundation.networkUniversalLink')}
          value={`${(publicEnv.webBaseUrl || 'https://www.hrayem.cz').replace(/\/+$/, '')}/event/example-id`}
        />
        <MetricRow label={t('foundation.networkDeepLink')} value={deepLinkPreview} />
      </Card>

      <Card title={t('foundation.citiesCardTitle')}>
        <MetricRow label={t('foundation.citiesCount')} value={String(CURATED_CITIES.length)} />
        <MetricRow
          label={t('foundation.selectedCity')}
          value={selectedCity ?? t('foundation.noCity')}
        />
      </Card>

      <Card title={t('foundation.datesCardTitle')}>
        <MetricRow
          label={t('foundation.eventDate')}
          value={formatEventDate(querySnapshot.nextEventAt, language)}
        />
        <MetricRow
          label={t('foundation.eventTime')}
          value={formatEventTime(querySnapshot.nextEventAt, language)}
        />
        <MetricRow
          label={t('foundation.relativeTime')}
          value={formatRelativeTime(querySnapshot.nextEventAt, language)}
        />
        <MetricRow
          label={t('foundation.chatTimestamp')}
          value={formatChatTimestamp(querySnapshot.lastChatAt, language)}
        />
      </Card>

      <Card title={t('foundation.buildCardTitle')} style={styles.lastCard}>
        <MetricRow label={t('foundation.version')} value={appMetadata.version} />
        <MetricRow
          label={t('foundation.iosBundleIdentifier')}
          value={appMetadata.iosBundleIdentifier}
        />
        <MetricRow label={t('foundation.androidPackage')} value={appMetadata.androidPackage} />
        <MetricRow
          label={t('foundation.termsVersion')}
          value={publicEnv.termsVersion || t('foundation.unsetValue')}
        />
        <MetricRow
          label={t('foundation.privacyVersion')}
          value={publicEnv.privacyVersion || t('foundation.unsetValue')}
        />
        <ActionButton
          label={t('foundation.sentryAction')}
          onPress={handleSentryTest}
          variant="secondary"
        />
        {sentryMessage ? <Text style={styles.supportingText}>{sentryMessage}</Text> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
  },
  heroCard: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: '#183153',
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    marginBottom: 18,
    backgroundColor: '#f5f1ea',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#f4cf8c',
  },
  heroTitle: {
    marginTop: 8,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#fff8f0',
  },
  heroSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 24,
    color: '#d2dde8',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
  },
  languageLabel: {
    marginTop: 18,
    fontSize: 13,
    fontWeight: '600',
    color: '#d2dde8',
  },
  card: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#eadfce',
    gap: 10,
  },
  lastCard: {
    marginBottom: 0,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#183153',
  },
  metricRow: {
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#8f6f45',
  },
  metricValue: {
    fontSize: 15,
    lineHeight: 22,
    color: '#31485a',
  },
  button: {
    minHeight: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: '#d45d37',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d9cbb6',
    backgroundColor: '#fffaf3',
  },
  buttonPressed: {
    opacity: 0.86,
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButtonLabel: {
    color: '#fffaf3',
  },
  secondaryButtonLabel: {
    color: '#183153',
  },
  supportingText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#51697a',
  },
});
