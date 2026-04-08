import { useMemo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { DetailRow, ScreenCard, ScreenShell } from '../../components/ScreenShell';
import { ANDROID_UPDATE_URL, IOS_UPDATE_URL } from '../../constants/external-links';
import { buildChatSchemeUrl, buildEventSchemeUrl } from '../../navigation/deep-links';
import { fetchSharedEventDetailPublic } from '../../services/events';
import type { AppLanguage } from '../../types/app';
import { formatEventDate, formatEventTime } from '../../utils/dates';

type PublicEventFallbackScreenProps = {
  eventId: string;
  screen: 'detail' | 'chat';
};

function mapEventStatusLabel(
  status: 'active' | 'full' | 'finished' | 'cancelled',
  t: (key: string) => string,
): string {
  switch (status) {
    case 'active':
      return t('publicFallback.status.active');
    case 'full':
      return t('publicFallback.status.full');
    case 'finished':
      return t('publicFallback.status.finished');
    case 'cancelled':
      return t('publicFallback.status.cancelled');
  }
}

export function PublicEventFallbackScreen({ eventId, screen }: PublicEventFallbackScreenProps) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage === 'en' ? 'en' : 'cs') as AppLanguage;
  const hasAndroidStoreUrl = Boolean(ANDROID_UPDATE_URL);
  const query = useQuery({
    queryKey: ['public-share-event', eventId],
    queryFn: () => fetchSharedEventDetailPublic(eventId),
    staleTime: 30_000,
    retry: 1,
  });

  const event = query.data;
  const sportName = useMemo(() => {
    if (!event) {
      return '';
    }

    return language === 'en' ? event.sportNameEn : event.sportNameCs;
  }, [event, language]);

  if (query.isPending) {
    return (
      <ScreenShell
        subtitle={t('publicFallback.loadingSubtitle')}
        title={t('publicFallback.loadingTitle')}
      >
        <ScreenCard>
          <Text style={styles.bodyText}>{t('publicFallback.loadingBody')}</Text>
        </ScreenCard>
      </ScreenShell>
    );
  }

  if (query.isError || !event) {
    return (
      <ScreenShell
        subtitle={t('publicFallback.errorSubtitle')}
        title={t('publicFallback.errorTitle')}
      >
        <ScreenCard>
          <Text style={styles.bodyText}>{t('publicFallback.errorBody')}</Text>
          <Pressable
            accessibilityHint={t('publicFallback.retryHint')}
            accessibilityLabel={t('publicFallback.retry')}
            accessibilityRole="button"
            onPress={() => {
              void query.refetch();
            }}
            style={[styles.button, styles.primaryButton]}
          >
            <Text style={[styles.buttonLabel, styles.primaryButtonLabel]}>
              {t('publicFallback.retry')}
            </Text>
          </Pressable>
        </ScreenCard>
      </ScreenShell>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t('publicFallback.eyebrow')}</Text>
        <Text style={styles.title}>{sportName}</Text>
        <Text style={styles.subtitle}>
          {screen === 'chat'
            ? t('publicFallback.chatSubtitle')
            : t('publicFallback.detailSubtitle')}
        </Text>
      </View>

      <ScreenCard title={t('publicFallback.eventTitle')}>
        <View style={styles.badgeRow}>
          <View style={[styles.statusBadge, { backgroundColor: event.sportColor }]}>
            <Text style={styles.statusBadgeLabel}>{mapEventStatusLabel(event.status, t)}</Text>
          </View>
          <View style={styles.secondaryBadge}>
            <Text style={styles.secondaryBadgeLabel}>
              {t(`events.reservationType.${event.reservationType}`)}
            </Text>
          </View>
        </View>
        <DetailRow
          label={t('events.detail.dateTimeLabel')}
          value={`${formatEventDate(event.startsAt, language)} · ${formatEventTime(
            event.startsAt,
            language,
          )}-${formatEventTime(event.endsAt, language)}`}
        />
        <DetailRow label={t('events.detail.venueLabel')} value={event.venueName} />
        <DetailRow label={t('shell.common.cityLabel')} value={event.city} />
        <DetailRow
          label={t('publicFallback.playersLabel')}
          value={t('events.feed.spotsTaken', {
            current: event.spotsTaken,
            total: event.playerCountTotal,
          })}
        />
        <DetailRow
          label={t('events.detail.skillTitle')}
          value={t('events.feed.skillRange', {
            min: event.skillMin,
            max: event.skillMax,
          })}
        />
        {event.venueAddress ? (
          <DetailRow label={t('events.detail.addressLabel')} value={event.venueAddress} />
        ) : null}
        {event.description ? (
          <DetailRow label={t('events.detail.descriptionTitle')} value={event.description} />
        ) : null}
      </ScreenCard>

      <ScreenCard title={t('publicFallback.nextStepTitle')}>
        <Text style={styles.bodyText}>
          {screen === 'chat'
            ? t('publicFallback.chatBody')
            : t('publicFallback.detailBody', { sport: sportName })}
        </Text>
        <Pressable
          accessibilityHint={t('publicFallback.openInAppHint')}
          accessibilityLabel={t('publicFallback.openInApp')}
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(
              screen === 'chat' ? buildChatSchemeUrl(event.id) : buildEventSchemeUrl(event.id),
            );
          }}
          style={[styles.button, styles.primaryButton]}
        >
          <Text style={[styles.buttonLabel, styles.primaryButtonLabel]}>
            {t('publicFallback.openInApp')}
          </Text>
        </Pressable>
        <View style={styles.downloadRow}>
          <Pressable
            accessibilityHint={t('publicFallback.downloadHint')}
            accessibilityLabel={t('publicFallback.downloadIos')}
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(IOS_UPDATE_URL);
            }}
            style={[styles.button, styles.secondaryButton]}
          >
            <Text style={styles.buttonLabel}>{t('publicFallback.downloadIos')}</Text>
          </Pressable>
          {hasAndroidStoreUrl ? (
            <Pressable
              accessibilityHint={t('publicFallback.downloadHint')}
              accessibilityLabel={t('publicFallback.downloadAndroid')}
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(ANDROID_UPDATE_URL);
              }}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.buttonLabel}>{t('publicFallback.downloadAndroid')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScreenCard>
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
  hero: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: '#183153',
    gap: 8,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#d2dde8',
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#fff8f0',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 24,
    color: '#d2dde8',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusBadgeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff8f0',
  },
  secondaryBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f0e6d8',
  },
  secondaryBadgeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#395065',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#395065',
  },
  button: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: '#183153',
  },
  primaryButtonLabel: {
    color: '#fff8f0',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#f0e6d8',
  },
  buttonLabel: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  downloadRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
