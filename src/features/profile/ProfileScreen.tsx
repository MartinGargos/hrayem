import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { AvatarPhoto, SportBadge } from '../events/EventPrimitives';
import { SkillLevelModal } from '../events/SkillLevelModal';
import { ReportSheet } from '../reports/ReportSheet';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import {
  fetchPlayAgainConnections,
  fetchPlayerSportStats,
  fetchSharedFinishedEventsWithPlayer,
  fetchVisibleProfile,
  upsertOwnSportProfile,
} from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage, AppNotice } from '../../types/app';
import type {
  PlayAgainConnection,
  PlayerSportStat,
  SharedPlayerEvent,
  SportSummary,
} from '../../types/events';
import { formatEventCompactDate, formatYear } from '../../utils/dates';
import { formatDisplayName } from '../../utils/people';
import { translatePlural } from '../../utils/pluralization';

type RootNavigation = NavigationProp<RootStackParamList>;
type PlayerProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'PlayerProfile'>;

function groupConnectionsBySport(connections: PlayAgainConnection[]) {
  return connections.reduce<Record<string, PlayAgainConnection[]>>((groups, connection) => {
    const nextGroup = groups[connection.sportId] ?? [];
    nextGroup.push(connection);
    groups[connection.sportId] = nextGroup;
    return groups;
  }, {});
}

