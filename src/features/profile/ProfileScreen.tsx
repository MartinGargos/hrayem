import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { AvatarPhoto, InfoPill, SportBadge } from '../events/EventPrimitives';
import { SkillLevelModal } from '../events/SkillLevelModal';
import { ReportSheet } from '../reports/ReportSheet';
import { HeaderOverflowButton } from '../../components/HeaderOverflowButton';
import { ScreenCard, ScreenShell } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import {
  fetchPlayAgainConnections,
  fetchPlayerSportStats,
  fetchVisibleProfile,
  upsertOwnSportProfile,
} from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppNotice } from '../../types/app';
import type { PlayAgainConnection, PlayerSportStat, SportSummary } from '../../types/events';
import { formatDisplayName } from '../../utils/people';

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

function SummaryHighlight({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.highlightCard}>
      <Text style={styles.highlightValue}>{value}</Text>
      <Text style={styles.highlightLabel}>{label}</Text>
    </View>
  );
}

function SkillLevelStatCard({
  onPress,
  stat,
}: {
  onPress?: (() => void) | null;
  stat: PlayerSportStat;
}) {
  const { t } = useTranslation();
  const language = useUserStore((state) => state.language);
  const sportName = language === 'cs' ? stat.sportNameCs : stat.sportNameEn;
  const thumbsText =
    stat.thumbsUpPercentage === null
      ? t('profile.stats.thumbsHidden')
      : t('profile.stats.thumbsValue', {
          percentage: stat.thumbsUpPercentage,
        });

  return (
    <Pressable
      accessibilityHint={onPress ? t('profile.skillEditHint') : undefined}
      accessibilityLabel={`${sportName} ${t(`events.skillLevel.label.${stat.skillLevel}`)}`}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={() => {
        onPress?.();
      }}
      style={[styles.statCard, !onPress ? styles.statCardStatic : undefined]}
    >
      <View style={styles.statHeader}>
        <View style={styles.statIdentity}>
          <SportBadge
            colorHex={stat.sportColor}
            label={getSportBadgeLabel(stat.sportSlug, sportName)}
          />
          <View style={styles.statIdentityCopy}>
            <Text style={styles.statSportName}>{sportName}</Text>
            <Text style={styles.statMetaSoft}>
              {t('profile.stats.gamesAndHours', {
                games: stat.gamesPlayed,
                hours: stat.hoursPlayed.toFixed(1),
              })}
            </Text>
          </View>
        </View>
        {onPress ? <Ionicons color="#9aacbd" name="chevron-forward" size={18} /> : null}
      </View>

      <View style={styles.statPills}>
        <InfoPill accentColor={stat.sportColor}>
          {t(`events.skillLevel.label.${stat.skillLevel}`)}
        </InfoPill>
        {stat.isPlayAgainConnection ? (
          <InfoPill accentColor="#183153">{t('profile.playAgainBadge')}</InfoPill>
        ) : null}
      </View>

      <View style={styles.statSummaryRow}>
        <View style={styles.statSummaryCard}>
          <Text style={styles.statSummaryLabel}>{t('profile.stats.reliabilityLabel')}</Text>
          <Text style={styles.statSummaryValue}>
            {t('profile.stats.noShows', {
              count: stat.noShows,
            })}
          </Text>
        </View>
        <View style={styles.statSummaryCard}>
          <Text style={styles.statSummaryLabel}>{t('profile.stats.feedbackLabel')}</Text>
          <Text style={styles.statSummaryValue}>{thumbsText}</Text>
        </View>
      </View>

      {onPress ? (
        <View style={styles.editHintRow}>
          <Ionicons color="#a0603b" name="sparkles-outline" size={14} />
          <Text style={styles.editHint}>{t('profile.skillEditHint')}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
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
  const totalConnections = connectionsQuery.data?.length ?? 0;
  const languageLabel = t(`auth.language.${profile?.language ?? language}`);
  const summaryHighlights = [
    {
      label: t('profile.highlights.sports'),
      value: statsQuery.isPending || statsQuery.isError ? '—' : String(totalSports),
    },
    {
      label: t('profile.highlights.games'),
      value: statsQuery.isPending || statsQuery.isError ? '—' : String(totalGames),
    },
    {
      label: t('profile.highlights.connections'),
      value:
        connectionsQuery.isPending || connectionsQuery.isError ? '—' : String(totalConnections),
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

  return (
    <>
      <ScreenShell title={t('shell.profile.title')} subtitle={t('shell.profile.subtitle')}>
        <ScreenCard>
          <NoticeBanner notice={notice} resolveMessage={t} />
          <View style={styles.summaryHeader}>
            <View style={styles.summaryAvatarWrap}>
              <AvatarPhoto
                label={fullName || t('auth.home.defaultName')}
                size={72}
                uri={profile?.photoUrl ?? null}
              />
            </View>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryEyebrow}>{t('profile.summaryTitle')}</Text>
              <Text style={styles.summaryName}>{fullName || t('auth.home.defaultName')}</Text>
              <View style={styles.summaryPillRow}>
                <InfoPill>{profile?.city ?? t('shell.common.noCity')}</InfoPill>
                <InfoPill accentColor="#183153">{languageLabel}</InfoPill>
              </View>
            </View>
          </View>

          <View style={styles.highlightRow}>
            {summaryHighlights.map((item) => (
              <SummaryHighlight key={item.label} label={item.label} value={item.value} />
            ))}
          </View>

          <ActionButton
            iconName="settings-outline"
            label={t('shell.profile.openSettings')}
            onPress={() => navigation.navigate('Settings')}
            variant="secondary"
          />
        </ScreenCard>

        <ScreenCard title={t('profile.statsTitle')}>
          <Text style={styles.sectionIntro}>{t('profile.statsSubtitle')}</Text>
          {statsQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : statsQuery.isError ? (
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
          ) : statsQuery.data?.length ? (
            <View style={styles.stack}>
              {statsQuery.data.map((stat) => (
                <SkillLevelStatCard
                  key={`${stat.userId}-${stat.sportId}`}
                  onPress={() => handleOpenSkillEditor(stat)}
                  stat={stat}
                />
              ))}
            </View>
          ) : (
            <StateMessage
              body={t('profile.statsEmpty')}
              compact
              iconName="sparkles-outline"
              title={t('common.nothingYet')}
              tone="warm"
            />
          )}
        </ScreenCard>

        <ScreenCard title={t('profile.connectionsTitle')}>
          <Text style={styles.sectionIntro}>{t('profile.connectionsSubtitle')}</Text>
          {connectionsQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : connectionsQuery.isError ? (
            <StateMessage
              action={
                <ActionButton
                  iconName="refresh-outline"
                  label={t('events.common.retry')}
                  onPress={async () => {
                    await connectionsQuery.refetch();
                  }}
                  variant="secondary"
                />
              }
              body={t('profile.errors.connections')}
              compact
              iconName="people-outline"
              title={t('common.tryAgainTitle')}
              tone="muted"
            />
          ) : Object.keys(groupedConnections).length ? (
            <View style={styles.stack}>
              {Object.values(groupedConnections).map((connections) => {
                const firstConnection = connections[0];

                if (!firstConnection) {
                  return null;
                }

                const sportName =
                  language === 'cs' ? firstConnection.sportNameCs : firstConnection.sportNameEn;

                return (
                  <View
                    key={`connections-${firstConnection.sportId}`}
                    style={styles.connectionGroup}
                  >
                    <View style={styles.connectionGroupHeader}>
                      <SportBadge
                        colorHex={firstConnection.sportColor}
                        label={getSportBadgeLabel(firstConnection.sportSlug, sportName)}
                      />
                      <View style={styles.connectionGroupCopy}>
                        <Text style={styles.connectionGroupTitle}>{sportName}</Text>
                        <Text style={styles.connectionGroupMeta}>
                          {t('profile.connectionsGroupCount', {
                            count: connections.length,
                          })}
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
                          style={styles.connectionRow}
                        >
                          <AvatarPhoto label={connectionName} uri={connection.photoUrl} />
                          <View style={styles.connectionCopy}>
                            <Text style={styles.connectionName}>{connectionName}</Text>
                            <Text style={styles.connectionMeta}>
                              {t('profile.stats.gamesAndHours', {
                                games: connection.gamesPlayed,
                                hours: connection.hoursPlayed.toFixed(1),
                              })}
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
          ) : (
            <StateMessage
              body={t('profile.connectionsEmpty')}
              compact
              iconName="heart-outline"
              title={t('common.nothingYet')}
              tone="warm"
            />
          )}
        </ScreenCard>
      </ScreenShell>

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

export function PlayerProfileScreen({ route }: PlayerProfileScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const playerId = route.params.playerId;
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [isReportSheetVisible, setIsReportSheetVisible] = useState(false);

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

  const topLineName =
    formatDisplayName(profileQuery.data?.first_name, profileQuery.data?.last_name) ||
    t('common.deletedUser');
  const hasConnection = (statsQuery.data ?? []).some((stat) => stat.isPlayAgainConnection);
  const playerHighlights = [
    {
      label: t('profile.highlights.sports'),
      value:
        statsQuery.isPending || statsQuery.isError ? '—' : String(statsQuery.data?.length ?? 0),
    },
    {
      label: t('profile.highlights.games'),
      value:
        statsQuery.isPending || statsQuery.isError
          ? '—'
          : String((statsQuery.data ?? []).reduce((sum, stat) => sum + stat.gamesPlayed, 0)),
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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: canReportPlayer
        ? () => (
            <HeaderOverflowButton
              accessibilityHint={t('reports.reportPlayerAction')}
              accessibilityLabel={t('reports.overflowLabel')}
              onPress={handleOpenReportMenu}
            />
          )
        : undefined,
    });
  }, [canReportPlayer, handleOpenReportMenu, navigation, t]);

  return (
    <>
      <ScreenShell
        title={t('navigation.titles.playerProfile')}
        subtitle={t('playerProfile.subtitle')}
      >
        <ScreenCard>
          <NoticeBanner notice={notice} resolveMessage={t} />
          {profileQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : profileQuery.isError || !profileQuery.data ? (
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
          ) : (
            <>
              <View style={styles.summaryHeader}>
                <View style={styles.summaryAvatarWrap}>
                  <AvatarPhoto label={topLineName} size={72} uri={profileQuery.data.photo_url} />
                </View>
                <View style={styles.summaryCopy}>
                  <Text style={styles.summaryEyebrow}>{t('playerProfile.summaryTitle')}</Text>
                  <Text style={styles.summaryName}>{topLineName}</Text>
                  <View style={styles.summaryPillRow}>
                    <InfoPill>{profileQuery.data.city ?? t('shell.common.noCity')}</InfoPill>
                    {hasConnection ? (
                      <InfoPill accentColor="#183153">{t('profile.playAgainBadge')}</InfoPill>
                    ) : null}
                  </View>
                </View>
              </View>
              <View style={styles.highlightRow}>
                {playerHighlights.map((item) => (
                  <SummaryHighlight key={item.label} label={item.label} value={item.value} />
                ))}
              </View>
            </>
          )}
        </ScreenCard>

        <ScreenCard title={t('playerProfile.statsTitle')}>
          <Text style={styles.sectionIntro}>{t('playerProfile.statsSubtitle')}</Text>
          {statsQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : statsQuery.isError ? (
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
          ) : statsQuery.data?.length ? (
            <View style={styles.stack}>
              {statsQuery.data.map((stat) => (
                <SkillLevelStatCard key={`${stat.userId}-${stat.sportId}`} stat={stat} />
              ))}
            </View>
          ) : (
            <StateMessage
              body={t('playerProfile.empty')}
              compact
              iconName="sparkles-outline"
              title={t('common.nothingYet')}
              tone="warm"
            />
          )}
        </ScreenCard>
      </ScreenShell>
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
