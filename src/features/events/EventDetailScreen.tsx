import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import { AvatarPhoto, InfoPill, SportBadge } from './EventPrimitives';
import { DetailRow, ScreenCard, ScreenShell } from '../../components/ScreenShell';
import { buildEventWebUrl } from '../../navigation/deep-links';
import type { RootStackParamList } from '../../navigation/types';
import { fetchConfirmedEventPlayers, fetchEventDetail } from '../../services/events';
import { useUserStore } from '../../store/user-store';
import { formatEventDate, formatEventTime } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;
type EventDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

function getSportBadgeLabel(slug: string, fallbackName: string): string {
  if (slug === 'badminton') {
    return 'BD';
  }

  if (slug === 'padel') {
    return 'PD';
  }

  if (slug === 'squash') {
    return 'SQ';
  }

  return fallbackName.slice(0, 2).toUpperCase();
}

export function EventDetailScreen({ route }: EventDetailScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const language = useUserStore((state) => state.language);
  const eventId = route.params.eventId;

  const eventQuery = useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: () => fetchEventDetail(eventId),
    staleTime: 10_000,
  });

  const playersQuery = useQuery({
    queryKey: ['events', 'detail', eventId, 'confirmed-players'],
    queryFn: () =>
      fetchConfirmedEventPlayers({
        eventId,
        sportId: eventQuery.data?.sportId ?? '',
      }),
    enabled: Boolean(eventQuery.data?.sportId),
    staleTime: 10_000,
  });

  async function handleShare() {
    if (!eventQuery.data) {
      return;
    }

    const event = eventQuery.data;
    const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
    const shareUrl = buildEventWebUrl(event.id);
    const shareDate = `${formatEventDate(event.startsAt, language)} · ${formatEventTime(
      event.startsAt,
      language,
    )}`;

    await Share.share({
      title: t('events.detail.shareAction'),
      url: shareUrl,
      message: t('events.detail.shareMessage', {
        sport: sportName,
        venue: event.venueName,
        date: shareDate,
        url: shareUrl,
      }),
    });
  }

  if (eventQuery.isPending) {
    return (
      <ScreenShell
        title={t('shell.eventDetail.title')}
        subtitle={t('events.detail.loadingSubtitle')}
      >
        <ScreenCard title={t('events.detail.loadingTitle')}>
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        </ScreenCard>
      </ScreenShell>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <ScreenShell title={t('shell.eventDetail.title')} subtitle={t('events.detail.errorSubtitle')}>
        <ScreenCard title={t('events.detail.errorTitle')}>
          <Text style={styles.bodyText}>{t('events.detail.errorBody')}</Text>
          <ActionButton
            label={t('events.common.retry')}
            onPress={async () => {
              await eventQuery.refetch();
            }}
          />
        </ScreenCard>
      </ScreenShell>
    );
  }

  const event = eventQuery.data;
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
  const organizerName = [event.organizerFirstName, event.organizerLastName]
    .filter(Boolean)
    .join(' ');
  const resolvedOrganizerName = organizerName || t('events.common.organizerFallback');
  const confirmedPlayers = playersQuery.data ?? [];
  const canOpenOrganizerProfile = Boolean(event.organizerId);

  return (
    <ScreenShell title={sportName} subtitle={event.venueName}>
      <ScreenCard>
        <View style={styles.heroHeader}>
          <View style={styles.heroIdentity}>
            <SportBadge
              colorHex={event.sportColor}
              label={getSportBadgeLabel(event.sportSlug, sportName)}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{sportName}</Text>
              <Text style={styles.heroSubtitle}>{event.venueName}</Text>
            </View>
          </View>
          <ActionButton label={t('events.detail.shareAction')} onPress={handleShare} />
        </View>

        <View style={styles.pillRow}>
          <InfoPill accentColor={event.sportColor}>
            {t(`events.reservationType.${event.reservationType}`)}
          </InfoPill>
          <InfoPill>
            {t('events.feed.spotsTaken', {
              current: event.spotsTaken,
              total: event.playerCountTotal,
            })}
          </InfoPill>
          <InfoPill>
            {t('events.feed.skillRange', { min: event.skillMin, max: event.skillMax })}
          </InfoPill>
        </View>
      </ScreenCard>

      <ScreenCard title={t('events.detail.whenWhereTitle')}>
        <DetailRow
          label={t('events.detail.dateTimeLabel')}
          value={`${formatEventDate(event.startsAt, language)} · ${formatEventTime(
            event.startsAt,
            language,
          )} - ${formatEventTime(event.endsAt, language)}`}
        />
        <DetailRow
          label={t('events.detail.venueLabel')}
          value={`${event.venueName} · ${event.city}`}
        />
        <DetailRow
          label={t('events.detail.addressLabel')}
          value={event.venueAddress ?? t('events.detail.addressFallback')}
        />
        <DetailRow
          label={t('events.detail.waitlistLabel')}
          value={t('events.feed.waitlistCount', { count: event.waitlistCount })}
        />
      </ScreenCard>

      <ScreenCard title={t('events.detail.skillTitle')}>
        <Text style={styles.bodyText}>
          {t('events.feed.skillRange', { min: event.skillMin, max: event.skillMax })}
        </Text>
        <Text style={styles.helperText}>{t('events.detail.skillRangeNote')}</Text>
      </ScreenCard>

      <ScreenCard title={t('events.detail.descriptionTitle')}>
        <Text style={styles.bodyText}>{event.description ?? t('events.detail.noDescription')}</Text>
      </ScreenCard>

      <ScreenCard title={t('events.detail.organizerTitle')}>
        <View style={styles.organizerRow}>
          <AvatarPhoto label={resolvedOrganizerName} uri={event.organizerPhotoUrl} size={54} />
          <View style={styles.organizerTextWrap}>
            <Text style={styles.organizerName}>{resolvedOrganizerName}</Text>
            <Text style={styles.bodyText}>
              {t('events.detail.organizerStats', {
                games: event.organizerGamesPlayed,
                noShows: event.organizerNoShows,
              })}
            </Text>
          </View>
        </View>
        {canOpenOrganizerProfile ? (
          <ActionButton
            label={t('events.detail.openOrganizerProfile')}
            onPress={() => navigation.navigate('PlayerProfile', { playerId: event.organizerId! })}
            variant="secondary"
          />
        ) : null}
      </ScreenCard>

      <ScreenCard title={t('events.detail.confirmedPlayersTitle')}>
        {playersQuery.isPending ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : confirmedPlayers.length ? (
          <View style={styles.playerList}>
            {confirmedPlayers.map((player) => {
              const playerName =
                [player.firstName, player.lastName].filter(Boolean).join(' ') ||
                t('events.common.organizerFallback');

              return (
                <Pressable
                  key={player.userId}
                  onPress={() => navigation.navigate('PlayerProfile', { playerId: player.userId })}
                  style={styles.playerCard}
                >
                  <AvatarPhoto label={playerName} uri={player.photoUrl} />
                  <View style={styles.playerCopy}>
                    <Text style={styles.playerName}>{playerName}</Text>
                    <Text style={styles.playerMeta}>
                      {player.skillLevel
                        ? t(`events.skillLevel.label.${player.skillLevel}`)
                        : t('events.detail.skillUnknown')}
                    </Text>
                  </View>
                  {player.skillLevel ? (
                    <InfoPill>{t(`events.skillLevel.short.${player.skillLevel}`)}</InfoPill>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.bodyText}>{t('events.detail.confirmedPlayersEmpty')}</Text>
        )}
      </ScreenCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  heroHeader: {
    gap: 14,
  },
  heroIdentity: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#5a6475',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#6d7f95',
  },
  organizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  organizerTextWrap: {
    flex: 1,
    gap: 4,
  },
  organizerName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  playerList: {
    gap: 10,
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf9',
    padding: 14,
  },
  playerCopy: {
    flex: 1,
    gap: 4,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  playerMeta: {
    fontSize: 13,
    color: '#5a6475',
  },
});