function getSportBadgeLabel(slug: string, fallbackName: string) {
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

function ProfileHeroAvatar({ fullName, photoUrl }: { fullName: string; photoUrl?: string | null }) {
  const fallback = fullName.trim().slice(0, 1).toUpperCase() || '?';

  if (photoUrl) {
    return <AvatarPhoto label={fullName} size={66} uri={photoUrl} />;
  }

  return (
    <View accessibilityLabel={fullName} style={styles.profileHeroAvatar}>
      <Text style={styles.profileHeroAvatarText}>{fallback}</Text>
    </View>
  );
}

function ProfileMetricCard({
  label,
  tone = 'default',
  value,
}: {
  label: string;
  tone?: 'default' | 'lime' | 'mint';
  value: string;
}) {
  return (
    <View style={styles.profileMetricCard}>
      <Text
        style={[
          styles.profileMetricValue,
          tone === 'lime' ? styles.profileMetricValueLime : undefined,
          tone === 'mint' ? styles.profileMetricValueMint : undefined,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.profileMetricLabel}>{label}</Text>
    </View>
  );
}

function ProfileHeroCard({
  cityLabel,
  fullName,
  languageLabel,
  metrics,
  onOpenSettings,
  photoUrl,
}: {
  cityLabel: string;
  fullName: string;
  languageLabel: string;
  metrics: {
    label: string;
    tone?: 'default' | 'lime' | 'mint';
    value: string;
  }[];
  onOpenSettings: () => void;
  photoUrl?: string | null;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.profileHeroCard}>
      <View pointerEvents="none" style={styles.profileHeroGrid}>
        <View style={[styles.profileHeroGridLine, styles.profileHeroGridLineVerticalOne]} />
        <View style={[styles.profileHeroGridLine, styles.profileHeroGridLineVerticalTwo]} />
        <View style={[styles.profileHeroGridLine, styles.profileHeroGridLineHorizontal]} />
      </View>
      <View style={styles.profileHeroTopRow}>
        <View style={styles.profileHeroIdentity}>
          <ProfileHeroAvatar fullName={fullName} photoUrl={photoUrl} />
          <View style={styles.profileHeroCopy}>
            <Text numberOfLines={1} style={styles.profileHeroName}>
              {fullName}
            </Text>
            <View style={styles.profileHeroMetaRow}>
              <Ionicons color="#b8c5d5" name="location-outline" size={13} />
              <Text numberOfLines={1} style={styles.profileHeroMeta}>
                {cityLabel} · {languageLabel}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          accessibilityHint={t('shell.profile.openSettings')}
          accessibilityLabel={t('shell.profile.openSettings')}
          accessibilityRole="button"
          onPress={onOpenSettings}
          style={({ pressed }) => [
            styles.profileSettingsButton,
            pressed ? styles.profileSettingsButtonPressed : undefined,
          ]}
        >
          <Ionicons color="#ffffff" name="settings-outline" size={17} />
        </Pressable>
      </View>

      <View style={styles.profileMetricRow}>
        {metrics.map((metric) => (
          <ProfileMetricCard
            key={metric.label}
            label={metric.label}
            tone={metric.tone}
            value={metric.value}
          />
        ))}
      </View>
    </View>
  );
}

function ProfileSportStatCard({ onPress, stat }: { onPress: () => void; stat: PlayerSportStat }) {
  const { t } = useTranslation();
  const language = useUserStore((state) => state.language);
  const sportName = language === 'cs' ? stat.sportNameCs : stat.sportNameEn;
  const hasFinishedGames = stat.gamesPlayed > 0;
  const hasRecommendationSignal = hasFinishedGames && stat.thumbsUpPercentage !== null;
  const reliabilityText = translatePlural(t, language, 'profile.stats.noShows', stat.noShows);
  const thumbsText = hasRecommendationSignal
    ? t('profile.stats.thumbsValue', {
        percentage: stat.thumbsUpPercentage,
      })
    : null;

  return (
    <Pressable
      accessibilityHint={t('profile.skillEditHint')}
      accessibilityLabel={`${sportName} ${t(`events.skillLevel.label.${stat.skillLevel}`)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileSportCard,
        pressed ? styles.profileSportCardPressed : undefined,
      ]}
    >
      <View style={styles.profileSportTopRow}>
        <View style={styles.profileSportIdentity}>
          <SportBadge
            colorHex={stat.sportColor}
            label={getSportBadgeLabel(stat.sportSlug, sportName)}
          />
          <View style={styles.profileSportCopy}>
            <Text numberOfLines={1} style={styles.profileSportName}>
              {sportName}
            </Text>
            {hasFinishedGames ? (
              <Text style={styles.profileSportMeta}>
                {translatePlural(
                  t,
                  language,
                  'profile.stats.compactGamesAndHours',
                  stat.gamesPlayed,
                  {
                    games: stat.gamesPlayed,
                    hours: stat.hoursPlayed.toFixed(1),
                  },
                )}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.profileSportActionRow}>
          <View style={styles.profileSkillPill}>
            <Text numberOfLines={1} style={styles.profileSkillPillLabel}>
              {t(`events.skillLevel.label.${stat.skillLevel}`)}
            </Text>
          </View>
          <Ionicons color="#b7c0cc" name="chevron-forward" size={17} />
        </View>
      </View>

      {hasFinishedGames ? (
        <>
          <View style={styles.profileSportDivider} />

          <View style={styles.profileSportSummaryRow}>
            <View style={styles.profileSportSummaryCol}>
              <Text style={styles.profileSportSummaryLabel}>
                {t('profile.stats.reliabilityLabel')}
              </Text>
              <Text style={styles.profileSportSummaryValue}>{reliabilityText}</Text>
            </View>
            {thumbsText ? (
              <View style={styles.profileSportSummaryCol}>
                <Text style={styles.profileSportSummaryLabel}>
                  {t('profile.stats.feedbackLabel')}
                </Text>
                <Text style={styles.profileSportSummaryValue}>{thumbsText}</Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

function ProfileConnectionsPanel({
  groupedConnections,
  isError,
  isPending,
  language,
  navigation,
  onRetry,
}: {
  groupedConnections: Record<string, PlayAgainConnection[]>;
  isError: boolean;
  isPending: boolean;
  language: AppLanguage;
  navigation: RootNavigation;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const groupedValues = Object.values(groupedConnections);

  if (isPending) {
    return (
      <View style={styles.profileNetworkCard}>
        <View style={styles.centeredBlock}>
          <ActivityIndicator color="#183153" />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.profileNetworkCard}>
        <StateMessage
          action={
            <ActionButton
              iconName="refresh-outline"
              label={t('events.common.retry')}
              onPress={onRetry}
              variant="secondary"
            />
          }
          body={t('profile.errors.connections')}
          compact
          iconName="people-outline"
          title={t('common.tryAgainTitle')}
          tone="muted"
        />
      </View>
    );
  }

  if (!groupedValues.length) {
    return (
      <View style={styles.profileNetworkEmptyCard}>
        <View style={styles.profileNetworkEmptyIcon}>
          <Ionicons color="#10233f" name="heart-outline" size={23} />
        </View>
        <Text style={styles.profileNetworkEmptyTitle}>{t('profile.connectionsEmptyTitle')}</Text>
        <Text style={styles.profileNetworkEmptyBody}>{t('profile.connectionsEmpty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.profileNetworkCard}>
      {groupedValues.map((connections) => {
        const firstConnection = connections[0];

        if (!firstConnection) {
          return null;
        }

        const sportName =
          language === 'cs' ? firstConnection.sportNameCs : firstConnection.sportNameEn;

        return (
          <View
            key={`connections-${firstConnection.sportId}`}
            style={styles.profileConnectionGroup}
          >
            <View style={styles.profileConnectionGroupHeader}>
              <SportBadge
                colorHex={firstConnection.sportColor}
                label={getSportBadgeLabel(firstConnection.sportSlug, sportName)}
              />
              <View style={styles.profileConnectionGroupCopy}>
                <Text style={styles.profileConnectionGroupTitle}>{sportName}</Text>
                <Text style={styles.profileConnectionGroupMeta}>
                  {translatePlural(
                    t,
                    language,
                    'profile.connectionsGroupCount',
                    connections.length,
                  )}
                </Text>
              </View>
            </View>
            {connections.map((connection) => {
              const connectionName =
                formatDisplayName(connection.firstName, connection.lastName) ||
                t('auth.home.defaultName');

              return (
                <Pressable
                  accessibilityHint={t('events.detail.openPlayerProfileHint')}
                  accessibilityLabel={connectionName}
                  accessibilityRole="button"
                  key={`${connection.connectionUserId}-${connection.sportId}`}
                  onPress={() =>
                    navigation.navigate('PlayerProfile', {
                      playerId: connection.connectionUserId,
                    })
                  }
                  style={({ pressed }) => [
                    styles.profileConnectionRow,
                    pressed ? styles.profileConnectionRowPressed : undefined,
                  ]}
                >
                  <AvatarPhoto label={connectionName} uri={connection.photoUrl} />
                  <View style={styles.profileConnectionCopy}>
                    <Text style={styles.profileConnectionName}>{connectionName}</Text>
                    <Text style={styles.profileConnectionMeta}>
                      {translatePlural(
                        t,
                        language,
                        'profile.stats.compactGamesAndHours',
                        connection.gamesPlayed,
                        {
                          games: connection.gamesPlayed,
                          hours: connection.hoursPlayed.toFixed(1),
                        },
                      )}
                    </Text>
                  </View>
                  <Ionicons color="#9aacbd" name="chevron-forward" size={18} />
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const isScreenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.userId);
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [selectedStat, setSelectedStat] = useState<PlayerSportStat | null>(null);
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<number | null>(null);

  const statsQuery = useQuery({
    queryKey: ['profile', 'stats', userId],
    queryFn: () => fetchPlayerSportStats(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  const connectionsQuery = useQuery({
    queryKey: ['profile', 'connections', userId],
    queryFn: fetchPlayAgainConnections,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  const updateSkillMutation = useMutation({
    mutationFn: async (input: { sportId: string; skillLevel: number }) => {
      if (!userId) {
        throw new Error('Missing user id.');
      }

      return upsertOwnSportProfile({
        userId,
        sportId: input.sportId,
        skillLevel: input.skillLevel,
      });
    },
    onSuccess: async () => {
      setNotice({
        messageKey: 'profile.skillUpdated',
        tone: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['user-sports', userId] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'detail'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
      ]);
    },
    onError: () => {
      setNotice({
        messageKey: 'profile.skillUpdateFailed',
        tone: 'error',
      });
    },
  });

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const groupedConnections = useMemo(
    () => groupConnectionsBySport(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );
  const totalSports = statsQuery.data?.length ?? 0;
  const totalGames = (statsQuery.data ?? []).reduce((sum, stat) => sum + stat.gamesPlayed, 0);
  const totalHours = (statsQuery.data ?? []).reduce((sum, stat) => sum + stat.hoursPlayed, 0);
  const roundedTotalHours = Math.round(totalHours);
  const languageLabel = t(`auth.language.${profile?.language ?? language}`);
  const resolvedFullName = fullName || t('auth.home.defaultName');
  const profileHighlights = [
    {
      label: translatePlural(t, language, 'profile.highlights.sports', totalSports),
      value: statsQuery.isPending || statsQuery.isError ? '—' : String(totalSports),
    },
    {
      label: translatePlural(t, language, 'profile.highlights.games', totalGames),
      value: statsQuery.isPending || statsQuery.isError ? '—' : String(totalGames),
    },
    {
      label: translatePlural(t, language, 'profile.highlights.hours', roundedTotalHours),
      value: statsQuery.isPending || statsQuery.isError ? '—' : `${roundedTotalHours}h`,
    },
  ];

  function handleOpenSkillEditor(stat: PlayerSportStat) {
    setSelectedStat(stat);
    setSelectedSkillLevel(stat.skillLevel);
  }

  async function handleConfirmSkillLevel() {
    if (!selectedStat || !selectedSkillLevel) {
      setSelectedStat(null);
      return;
    }

    await updateSkillMutation.mutateAsync({
      sportId: selectedStat.sportId,
      skillLevel: selectedSkillLevel,
    });
    setSelectedStat(null);
  }

  const modalSport: SportSummary | null = selectedStat
    ? {
        id: selectedStat.sportId,
        slug: selectedStat.sportSlug,
        nameCs: selectedStat.sportNameCs,
        nameEn: selectedStat.sportNameEn,
        iconName: selectedStat.sportIcon,
        colorHex: selectedStat.sportColor,
        sortOrder: 0,
      }
    : null;
  const profileBottomPadding = Math.max(insets.bottom, 16) + 154;

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.profileContent,
          {
            paddingTop: insets.top + 18,
            paddingBottom: profileBottomPadding,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.profileScreen}
      >
        {isScreenFocused ? <StatusBar style="dark" /> : null}
        <Text style={styles.profileScreenTitle}>{t('navigation.titles.profile')}</Text>

        <ProfileHeroCard
          cityLabel={profile?.city ?? t('shell.common.noCity')}
          fullName={resolvedFullName}
          languageLabel={languageLabel}
          metrics={profileHighlights}
          onOpenSettings={() => navigation.navigate('Settings')}
          photoUrl={profile?.photoUrl ?? null}
        />

        <NoticeBanner notice={notice} resolveMessage={t} />

        <View style={styles.profileSection}>
          <Text style={styles.profileSectionTitle}>{t('profile.statsSectionTitle')}</Text>
          {statsQuery.isPending ? (
            <View style={styles.profileStateCard}>
              <View style={styles.centeredBlock}>
                <ActivityIndicator color="#183153" />
              </View>
            </View>
          ) : statsQuery.isError ? (
            <View style={styles.profileStateCard}>
              <StateMessage
                action={
                  <ActionButton
                    iconName="refresh-outline"
                    label={t('events.common.retry')}
                    onPress={async () => {
                      await statsQuery.refetch();
                    }}
                    variant="secondary"
                  />
                }
                body={t('profile.errors.stats')}
                compact
                iconName="bar-chart-outline"
                title={t('common.tryAgainTitle')}
                tone="muted"
              />
            </View>
          ) : statsQuery.data?.length ? (
            <View style={styles.profileSportStack}>
              {statsQuery.data.map((stat) => (
                <ProfileSportStatCard
                  key={`${stat.userId}-${stat.sportId}`}
                  onPress={() => handleOpenSkillEditor(stat)}
                  stat={stat}
                />
              ))}
            </View>
          ) : (
            <View style={styles.profileStateCard}>
              <StateMessage
                body={t('profile.statsEmpty')}
                compact
                iconName="sparkles-outline"
                title={t('common.nothingYet')}
                tone="warm"
              />
            </View>
          )}
        </View>

        <View style={styles.profileSection}>
          <Text style={styles.profileSectionTitle}>{t('profile.connectionsSectionTitle')}</Text>
          <ProfileConnectionsPanel
            groupedConnections={groupedConnections}
            isError={connectionsQuery.isError}
            isPending={connectionsQuery.isPending}
            language={language}
            navigation={navigation}
            onRetry={() => {
              void connectionsQuery.refetch();
            }}
          />
        </View>
      </ScrollView>

      <SkillLevelModal
        language={language}
        onClose={() => setSelectedStat(null)}
        onConfirm={handleConfirmSkillLevel}
        onSelectSkillLevel={setSelectedSkillLevel}
        selectedSkillLevel={selectedSkillLevel}
        sport={modalSport}
        subtitleKey="profile.skillModalSubtitle"
        visible={Boolean(selectedStat)}
      />
    </>
  );
}

function getTopPlayerStat(stats: PlayerSportStat[]): PlayerSportStat | null {
  return (
    [...stats].sort((left, right) => {
      if (right.gamesPlayed !== left.gamesPlayed) {
        return right.gamesPlayed - left.gamesPlayed;
      }

      return right.hoursPlayed - left.hoursPlayed;
    })[0] ?? null
  );
}

function getReliabilityPercentage(stat: PlayerSportStat | null): number | null {
  if (!stat || stat.gamesPlayed <= 0) {
    return null;
  }

  const reliability = ((stat.gamesPlayed - stat.noShows) / stat.gamesPlayed) * 100;
  return Math.max(0, Math.min(100, Math.round(reliability)));
}

function PlayerProfileAvatar({
  fullName,
  photoUrl,
}: {
  fullName: string;
  photoUrl?: string | null;
}) {
  const fallback = fullName.trim().slice(0, 1).toUpperCase() || '?';

  if (photoUrl) {
    return (
      <View style={styles.playerAvatarPhotoWrap}>
        <AvatarPhoto label={fullName} size={74} uri={photoUrl} />
      </View>
    );
  }

  return (
    <View accessibilityLabel={fullName} style={styles.playerAvatarFallback}>
      <Text style={styles.playerAvatarFallbackText}>{fallback}</Text>
    </View>
  );
}

function PlayerMetricCard({
  label,
  tone = 'default',
  value,
}: {
  label: string;
  tone?: 'default' | 'lime';
  value: string;
}) {
  return (
    <View style={styles.playerMetricCard}>
      <Text
        style={[
          styles.playerMetricValue,
          tone === 'lime' ? styles.playerMetricValueLime : undefined,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.playerMetricLabel}>{label}</Text>
    </View>
  );
}

function PlayerStatPill({ label }: { label: string }) {
  return (
    <View style={styles.playerStatPill}>
      <Text numberOfLines={1} style={styles.playerStatPillLabel}>
        {label}
      </Text>
    </View>
  );
}

function PlayerHeroCard({
  city,
  createdAt,
  fullName,
  language,
  metrics,
  photoUrl,
  primaryStat,
}: {
  city: string | null;
  createdAt: string | null;
  fullName: string;
  language: AppLanguage;
  metrics: {
    label: string;
    tone?: 'default' | 'lime';
    value: string;
  }[];
  photoUrl?: string | null;
  primaryStat: PlayerSportStat | null;
}) {
  const { t } = useTranslation();
  const sportName = primaryStat
    ? language === 'cs'
      ? primaryStat.sportNameCs
      : primaryStat.sportNameEn
    : null;
  const reliability = getReliabilityPercentage(primaryStat);

  return (
    <View style={styles.playerHeroCard}>
      <View pointerEvents="none" style={styles.playerHeroGrid}>
        <View style={[styles.playerHeroGridLine, styles.playerHeroGridLineVerticalOne]} />
        <View style={[styles.playerHeroGridLine, styles.playerHeroGridLineVerticalTwo]} />
        <View style={[styles.playerHeroGridLine, styles.playerHeroGridLineHorizontal]} />
      </View>
      <PlayerProfileAvatar fullName={fullName} photoUrl={photoUrl} />
      <Text numberOfLines={1} style={styles.playerHeroName}>
        {fullName}
      </Text>
      <Text numberOfLines={1} style={styles.playerHeroMeta}>
        {city ?? t('shell.common.noCity')}
        {createdAt
          ? ` · ${t('playerProfile.memberSince', {
              year: formatYear(createdAt, language),
            })}`
          : ''}
      </Text>

      <View style={styles.playerHeroPillRow}>
        <PlayerStatPill
          label={
            primaryStat && sportName
              ? t('playerProfile.skillBadge', {
                  sport: sportName,
                  level: t(`events.skillLevel.label.${primaryStat.skillLevel}`),
                })
              : t('playerProfile.noSportBadge')
          }
        />
        <PlayerStatPill
          label={
            reliability === null
              ? t('playerProfile.reliabilityHidden')
              : t('playerProfile.reliabilityBadge', {
                  percentage: reliability,
                })
          }
        />
      </View>

      <View style={styles.playerMetricRow}>
        {metrics.map((metric) => (
          <PlayerMetricCard
            key={metric.label}
            label={metric.label}
            tone={metric.tone}
            value={metric.value}
          />
        ))}
      </View>
    </View>
  );
}

function PlayerActionRow({ onInvite, onMessage }: { onInvite: () => void; onMessage: () => void }) {
  const { t } = useTranslation();

  return (
    <View style={styles.playerActionRow}>
      <Pressable
        accessibilityHint={t('playerProfile.inviteAction')}
        accessibilityLabel={t('playerProfile.inviteAction')}
        accessibilityRole="button"
        onPress={onInvite}
        style={({ pressed }) => [
          styles.playerInviteButton,
          pressed ? styles.playerInviteButtonPressed : undefined,
        ]}
      >
        <Text style={styles.playerInviteButtonLabel}>{t('playerProfile.inviteAction')}</Text>
      </Pressable>
      <Pressable
        accessibilityHint={t('playerProfile.messageAction')}
        accessibilityLabel={t('playerProfile.messageAction')}
        accessibilityRole="button"
        onPress={onMessage}
        style={({ pressed }) => [
          styles.playerMessageButton,
          pressed ? styles.playerMessageButtonPressed : undefined,
        ]}
      >
        <Ionicons color="#06142a" name="chatbox-outline" size={23} />
      </Pressable>
    </View>
  );
}

function SharedGameRow({
  event,
  language,
  onPress,
}: {
  event: SharedPlayerEvent;
  language: AppLanguage;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;

  return (
    <Pressable
      accessibilityHint={t('events.detail.openEventHint', {
        sport: sportName,
        venue: event.venueName,
      })}
      accessibilityLabel={event.venueName}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sharedGameRow,
        pressed ? styles.sharedGameRowPressed : undefined,
      ]}
    >
      <SportBadge
        colorHex={event.sportColor}
        label={getSportBadgeLabel(event.sportSlug, sportName)}
      />
      <View style={styles.sharedGameCopy}>
        <Text numberOfLines={2} style={styles.sharedGameTitle}>
          {event.venueName}
        </Text>
        <Text numberOfLines={1} style={styles.sharedGameMeta}>
          {formatEventCompactDate(event.startsAt, language)} · {sportName}
        </Text>
      </View>
      <View style={styles.sharedGameBadge}>
        <Text style={styles.sharedGameBadgeText}>{t('playerProfile.sharedPlayedBadge')}</Text>
      </View>
    </Pressable>
  );
}

function PlayerStatsTable({ primaryStat }: { primaryStat: PlayerSportStat | null }) {
  const { t } = useTranslation();
  const language = useUserStore((state) => state.language);
  const sportName = primaryStat
    ? language === 'cs'
      ? primaryStat.sportNameCs
      : primaryStat.sportNameEn
    : t('playerProfile.noPrimarySport');
  const reliability = getReliabilityPercentage(primaryStat);

  const rows = [
    {
      label: t('playerProfile.stats.level'),
      value: primaryStat
        ? t('playerProfile.stats.levelValue', {
            level: t(`events.skillLevel.label.${primaryStat.skillLevel}`),
            short: t(`events.skillLevel.short.${primaryStat.skillLevel}`),
          })
        : '—',
    },
    {
      label: t('playerProfile.stats.games'),
      value: primaryStat ? String(primaryStat.gamesPlayed) : '—',
    },
    {
      label: t('playerProfile.stats.reliability'),
      value:
        reliability === null
          ? '—'
          : t('playerProfile.percentageValue', {
              percentage: reliability,
            }),
    },
    {
      label: t('playerProfile.stats.recommendations'),
      value:
        primaryStat?.thumbsUpPercentage === null || !primaryStat
          ? '—'
          : t('playerProfile.stats.recommendationValue', {
              percentage: primaryStat.thumbsUpPercentage,
            }),
    },
  ];

  return (
    <View style={styles.playerSection}>
      <Text style={styles.playerSectionEyebrow}>{t('playerProfile.statsEyebrow')}</Text>
      <Text style={styles.playerSectionTitle}>{sportName}</Text>
      <View style={styles.playerStatsCard}>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={[
              styles.playerStatsRow,
              index < rows.length - 1 ? styles.playerStatsRowBorder : null,
            ]}
          >
            <Text style={styles.playerStatsLabel}>{row.label}</Text>
            <Text numberOfLines={1} style={styles.playerStatsValue}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PlayerProfileScreen({ route }: PlayerProfileScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const isScreenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const playerId = route.params.playerId;
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [isReportSheetVisible, setIsReportSheetVisible] = useState(false);
  const language = useUserStore((state) => state.language);

  const profileQuery = useQuery({
    queryKey: ['profile', 'player', playerId, 'summary'],
    queryFn: () => fetchVisibleProfile(playerId),
    staleTime: 30_000,
  });

  const statsQuery = useQuery({
    queryKey: ['profile', 'player', playerId, 'stats'],
    queryFn: () => fetchPlayerSportStats(playerId),
    staleTime: 30_000,
  });

  const sharedGamesQuery = useQuery({
    queryKey: ['profile', 'player', playerId, 'shared-events'],
    queryFn: () => fetchSharedFinishedEventsWithPlayer(playerId),
    staleTime: 30_000,
  });

  const topLineName =
    formatDisplayName(profileQuery.data?.first_name, profileQuery.data?.last_name) ||
    t('common.deletedUser');
  const primaryStat = getTopPlayerStat(statsQuery.data ?? []);
  const totalGames = (statsQuery.data ?? []).reduce((sum, stat) => sum + stat.gamesPlayed, 0);
  const playerMetrics = [
    {
      label: t('playerProfile.metrics.games'),
      value:
        statsQuery.isPending || statsQuery.isError
          ? '—'
          : String(primaryStat?.gamesPlayed ?? totalGames),
    },
    {
      label: t('playerProfile.metrics.together'),
      tone: 'lime' as const,
      value:
        sharedGamesQuery.isPending || sharedGamesQuery.isError
          ? '—'
          : String(sharedGamesQuery.data?.length ?? 0),
    },
    {
      label: t('playerProfile.metrics.recommended'),
      value:
        statsQuery.isPending ||
        statsQuery.isError ||
        primaryStat?.thumbsUpPercentage === null ||
        !primaryStat
          ? '—'
          : t('playerProfile.percentageValue', {
              percentage: primaryStat.thumbsUpPercentage,
            }),
    },
  ];

  const canReportPlayer = Boolean(
    !profileQuery.isPending && !profileQuery.isError && profileQuery.data,
  );

  const handleOpenReportMenu = useCallback(() => {
    if (!canReportPlayer) {
      return;
    }

    setNotice(null);
    Alert.alert(t('reports.menuTitle'), undefined, [
      {
        text: t('reports.reportPlayerAction'),
        onPress: () => setIsReportSheetVisible(true),
      },
      {
        text: t('events.common.cancel'),
        style: 'cancel',
      },
    ]);
  }, [canReportPlayer, t]);

  const bottomPadding = Math.max(insets.bottom, 16) + 154;

  function handleGoBack() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'HomeTab',
      params: {
        screen: 'HomeFeed',
      },
    });
  }

  function handleInvitePlayer() {
    Alert.alert(
      t('playerProfile.inviteUnavailableTitle'),
      t('playerProfile.inviteUnavailableBody'),
    );
  }

  function handleOpenMessage() {
    Alert.alert(
      t('playerProfile.messageUnavailableTitle'),
      t('playerProfile.messageUnavailableBody'),
    );
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.playerContent,
          {
            paddingTop: insets.top + 14,
            paddingBottom: bottomPadding,
          },
        ]}
        showsVerticalScrollIndicator={false}
        style={styles.playerScreen}
      >
        {isScreenFocused ? <StatusBar style="dark" /> : null}
        <View style={styles.playerTopBar}>
          <Pressable
            accessibilityHint={t('playerProfile.backAction')}
            accessibilityLabel={t('playerProfile.backAction')}
            accessibilityRole="button"
            onPress={handleGoBack}
            style={({ pressed }) => [
              styles.playerBackButton,
              pressed ? styles.playerBackButtonPressed : undefined,
            ]}
          >
            <Ionicons color="#06142a" name="chevron-back" size={26} />
          </Pressable>
          <Text style={styles.playerTopBarTitle}>{t('playerProfile.title')}</Text>
          <Pressable
            accessibilityHint={t('reports.reportPlayerAction')}
            accessibilityLabel={t('reports.overflowLabel')}
            accessibilityRole="button"
            disabled={!canReportPlayer}
            onPress={handleOpenReportMenu}
            style={({ pressed }) => [
              styles.playerOverflowButton,
              !canReportPlayer ? styles.playerOverflowButtonDisabled : undefined,
              pressed && canReportPlayer ? styles.playerOverflowButtonPressed : undefined,
            ]}
          >
            <Ionicons color="#06142a" name="ellipsis-horizontal" size={22} />
          </Pressable>
        </View>

        <NoticeBanner notice={notice} resolveMessage={t} />

        {profileQuery.isPending ? (
          <View style={styles.playerStateCard}>
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          </View>
        ) : profileQuery.isError || !profileQuery.data ? (
          <View style={styles.playerStateCard}>
            <StateMessage
              action={
                <ActionButton
                  iconName="refresh-outline"
                  label={t('events.common.retry')}
                  onPress={async () => {
                    await profileQuery.refetch();
                  }}
                  variant="secondary"
                />
              }
              body={t('playerProfile.errors.summary')}
              compact
              iconName="person-outline"
              title={t('playerProfile.summaryTitle')}
              tone="muted"
            />
          </View>
        ) : (
          <>
            <PlayerHeroCard
              city={profileQuery.data.city}
              createdAt={profileQuery.data.created_at}
              fullName={topLineName}
              language={language}
              metrics={playerMetrics}
              photoUrl={profileQuery.data.photo_url}
              primaryStat={primaryStat}
            />

            <PlayerActionRow onInvite={handleInvitePlayer} onMessage={handleOpenMessage} />

            <View style={styles.playerSection}>
              <Text style={styles.playerSectionEyebrow}>{t('playerProfile.sharedEyebrow')}</Text>
              <Text style={styles.playerSectionTitle}>
                {translatePlural(
                  t,
                  language,
                  'playerProfile.sharedTitle',
                  sharedGamesQuery.data?.length ?? 0,
                )}
              </Text>
              <View style={styles.sharedGamesCard}>
                {sharedGamesQuery.isPending ? (
                  <View style={styles.centeredBlock}>
                    <ActivityIndicator color="#183153" />
                  </View>
                ) : sharedGamesQuery.isError ? (
                  <StateMessage
                    action={
                      <ActionButton
                        iconName="refresh-outline"
                        label={t('events.common.retry')}
                        onPress={async () => {
                          await sharedGamesQuery.refetch();
                        }}
                        variant="secondary"
                      />
                    }
                    body={t('playerProfile.errors.sharedGames')}
                    compact
                    iconName="list-outline"
                    title={t('common.tryAgainTitle')}
                    tone="muted"
                  />
                ) : sharedGamesQuery.data?.length ? (
                  sharedGamesQuery.data.map((event, index, events) => (
                    <View key={event.id}>
                      <SharedGameRow
                        event={event}
                        language={language}
                        onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
                      />
                      {index < events.length - 1 ? <View style={styles.sharedGameDivider} /> : null}
                    </View>
                  ))
                ) : (
                  <Text style={styles.sharedGamesEmpty}>{t('playerProfile.sharedEmpty')}</Text>
                )}
              </View>
            </View>

            {statsQuery.isError ? (
              <View style={styles.playerStateCard}>
                <StateMessage
                  action={
                    <ActionButton
                      iconName="refresh-outline"
                      label={t('events.common.retry')}
                      onPress={async () => {
                        await statsQuery.refetch();
                      }}
                      variant="secondary"
                    />
                  }
                  body={t('playerProfile.errors.stats')}
                  compact
                  iconName="bar-chart-outline"
                  title={t('common.tryAgainTitle')}
                  tone="muted"
                />
              </View>
            ) : (
              <PlayerStatsTable primaryStat={statsQuery.isPending ? null : primaryStat} />
            )}
          </>
        )}
      </ScrollView>
      <ReportSheet
        onClose={() => setIsReportSheetVisible(false)}
        onSubmitted={setNotice}
        target={{
          type: 'player',
          playerId,
          title: topLineName,
        }}
        visible={isReportSheetVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  playerScreen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  playerContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  playerTopBar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerBackButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#efe2d1',
  },
  playerBackButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: '#fbf8f2',
  },
  playerTopBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    color: '#06142a',
  },
  playerOverflowButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#efe2d1',
  },
  playerOverflowButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: '#fbf8f2',
  },
  playerOverflowButtonDisabled: {
    opacity: 0.45,
  },
  playerHeroCard: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    backgroundColor: '#07162a',
  },
  playerHeroGrid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.7,
  },
  playerHeroGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(185, 205, 230, 0.12)',
  },
  playerHeroGridLineVerticalOne: {
    top: 0,
    bottom: 0,
    left: '48%',
    width: 1,
  },
  playerHeroGridLineVerticalTwo: {
    top: 0,
    bottom: 0,
    left: '76%',
    width: 1,
  },
  playerHeroGridLineHorizontal: {
    top: 118,
    left: 0,
    right: 0,
    height: 1,
  },
  playerAvatarPhotoWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff39',
  },
  playerAvatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5b9cff',
    borderWidth: 3,
    borderColor: '#d8ff39',
  },
  playerAvatarFallbackText: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    color: '#ffffff',
  },
  playerHeroName: {
    marginTop: 14,
    maxWidth: '100%',
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    color: '#ffffff',
  },
  playerHeroMeta: {
    marginTop: 4,
    maxWidth: '100%',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 17,
    color: '#b8c5d5',
  },
  playerHeroPillRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  playerStatPill: {
    maxWidth: 164,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  playerStatPillLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#ffffff',
  },
  playerMetricRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  playerMetricCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  playerMetricValue: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: '#ffffff',
  },
  playerMetricValueLime: {
    color: '#d8ff39',
  },
  playerMetricLabel: {
    marginTop: 4,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#b8c5d5',
  },
  playerActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  playerInviteButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff39',
    shadowColor: '#92a74a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 4,
  },
  playerInviteButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  playerInviteButtonLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    color: '#06142a',
  },
  playerMessageButton: {
    width: 54,
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#efe2d1',
  },
  playerMessageButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: '#fbf8f2',
  },
  playerSection: {
    gap: 8,
  },
  playerSectionEyebrow: {
    marginLeft: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: '#a79a89',
  },
  playerSectionTitle: {
    marginTop: -8,
    marginLeft: 4,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    color: '#06142a',
  },
  sharedGamesCard: {
    overflow: 'hidden',
    borderRadius: 17,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
  },
  sharedGameRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sharedGameRowPressed: {
    backgroundColor: '#fbf8f2',
  },
  sharedGameCopy: {
    flex: 1,
    gap: 2,
  },
  sharedGameTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#06142a',
  },
  sharedGameMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: '#6f7c8c',
  },
  sharedGameBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3c86ff',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  sharedGameBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: '#06142a',
  },
  sharedGameDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 70,
    backgroundColor: '#e7e2db',
  },
  sharedGamesEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    fontSize: 13,
    lineHeight: 18,
    color: '#7f8c9d',
  },
  playerStatsCard: {
    overflow: 'hidden',
    borderRadius: 17,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
  },
  playerStatsRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 16,
  },
  playerStatsRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7e2db',
  },
  playerStatsLabel: {
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#ff5f45',
  },
  playerStatsValue: {
    maxWidth: '54%',
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#06142a',
  },
  playerStateCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
  },
  profileScreen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  profileContent: {
    paddingHorizontal: 20,
    gap: 16,
  },
  profileScreenTitle: {
    marginBottom: 2,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    color: '#10233f',
  },
  profileHeroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 26,
    padding: 20,
    gap: 20,
    backgroundColor: '#07162a',
  },
  profileHeroGrid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.7,
  },
  profileHeroGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(185, 205, 230, 0.12)',
  },
  profileHeroGridLineVerticalOne: {
    top: 0,
    bottom: 0,
    left: '48%',
    width: 1,
  },
  profileHeroGridLineVerticalTwo: {
    top: 0,
    bottom: 0,
    left: '76%',
    width: 1,
  },
  profileHeroGridLineHorizontal: {
    top: 72,
    left: 0,
    right: 0,
    height: 1,
  },
  profileHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  profileHeroIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileHeroAvatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff39',
  },
  profileHeroAvatarText: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '900',
    color: '#10233f',
  },
  profileHeroCopy: {
    flex: 1,
    gap: 5,
  },
  profileHeroName: {
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    color: '#ffffff',
  },
  profileHeroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  profileHeroMeta: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#b8c5d5',
  },
  profileSettingsButton: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  profileSettingsButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  profileMetricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  profileMetricCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  profileMetricValue: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: '#ffffff',
  },
  profileMetricValueLime: {
    color: '#d8ff39',
  },
  profileMetricValueMint: {
    color: '#41ffc6',
  },
  profileMetricLabel: {
    marginTop: 4,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: '#b8c5d5',
  },
  profileSection: {
    gap: 8,
  },
  profileSectionEyebrow: {
    marginLeft: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#a79a89',
  },
  profileSectionTitle: {
    marginLeft: 4,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    color: '#10233f',
  },
  profileSportStack: {
    gap: 12,
  },
  profileSportCard: {
    borderRadius: 17,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
  },
  profileSportCardPressed: {
    transform: [{ scale: 0.99 }],
  },
  profileSportTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  profileSportIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileSportCopy: {
    flex: 1,
    gap: 2,
  },
  profileSportName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    color: '#06142a',
  },
  profileSportMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: '#7f8c9d',
  },
  profileSportActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileSkillPill: {
    maxWidth: 132,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3c86ff',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  profileSkillPillLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: '#10233f',
  },
  profileSportDivider: {
    height: 1,
    marginVertical: 14,
    backgroundColor: '#edf0f3',
  },
  profileSportSummaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  profileSportSummaryCol: {
    flex: 1,
    gap: 3,
  },
  profileSportSummaryLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#ff5f45',
  },
  profileSportSummaryValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#06142a',
  },
  profileStateCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
  },
  profileNetworkCard: {
    gap: 12,
    borderRadius: 17,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },
  profileNetworkEmptyCard: {
    minHeight: 156,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },
  profileNetworkEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#efe7d7',
  },
  profileNetworkEmptyTitle: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#10233f',
  },
  profileNetworkEmptyBody: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    color: '#8a98a9',
  },
  profileConnectionGroup: {
    gap: 9,
  },
  profileConnectionGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileConnectionGroupCopy: {
    flex: 1,
    gap: 2,
  },
  profileConnectionGroupTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    color: '#10233f',
  },
  profileConnectionGroupMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: '#7f8c9d',
  },
  profileConnectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fbf8f2',
  },
  profileConnectionRowPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: '#f6efe5',
  },
  profileConnectionCopy: {
    flex: 1,
    gap: 2,
  },
  profileConnectionName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#10233f',
  },
  profileConnectionMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: '#7f8c9d',
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  summaryAvatarWrap: {
    padding: 5,
    borderRadius: 999,
    backgroundColor: '#eef3f8',
  },
  summaryCopy: {
    flex: 1,
    gap: 5,
  },
  summaryEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  summaryName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  summaryPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  highlightRow: {
    flexDirection: 'row',
    gap: 10,
  },
  highlightCard: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#f6efe5',
    borderWidth: 1,
    borderColor: '#eadfce',
    gap: 4,
  },
  highlightValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  highlightLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#6d7f95',
  },
  sectionIntro: {
    marginTop: -2,
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  stack: {
    gap: 12,
  },
  statCard: {
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf5',
    padding: 14,
  },
  statCardStatic: {
    opacity: 0.98,
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  statIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIdentityCopy: {
    flex: 1,
    gap: 2,
  },
  statSportName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  statMetaSoft: {
    fontSize: 13,
    color: '#6d7f95',
  },
  statPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statSummaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statSummaryCard: {
    flex: 1,
    gap: 4,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#f9f3ea',
  },
  statSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  statSummaryValue: {
    fontSize: 13,
    lineHeight: 19,
    color: '#395065',
  },
  editHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editHint: {
    fontSize: 12,
    color: '#a0603b',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  connectionGroup: {
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf5',
    padding: 14,
  },
  connectionGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  connectionGroupCopy: {
    flex: 1,
    gap: 2,
  },
  connectionGroupTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  connectionGroupMeta: {
    fontSize: 13,
    color: '#6d7f95',
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#fffcf8',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  connectionCopy: {
    flex: 1,
    gap: 4,
  },
  connectionName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  connectionMeta: {
    fontSize: 13,
    color: '#5a6475',
  },
});
