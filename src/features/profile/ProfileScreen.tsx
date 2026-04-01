import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { AvatarPhoto, InfoPill } from '../events/EventPrimitives';
import { SkillLevelModal } from '../events/SkillLevelModal';
import { ReportSheet } from '../reports/ReportSheet';
import { HeaderOverflowButton } from '../../components/HeaderOverflowButton';
import { ScreenCard, ScreenShell } from '../../components/ScreenShell';
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

function SkillLevelStatCard({
  onPress,
  stat,
}: {
  onPress?: (() => void) | null;
  stat: PlayerSportStat;
}) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityHint={onPress ? t('profile.skillEditHint') : undefined}
      accessibilityLabel={`${stat.sportNameEn} ${t(`events.skillLevel.label.${stat.skillLevel}`)}`}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={() => {
        onPress?.();
      }}
      style={[styles.statCard, !onPress ? styles.statCardStatic : undefined]}
    >
      <View style={styles.statHeader}>
        <View>
          <Text style={styles.statSportName}>{stat.sportNameEn}</Text>
          <Text style={styles.statSportNameSecondary}>{stat.sportNameCs}</Text>
        </View>
        <View style={styles.statPills}>
          <InfoPill accentColor={stat.sportColor}>
            {t(`events.skillLevel.label.${stat.skillLevel}`)}
          </InfoPill>
          {stat.isPlayAgainConnection ? (
            <InfoPill accentColor="#183153">{t('profile.playAgainBadge')}</InfoPill>
          ) : null}
        </View>
      </View>
      <Text style={styles.statMeta}>
        {t('profile.stats.gamesAndHours', {
          games: stat.gamesPlayed,
          hours: stat.hoursPlayed.toFixed(1),
        })}
      </Text>
      <Text style={styles.statMeta}>
        {t('profile.stats.noShows', {
          count: stat.noShows,
        })}
      </Text>
      <Text style={styles.statMeta}>
        {stat.thumbsUpPercentage === null
          ? t('profile.stats.thumbsHidden')
          : t('profile.stats.thumbsValue', {
              percentage: stat.thumbsUpPercentage,
            })}
      </Text>
      {onPress ? <Text style={styles.editHint}>{t('profile.skillEditHint')}</Text> : null}
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
        <ScreenCard title={t('profile.summaryTitle')}>
          <NoticeBanner notice={notice} resolveMessage={t} />
          <View style={styles.summaryRow}>
            <AvatarPhoto
              label={fullName || t('auth.home.defaultName')}
              size={64}
              uri={profile?.photoUrl ?? null}
            />
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryName}>{fullName || t('auth.home.defaultName')}</Text>
              <Text style={styles.summaryMeta}>{profile?.city ?? t('shell.common.noCity')}</Text>
              <Text style={styles.summaryMeta}>
                {t(`auth.language.${profile?.language ?? language}`)}
              </Text>
            </View>
          </View>
          <ActionButton
            label={t('shell.profile.openSettings')}
            onPress={() => navigation.navigate('Settings')}
            variant="secondary"
          />
        </ScreenCard>

        <ScreenCard title={t('profile.statsTitle')}>
          {statsQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : statsQuery.isError ? (
            <>
              <Text style={styles.bodyText}>{t('profile.errors.stats')}</Text>
              <ActionButton
                label={t('events.common.retry')}
                onPress={async () => {
                  await statsQuery.refetch();
                }}
              />
            </>
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
            <Text style={styles.bodyText}>{t('profile.statsEmpty')}</Text>
          )}
        </ScreenCard>

        <ScreenCard title={t('profile.connectionsTitle')}>
          {connectionsQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : connectionsQuery.isError ? (
            <>
              <Text style={styles.bodyText}>{t('profile.errors.connections')}</Text>
              <ActionButton
                label={t('events.common.retry')}
                onPress={async () => {
                  await connectionsQuery.refetch();
                }}
              />
            </>
          ) : Object.keys(groupedConnections).length ? (
            <View style={styles.stack}>
              {Object.values(groupedConnections).map((connections) => {
                const firstConnection = connections[0];

                if (!firstConnection) {
                  return null;
                }

                return (
                  <View
                    key={`connections-${firstConnection.sportId}`}
                    style={styles.connectionGroup}
                  >
                    <Text style={styles.connectionGroupTitle}>
                      {language === 'cs'
                        ? firstConnection.sportNameCs
                        : firstConnection.sportNameEn}
                    </Text>
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
                          <InfoPill accentColor={connection.sportColor}>
                            {t('profile.playAgainBadge')}
                          </InfoPill>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.bodyText}>{t('profile.connectionsEmpty')}</Text>
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
        <ScreenCard title={t('playerProfile.summaryTitle')}>
          <NoticeBanner notice={notice} resolveMessage={t} />
          {profileQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : profileQuery.isError || !profileQuery.data ? (
            <>
              <Text style={styles.bodyText}>{t('playerProfile.errors.summary')}</Text>
              <ActionButton
                label={t('events.common.retry')}
                onPress={async () => {
                  await profileQuery.refetch();
                }}
              />
            </>
          ) : (
            <View style={styles.summaryRow}>
              <AvatarPhoto label={topLineName} size={64} uri={profileQuery.data.photo_url} />
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryName}>{topLineName}</Text>
                <Text style={styles.summaryMeta}>
                  {profileQuery.data.city ?? t('shell.common.noCity')}
                </Text>
              </View>
            </View>
          )}
          {hasConnection ? (
            <InfoPill accentColor="#183153">{t('profile.playAgainBadge')}</InfoPill>
          ) : null}
        </ScreenCard>

        <ScreenCard title={t('playerProfile.statsTitle')}>
          {statsQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : statsQuery.isError ? (
            <>
              <Text style={styles.bodyText}>{t('playerProfile.errors.stats')}</Text>
              <ActionButton
                label={t('events.common.retry')}
                onPress={async () => {
                  await statsQuery.refetch();
                }}
              />
            </>
          ) : statsQuery.data?.length ? (
            <View style={styles.stack}>
              {statsQuery.data.map((stat) => (
                <SkillLevelStatCard key={`${stat.userId}-${stat.sportId}`} stat={stat} />
              ))}
            </View>
          ) : (
            <Text style={styles.bodyText}>{t('playerProfile.empty')}</Text>
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
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  summaryCopy: {
    flex: 1,
    gap: 4,
  },
  summaryName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  summaryMeta: {
    fontSize: 14,
    color: '#5a6475',
  },
  stack: {
    gap: 12,
  },
  statCard: {
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf9',
    padding: 14,
  },
  statCardStatic: {
    opacity: 0.98,
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  statSportName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  statSportNameSecondary: {
    fontSize: 13,
    color: '#6d7f95',
  },
  statPills: {
    gap: 6,
    alignItems: 'flex-end',
  },
  statMeta: {
    fontSize: 14,
    color: '#395065',
  },
  editHint: {
    fontSize: 12,
    color: '#a0603b',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  connectionGroup: {
    gap: 10,
  },
  connectionGroupTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf9',
    padding: 12,
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
