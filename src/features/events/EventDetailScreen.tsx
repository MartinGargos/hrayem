import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import {
  canOrganizerCancelEvent,
  canOrganizerEditEvent,
  canOrganizerRemovePlayers,
  hasEnoughConfirmedPlayersForNoShow,
} from './event-eligibility';
import { AvatarPhoto } from './EventPrimitives';
import { SkillLevelModal } from './SkillLevelModal';
import { ReportSheet } from '../reports/ReportSheet';
import { ScreenCard } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import { buildEventWebUrl } from '../../navigation/deep-links';
import type { RootStackParamList } from '../../navigation/types';
import {
  cancelEvent,
  EdgeFunctionError,
  fetchConfirmedEventPlayers,
  fetchEventDetail,
  fetchOwnSportProfiles,
  giveThumbsUp,
  joinEvent,
  leaveEvent,
  reportNoShow,
  removePlayer,
} from '../../services/events';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage, AppNotice } from '../../types/app';
import type {
  EventConfirmedPlayer,
  EventDetail,
  EventMembershipStatus,
  JoinEventResponse,
  LeaveEventResponse,
} from '../../types/events';
import {
  formatEventCompactDate,
  formatEventDate,
  formatEventTime,
  formatRelativeTime,
} from '../../utils/dates';
import { formatDisplayName } from '../../utils/people';

type EventDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

function getOptimisticJoinResult(event: EventDetail): JoinEventResponse {
  const canConfirmImmediately = event.spotsTaken < event.playerCountTotal;

  if (canConfirmImmediately) {
    const nextSpotsTaken = event.spotsTaken + 1;

    return {
      event_id: event.id,
      membership_status: 'confirmed',
      waitlist_position: null,
      event_status: nextSpotsTaken >= event.playerCountTotal ? 'full' : 'active',
      spots_taken: nextSpotsTaken,
      waitlist_count: event.waitlistCount,
    };
  }

  return {
    event_id: event.id,
    membership_status: 'waitlisted',
    waitlist_position: event.waitlistCount + 1,
    event_status: 'full',
    spots_taken: event.spotsTaken,
    waitlist_count: event.waitlistCount + 1,
  };
}

function getOptimisticLeaveResult(event: EventDetail): LeaveEventResponse {
  const isConfirmed = event.viewerMembershipStatus === 'confirmed';
  const hasWaitlistPromotion = isConfirmed && event.waitlistCount > 0;
  const nextSpotsTaken = hasWaitlistPromotion
    ? event.spotsTaken
    : Math.max(event.spotsTaken - (isConfirmed ? 1 : 0), 0);
  const nextWaitlistCount =
    event.viewerMembershipStatus === 'waitlisted'
      ? Math.max(event.waitlistCount - 1, 0)
      : hasWaitlistPromotion
        ? Math.max(event.waitlistCount - 1, 0)
        : event.waitlistCount;

  return {
    event_id: event.id,
    membership_status: null,
    waitlist_position: null,
    event_status: nextSpotsTaken >= event.playerCountTotal ? 'full' : 'active',
    spots_taken: nextSpotsTaken,
    waitlist_count: nextWaitlistCount,
    promoted_user_id: null,
  };
}

function applyMutationToEvent(
  event: EventDetail,
  mutation: JoinEventResponse | LeaveEventResponse,
): EventDetail {
  const membershipStatus =
    mutation.membership_status === null
      ? null
      : (mutation.membership_status as EventMembershipStatus);

  return {
    ...event,
    status: mutation.event_status,
    spotsTaken: mutation.spots_taken,
    waitlistCount: mutation.waitlist_count,
    viewerMembershipStatus: membershipStatus,
    viewerWaitlistPosition: mutation.waitlist_position,
  };
}

function upsertCurrentUserAsConfirmedPlayer(
  players: EventConfirmedPlayer[] | undefined,
  input: {
    userId: string | null;
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    skillLevel: number | null;
  },
): EventConfirmedPlayer[] {
  if (!input.userId) {
    return players ?? [];
  }

  const nextPlayers = [...(players ?? [])];
  const existingIndex = nextPlayers.findIndex((player) => player.userId === input.userId);
  const nextPlayer: EventConfirmedPlayer = {
    userId: input.userId,
    firstName: input.firstName,
    lastName: input.lastName,
    photoUrl: input.photoUrl,
    skillLevel: input.skillLevel,
    gamesPlayed: 0,
    hoursPlayed: 0,
    noShows: 0,
    thumbsUpPercentage: null,
    isPlayAgainConnection: false,
    alreadyThumbedUpByViewer: false,
    alreadyReportedNoShow: false,
    joinedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    nextPlayers[existingIndex] = {
      ...nextPlayers[existingIndex]!,
      ...nextPlayer,
    };
    return nextPlayers;
  }

  return [...nextPlayers, nextPlayer];
}

function removeCurrentUserFromConfirmedPlayers(
  players: EventConfirmedPlayer[] | undefined,
  userId: string | null,
): EventConfirmedPlayer[] {
  if (!players?.length || !userId) {
    return players ?? [];
  }

  return players.filter((player) => player.userId !== userId);
}

function isSkillOutsideRange(skillLevel: number, event: EventDetail): boolean {
  return skillLevel < event.skillMin || skillLevel > event.skillMax;
}

function mapJoinLeaveErrorToNotice(error: unknown): AppNotice {
  if (error instanceof EdgeFunctionError) {
    if (error.code === 'SKILL_LEVEL_REQUIRED') {
      return {
        messageKey: 'events.join.skillRequired',
        tone: 'info',
      };
    }

    if (error.code === 'ALREADY_JOINED') {
      return {
        messageKey: 'events.join.errors.alreadyJoined',
        tone: 'info',
      };
    }

    if (error.code === 'EVENT_ALREADY_STARTED' || error.code === 'EVENT_NOT_JOINABLE') {
      return {
        messageKey: 'events.join.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'ORGANIZER_CANNOT_JOIN') {
      return {
        messageKey: 'events.join.errors.organizerCannotJoin',
        tone: 'info',
      };
    }

    if (error.code === 'EVENT_NOT_LEAVABLE' || error.code === 'PLAYER_NOT_IN_EVENT') {
      return {
        messageKey: 'events.leave.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'ORGANIZER_CANNOT_LEAVE') {
      return {
        messageKey: 'events.leave.errors.organizerCannotLeave',
        tone: 'info',
      };
    }

    if (error.code === 'EVENT_NOT_CANCELLABLE') {
      return {
        messageKey: 'events.cancel.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'FORBIDDEN') {
      return {
        messageKey: 'events.organizerTools.errors.forbidden',
        tone: 'info',
      };
    }

    if (error.code === 'NO_SHOW_NOT_ALLOWED') {
      return {
        messageKey: 'events.noShow.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'ALREADY_REPORTED') {
      return {
        messageKey: 'events.noShow.errors.alreadyReported',
        tone: 'info',
      };
    }

    if (error.code === 'THUMBS_UP_NOT_ALLOWED') {
      return {
        messageKey: 'events.thumbsUp.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'ALREADY_THUMBED_UP') {
      return {
        messageKey: 'events.thumbsUp.errors.alreadyGiven',
        tone: 'info',
      };
    }

    if (error.code === 'RATE_LIMITED') {
      return {
        messageKey: 'events.common.errors.rateLimited',
        tone: 'info',
      };
    }
  }

  return {
    messageKey: 'events.common.errors.generic',
    tone: 'error',
  };
}

function buildEventCode(eventId: string): string {
  return `#H-${eventId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

function formatHeroRelativeTime(input: string, language: AppLanguage): string {
  return formatRelativeTime(input, language).replace(
    language === 'cs' ? /^přibližně\s+/i : /^about\s+/i,
    '',
  );
}

function DetailFrame({
  bottomInset,
  children,
  menuLabel,
  onBack,
  onMenu,
  title,
  topInset,
}: {
  bottomInset: number;
  children: ReactNode;
  menuLabel: string;
  onBack: () => void;
  onMenu?: () => void;
  title: string;
  topInset: number;
}) {
  return (
    <View style={styles.detailRoot}>
      <View style={[styles.detailTopBar, { paddingTop: topInset + 8 }]}>
        <Pressable
          accessibilityLabel={title}
          accessibilityRole="button"
          onPress={onBack}
          style={styles.detailTopButton}
        >
          <Ionicons color="#071426" name="chevron-back-outline" size={24} />
        </Pressable>
        <Text style={styles.detailTopTitle}>{title}</Text>
        {onMenu ? (
          <Pressable
            accessibilityLabel={menuLabel}
            accessibilityRole="button"
            onPress={onMenu}
            style={styles.detailTopButton}
          >
            <Ionicons color="#071426" name="ellipsis-horizontal" size={22} />
          </Pressable>
        ) : (
          <View style={styles.detailTopButton} />
        )}
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.detailContent,
          {
            paddingBottom: Math.max(bottomInset, 18) + 34,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function OrganizerHeroCard({
  event,
  language,
  sportName,
  t,
}: {
  event: EventDetail;
  language: AppLanguage;
  sportName: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <View style={styles.organizerHeroCard}>
      <View pointerEvents="none" style={styles.organizerHeroGrid}>
        <View style={styles.organizerHeroGridVertical} />
        <View style={styles.organizerHeroGridHorizontal} />
      </View>

      <View style={styles.organizerHeroTopRow}>
        <View style={styles.organizerSportPill}>
          <Ionicons color="#071426" name="tennisball-outline" size={14} />
          <Text numberOfLines={1} style={styles.organizerSportPillLabel}>
            {sportName}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.organizerHeroMeta}>
          {t('events.detail.organizerHeroMeta', { code: buildEventCode(event.id) })}
        </Text>
      </View>

      <Text numberOfLines={2} style={styles.organizerHeroTitle}>
        {event.venueName}
      </Text>
      <View style={styles.organizerHeroLocationRow}>
        <Ionicons color="#9fb0c8" name="location-outline" size={15} />
        <Text numberOfLines={1} style={styles.organizerHeroLocation}>
          {event.venueAddress ?? event.city}
        </Text>
      </View>

      <View style={styles.organizerHeroDivider} />

      <Text style={styles.organizerHeroLabel}>{t('events.detail.dateTimeLabel')}</Text>
      <View style={styles.organizerHeroDateRow}>
        <Text numberOfLines={1} style={styles.organizerHeroDate}>
          {formatEventCompactDate(event.startsAt, language)} ·{' '}
          {formatEventTime(event.startsAt, language)}
        </Text>
        <View style={styles.organizerHeroTimePill}>
          <Text numberOfLines={1} style={styles.organizerHeroTimePillLabel}>
            {formatHeroRelativeTime(event.startsAt, language)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SectionTitle({
  eyebrow,
  rightLabel,
  title,
}: {
  eyebrow: string;
  rightLabel?: string;
  title: string;
}) {
  return (
    <View style={styles.sectionTitleBlock}>
      <View style={styles.sectionEyebrowRow}>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        {rightLabel ? <Text style={styles.sectionRightLabel}>{rightLabel}</Text> : null}
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function OrganizerToolButton({
  disabled,
  iconName,
  label,
  onPress,
  tone,
}: {
  disabled?: boolean;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  tone: 'dark' | 'light';
}) {
  const isDark = tone === 'dark';

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.organizerToolButton,
        isDark ? styles.organizerToolButtonDark : styles.organizerToolButtonLight,
        disabled ? styles.organizerToolButtonDisabled : undefined,
      ]}
    >
      <Ionicons color={isDark ? '#ffffff' : '#071426'} name={iconName} size={21} />
      <Text
        style={[
          styles.organizerToolButtonLabel,
          isDark ? styles.organizerToolButtonLabelDark : undefined,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ConfirmedPlayersCard({
  canInvite,
  canRemovePlayers,
  event,
  isLoading,
  onInvite,
  onOpenPlayer,
  onRemovePlayer,
  players,
  removingUserId,
  t,
}: {
  canInvite: boolean;
  canRemovePlayers: boolean;
  event: EventDetail;
  isLoading: boolean;
  onInvite: () => void;
  onOpenPlayer: (playerId: string) => void;
  onRemovePlayer: (playerId: string, playerName: string) => void;
  players: EventConfirmedPlayer[];
  removingUserId: string | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const openSlotCount = Math.max(event.playerCountTotal - players.length, 0);
  const visibleOpenSlots = Math.min(openSlotCount, 3);

  return (
    <View style={styles.playersPanel}>
      {isLoading ? (
        <View style={styles.centeredBlock}>
          <ActivityIndicator color="#071426" />
        </View>
      ) : (
        <>
          {players.map((player, index) => (
            <ConfirmedPlayerRow
              canRemove={canRemovePlayers && player.userId !== event.organizerId}
              isLast={index === players.length - 1 && visibleOpenSlots === 0}
              isOrganizer={player.userId === event.organizerId}
              key={player.userId}
              onOpenPlayer={onOpenPlayer}
              onRemovePlayer={onRemovePlayer}
              player={player}
              removingUserId={removingUserId}
              t={t}
            />
          ))}
          {Array.from({ length: visibleOpenSlots }).map((_, index) => (
            <OpenPlayerSlotRow
              canInvite={canInvite}
              isLast={index === visibleOpenSlots - 1}
              key={`open-slot-${index}`}
              onInvite={onInvite}
              t={t}
            />
          ))}
          {openSlotCount > visibleOpenSlots ? (
            <View style={styles.moreSlotsRow}>
              <Text style={styles.moreSlotsText}>
                {t('events.detail.moreOpenSlots', { count: openSlotCount - visibleOpenSlots })}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function ConfirmedPlayerRow({
  canRemove,
  isLast,
  isOrganizer,
  onOpenPlayer,
  onRemovePlayer,
  player,
  removingUserId,
  t,
}: {
  canRemove: boolean;
  isLast: boolean;
  isOrganizer: boolean;
  onOpenPlayer: (playerId: string) => void;
  onRemovePlayer: (playerId: string, playerName: string) => void;
  player: EventConfirmedPlayer;
  removingUserId: string | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const playerName =
    formatDisplayName(player.firstName, player.lastName) ||
    (player.userId.startsWith('deleted-') ? t('common.deletedUser') : t('auth.home.defaultName'));
  const canOpenPlayerProfile = !player.userId.startsWith('deleted-');
  const isRemoving = removingUserId === player.userId;

  return (
    <View style={[styles.playerSlotRow, isLast ? styles.playerSlotRowLast : undefined]}>
      <Pressable
        accessibilityLabel={playerName}
        accessibilityRole={canOpenPlayerProfile ? 'button' : undefined}
        disabled={!canOpenPlayerProfile}
        onPress={() => {
          if (canOpenPlayerProfile) {
            onOpenPlayer(player.userId);
          }
        }}
        style={styles.playerSlotIdentity}
      >
        <AvatarPhoto label={playerName} size={40} uri={player.photoUrl} />
        <View style={styles.playerSlotCopy}>
          <View style={styles.playerNameRow}>
            <Text numberOfLines={1} style={styles.playerSlotName}>
              {playerName}
            </Text>
            {isOrganizer ? <Text style={styles.organizerMiniLabel}>· ORG</Text> : null}
          </View>
          <Text numberOfLines={1} style={styles.playerSlotMeta}>
            {t('events.detail.playerStats', {
              games: player.gamesPlayed,
              noShows: player.noShows,
            })}
          </Text>
        </View>
      </Pressable>
      <View style={styles.playerSlotActions}>
        <View style={styles.confirmedPill}>
          <Text style={styles.confirmedPillLabel}>{t('events.detail.confirmedBadge')}</Text>
        </View>
        {canRemove ? (
          <Pressable
            accessibilityLabel={t('events.removePlayer.action')}
            accessibilityRole="button"
            disabled={isRemoving}
            onPress={() => onRemovePlayer(player.userId, playerName)}
            style={styles.removePlayerIconButton}
          >
            <Ionicons color="#ff503f" name={isRemoving ? 'hourglass-outline' : 'close'} size={15} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function OpenPlayerSlotRow({
  canInvite,
  isLast,
  onInvite,
  t,
}: {
  canInvite: boolean;
  isLast: boolean;
  onInvite: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <View style={[styles.playerSlotRow, isLast ? styles.playerSlotRowLast : undefined]}>
      <View style={styles.openSlotIcon}>
        <Ionicons color="#b4b7bc" name="add" size={20} />
      </View>
      <Text numberOfLines={1} style={styles.openSlotText}>
        {t('events.detail.lookingForPlayer')}
      </Text>
      {canInvite ? (
        <Pressable
          accessibilityLabel={t('events.detail.inviteAction')}
          accessibilityRole="button"
          onPress={onInvite}
          style={styles.inviteButton}
        >
          <Text style={styles.inviteButtonLabel}>{t('events.detail.inviteAction')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CompactDetailsCard({
  event,
  eventDescription,
  t,
}: {
  event: EventDetail;
  eventDescription: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const rows = [
    {
      label: t('events.detail.addressLabel'),
      value: event.venueAddress ?? t('events.detail.addressFallback'),
    },
    {
      label: t('events.detail.waitlistLabel'),
      value: t('events.detail.waitlistPlayers', { count: event.waitlistCount }),
    },
    {
      label: t('events.detail.skillTitle'),
      value: t('events.feed.skillRange', { min: event.skillMin, max: event.skillMax }),
    },
    {
      label: t('events.detail.courtStatusLabel'),
      value: t(`events.reservationType.${event.reservationType}`),
    },
  ];

  return (
    <View style={styles.detailsPanel}>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[styles.detailsRow, index === rows.length - 1 ? styles.detailsRowLast : undefined]}
        >
          <Text style={styles.detailsLabel}>{row.label}</Text>
          <Text numberOfLines={2} style={styles.detailsValue}>
            {row.value}
          </Text>
        </View>
      ))}
      {event.description ? (
        <View style={[styles.detailsRow, styles.detailsRowLast, styles.descriptionDetailsRow]}>
          <Text style={styles.detailsLabel}>{t('events.detail.descriptionTitle')}</Text>
          <Text style={styles.detailsValue}>{eventDescription}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ChatShortcutCard({
  canOpenChat,
  onPress,
  subtitle,
  t,
}: {
  canOpenChat: boolean;
  onPress: () => void;
  subtitle: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (!canOpenChat) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel={t('events.chat.openAction')}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.chatShortcutCard}
    >
      <View style={styles.chatShortcutIcon}>
        <Ionicons color="#d8ff45" name="chatbubble-outline" size={22} />
      </View>
      <View style={styles.chatShortcutCopy}>
        <Text style={styles.chatShortcutTitle}>{t('events.detail.chatShortcutTitle')}</Text>
        <Text numberOfLines={1} style={styles.chatShortcutSubtitle}>
          {subtitle}
        </Text>
      </View>
      <Ionicons color="#9aa1ab" name="arrow-forward-outline" size={19} />
    </Pressable>
  );
}

export function EventDetailScreen({ route, navigation }: EventDetailScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const userId = useAuthStore((state) => state.userId);
  const eventId = route.params.eventId;
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [isSkillModalVisible, setIsSkillModalVisible] = useState(false);
  const [isReportSheetVisible, setIsReportSheetVisible] = useState(false);
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<number | null>(null);

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
        viewerUserId: userId,
      }),
    enabled: Boolean(eventQuery.data?.sportId),
    staleTime: 10_000,
  });

  const ownSportProfilesQuery = useQuery({
    queryKey: ['user-sports', userId],
    queryFn: () => fetchOwnSportProfiles(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: 300_000,
  });

  const invalidateEventRelatedQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
      queryClient.invalidateQueries({
        queryKey: ['events', 'detail', eventId, 'confirmed-players'],
      }),
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] }),
      queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
      queryClient.invalidateQueries({ queryKey: ['user-sports', userId] }),
    ]);
  }, [eventId, queryClient, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let channel = supabase.channel(`event:${eventId}:players`);

    const connect = () => {
      channel = supabase
        .channel(`event:${eventId}:players`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'event_players',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void invalidateEventRelatedQueries();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'events',
            filter: `id=eq.${eventId}`,
          },
          () => {
            void invalidateEventRelatedQueries();
          },
        );

      channel.subscribe((status) => {
        if (!active) {
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void supabase.removeChannel(channel);

          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }

          reconnectTimer = setTimeout(() => {
            if (active) {
              connect();
            }
          }, 1500);
        }
      });
    };

    connect();

    return () => {
      active = false;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      void supabase.removeChannel(channel);
    };
  }, [eventId, invalidateEventRelatedQueries, queryClient, userId]);

  const joinMutation = useMutation({
    mutationFn: joinEvent,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['events', 'detail', eventId] });
      await queryClient.cancelQueries({
        queryKey: ['events', 'detail', eventId, 'confirmed-players'],
      });

      const previousEvent = queryClient.getQueryData<EventDetail>(['events', 'detail', eventId]);
      const previousPlayers = queryClient.getQueryData<EventConfirmedPlayer[]>([
        'events',
        'detail',
        eventId,
        'confirmed-players',
      ]);

      if (previousEvent) {
        const optimisticJoin = getOptimisticJoinResult(previousEvent);
        queryClient.setQueryData<EventDetail>(['events', 'detail', eventId], (current) =>
          current ? applyMutationToEvent(current, optimisticJoin) : current,
        );

        if (optimisticJoin.membership_status === 'confirmed') {
          queryClient.setQueryData<EventConfirmedPlayer[]>(
            ['events', 'detail', eventId, 'confirmed-players'],
            (current) =>
              upsertCurrentUserAsConfirmedPlayer(current, {
                userId,
                firstName: profile?.firstName ?? null,
                lastName: profile?.lastName ?? null,
                photoUrl: profile?.photoUrl ?? null,
                skillLevel: input.skillLevel ?? currentSportSkillLevel(),
              }),
          );
        } else {
          queryClient.setQueryData<EventConfirmedPlayer[]>(
            ['events', 'detail', eventId, 'confirmed-players'],
            (current) => removeCurrentUserFromConfirmedPlayers(current, userId),
          );
        }
      }

      return {
        previousEvent,
        previousPlayers,
      };
    },
    onError: (error, _input, context) => {
      if (context?.previousEvent) {
        queryClient.setQueryData(['events', 'detail', eventId], context.previousEvent);
      }

      if (context?.previousPlayers) {
        queryClient.setQueryData(
          ['events', 'detail', eventId, 'confirmed-players'],
          context.previousPlayers,
        );
      }

      if (error instanceof EdgeFunctionError && error.code === 'SKILL_LEVEL_REQUIRED') {
        setSelectedSkillLevel(null);
        setIsSkillModalVisible(true);
      }

      setNotice(mapJoinLeaveErrorToNotice(error));
    },
    onSuccess: async (result, input) => {
      queryClient.setQueryData<EventDetail>(['events', 'detail', eventId], (current) =>
        current ? applyMutationToEvent(current, result) : current,
      );

      if (result.membership_status === 'confirmed') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.setQueryData<EventConfirmedPlayer[]>(
          ['events', 'detail', eventId, 'confirmed-players'],
          (current) =>
            upsertCurrentUserAsConfirmedPlayer(current, {
              userId,
              firstName: profile?.firstName ?? null,
              lastName: profile?.lastName ?? null,
              photoUrl: profile?.photoUrl ?? null,
              skillLevel: input.skillLevel ?? currentSportSkillLevel(),
            }),
        );
        setNotice({
          messageKey: 'events.join.successConfirmed',
          tone: 'success',
        });
      } else {
        queryClient.setQueryData<EventConfirmedPlayer[]>(
          ['events', 'detail', eventId, 'confirmed-players'],
          (current) => removeCurrentUserFromConfirmedPlayers(current, userId),
        );
        setNotice({
          messageKey: 'events.join.successWaitlisted',
          tone: 'info',
        });
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', eventId, 'confirmed-players'],
        }),
        queryClient.invalidateQueries({ queryKey: ['events', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
        queryClient.invalidateQueries({ queryKey: ['user-sports', userId] }),
      ]);
    },
  });

  const leaveMutation = useMutation({
    mutationFn: leaveEvent,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['events', 'detail', eventId] });
      await queryClient.cancelQueries({
        queryKey: ['events', 'detail', eventId, 'confirmed-players'],
      });

      const previousEvent = queryClient.getQueryData<EventDetail>(['events', 'detail', eventId]);
      const previousPlayers = queryClient.getQueryData<EventConfirmedPlayer[]>([
        'events',
        'detail',
        eventId,
        'confirmed-players',
      ]);

      if (previousEvent) {
        const optimisticLeave = getOptimisticLeaveResult(previousEvent);
        queryClient.setQueryData<EventDetail>(['events', 'detail', eventId], (current) =>
          current ? applyMutationToEvent(current, optimisticLeave) : current,
        );
        queryClient.setQueryData<EventConfirmedPlayer[]>(
          ['events', 'detail', eventId, 'confirmed-players'],
          (current) => removeCurrentUserFromConfirmedPlayers(current, userId),
        );
      }

      return {
        previousEvent,
        previousPlayers,
      };
    },
    onError: (error, _input, context) => {
      if (context?.previousEvent) {
        queryClient.setQueryData(['events', 'detail', eventId], context.previousEvent);
      }

      if (context?.previousPlayers) {
        queryClient.setQueryData(
          ['events', 'detail', eventId, 'confirmed-players'],
          context.previousPlayers,
        );
      }

      setNotice(mapJoinLeaveErrorToNotice(error));
    },
    onSuccess: (result) => {
      queryClient.setQueryData<EventDetail>(['events', 'detail', eventId], (current) =>
        current ? applyMutationToEvent(current, result) : current,
      );
      queryClient.setQueryData<EventConfirmedPlayer[]>(
        ['events', 'detail', eventId, 'confirmed-players'],
        (current) => removeCurrentUserFromConfirmedPlayers(current, userId),
      );
      setNotice({
        messageKey: 'events.leave.success',
        tone: 'info',
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', eventId, 'confirmed-players'],
        }),
        queryClient.invalidateQueries({ queryKey: ['events', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
      ]);
    },
  });

  const removePlayerMutation = useMutation({
    mutationFn: removePlayer,
    onSuccess: async (_result, variables) => {
      queryClient.setQueryData<EventConfirmedPlayer[]>(
        ['events', 'detail', eventId, 'confirmed-players'],
        (current) => current?.filter((player) => player.userId !== variables.targetUserId) ?? [],
      );
      setNotice({
        messageKey: 'events.removePlayer.success',
        tone: 'info',
      });
      await invalidateEventRelatedQueries();
    },
    onError: (error) => {
      setNotice(mapJoinLeaveErrorToNotice(error));
    },
  });

  const reportNoShowMutation = useMutation({
    mutationFn: reportNoShow,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ['events', 'detail', eventId, 'confirmed-players'],
      });

      const previousPlayers = queryClient.getQueryData<EventConfirmedPlayer[]>([
        'events',
        'detail',
        eventId,
        'confirmed-players',
      ]);

      queryClient.setQueryData<EventConfirmedPlayer[]>(
        ['events', 'detail', eventId, 'confirmed-players'],
        (current) =>
          current?.map((player) =>
            player.userId === input.reportedUserId
              ? {
                  ...player,
                  alreadyReportedNoShow: true,
                  noShows: player.noShows + 1,
                }
              : player,
          ) ?? [],
      );

      return {
        previousPlayers,
      };
    },
    onError: (error, _input, context) => {
      if (context?.previousPlayers) {
        queryClient.setQueryData(
          ['events', 'detail', eventId, 'confirmed-players'],
          context.previousPlayers,
        );
      }

      setNotice(mapJoinLeaveErrorToNotice(error));
    },
    onSuccess: async (_result, variables) => {
      setNotice({
        messageKey: 'events.noShow.success',
        tone: 'info',
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', eventId, 'confirmed-players'],
        }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['user-sports'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
        queryClient.invalidateQueries({
          queryKey: ['profile', 'player', variables.reportedUserId],
        }),
      ]);
    },
  });

  const thumbsUpMutation = useMutation({
    mutationFn: giveThumbsUp,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ['events', 'detail', eventId, 'confirmed-players'],
      });

      const previousPlayers = queryClient.getQueryData<EventConfirmedPlayer[]>([
        'events',
        'detail',
        eventId,
        'confirmed-players',
      ]);

      queryClient.setQueryData<EventConfirmedPlayer[]>(
        ['events', 'detail', eventId, 'confirmed-players'],
        (current) =>
          current?.map((player) =>
            player.userId === input.toUserId
              ? {
                  ...player,
                  alreadyThumbedUpByViewer: true,
                }
              : player,
          ) ?? [],
      );

      return {
        previousPlayers,
      };
    },
    onError: (error, _input, context) => {
      if (context?.previousPlayers) {
        queryClient.setQueryData(
          ['events', 'detail', eventId, 'confirmed-players'],
          context.previousPlayers,
        );
      }

      setNotice(mapJoinLeaveErrorToNotice(error));
    },
    onSuccess: async (_result, variables) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice({
        messageKey: 'events.thumbsUp.success',
        tone: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', eventId, 'confirmed-players'],
        }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({
          queryKey: ['profile', 'player', variables.toUserId],
        }),
      ]);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelEvent,
    onSuccess: async (result) => {
      queryClient.setQueryData<EventDetail>(['events', 'detail', eventId], (current) =>
        current
          ? {
              ...current,
              status: result.status,
            }
          : current,
      );
      setNotice({
        messageKey: 'events.cancel.success',
        tone: 'info',
      });
      await invalidateEventRelatedQueries();
    },
    onError: (error) => {
      setNotice(mapJoinLeaveErrorToNotice(error));
    },
  });

  function currentSportSkillLevel(): number | null {
    if (!eventQuery.data || !ownSportProfilesQuery.data) {
      return null;
    }

    return (
      ownSportProfilesQuery.data.find(
        (profileRow) => profileRow.sportId === eventQuery.data?.sportId,
      )?.skillLevel ?? null
    );
  }

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

  function runJoinFlow(input: { skillLevel?: number | null } = {}) {
    if (!eventQuery.data) {
      return;
    }

    const selectedLevel = input.skillLevel ?? currentSportSkillLevel();
    const executeJoin = () => {
      setNotice(null);
      joinMutation.mutate({
        eventId,
        skillLevel: input.skillLevel ?? null,
      });
    };

    if (selectedLevel && isSkillOutsideRange(selectedLevel, eventQuery.data)) {
      Alert.alert(
        t('events.join.warningTitle'),
        t('events.join.warningBody', {
          range: t('events.join.warningRange', {
            min: t(`events.skillLevel.label.${eventQuery.data.skillMin}`),
            max: t(`events.skillLevel.label.${eventQuery.data.skillMax}`),
          }),
          level: t(`events.skillLevel.label.${selectedLevel}`),
        }),
        [
          {
            text: t('events.common.cancel'),
            style: 'cancel',
          },
          {
            text: t('events.join.warningContinue'),
            onPress: executeJoin,
          },
        ],
      );
      return;
    }

    executeJoin();
  }

  function handleJoinPress() {
    setNotice(null);

    if (!eventQuery.data) {
      return;
    }

    if (ownSportProfilesQuery.data && !currentSportSkillLevel()) {
      setSelectedSkillLevel(null);
      setIsSkillModalVisible(true);
      setNotice({
        messageKey: 'events.join.skillRequired',
        tone: 'info',
      });
      return;
    }

    runJoinFlow();
  }

  function handleSkillModalConfirm() {
    if (!selectedSkillLevel) {
      setIsSkillModalVisible(false);
      return;
    }

    setIsSkillModalVisible(false);
    runJoinFlow({
      skillLevel: selectedSkillLevel,
    });
  }

  function handleLeavePress() {
    setNotice(null);
    leaveMutation.mutate({ eventId });
  }

  function handleOpenChatPress() {
    navigation.navigate('Chat', { eventId });
  }

  function handleEditPress() {
    if (!eventQuery.data || !canOrganizerEditEvent(eventQuery.data)) {
      setNotice({
        messageKey: 'events.edit.errors.unavailable',
        tone: 'info',
      });
      return;
    }

    navigation.navigate('EditEvent', { eventId });
  }

  function handleCancelPress() {
    setNotice(null);
    Alert.alert(t('events.cancel.confirmTitle'), t('events.cancel.confirmBody'), [
      {
        text: t('events.common.cancel'),
        style: 'cancel',
      },
      {
        text: t('events.cancel.confirmAction'),
        style: 'destructive',
        onPress: () => {
          cancelMutation.mutate({ eventId });
        },
      },
    ]);
  }

  function handleRemovePlayerPress(targetUserId: string, playerName: string) {
    if (!eventQuery.data || !canOrganizerRemovePlayers(eventQuery.data)) {
      setNotice({
        messageKey: 'events.leave.errors.unavailable',
        tone: 'info',
      });
      return;
    }

    setNotice(null);
    Alert.alert(
      t('events.removePlayer.confirmTitle'),
      t('events.removePlayer.confirmBody', { player: playerName }),
      [
        {
          text: t('events.common.cancel'),
          style: 'cancel',
        },
        {
          text: t('events.removePlayer.confirmAction'),
          style: 'destructive',
          onPress: () => {
            removePlayerMutation.mutate({
              eventId,
              targetUserId,
            });
          },
        },
      ],
    );
  }

  function handleReportNoShowPress(targetUserId: string, playerName: string) {
    if (!eventQuery.data) {
      return;
    }

    setNotice(null);
    Alert.alert(
      t('events.noShow.confirmTitle'),
      t('events.noShow.confirmBody', { player: playerName }),
      [
        {
          text: t('events.common.cancel'),
          style: 'cancel',
        },
        {
          text: t('events.noShow.confirmAction'),
          style: 'destructive',
          onPress: () => {
            reportNoShowMutation.mutate({
              eventId,
              reportedUserId: targetUserId,
            });
          },
        },
      ],
    );
  }

  function handleThumbsUpPress(targetUserId: string) {
    setNotice(null);
    thumbsUpMutation.mutate({
      eventId,
      toUserId: targetUserId,
    });
  }

  const handleOpenReportMenu = useCallback(() => {
    Alert.alert(t('reports.menuTitle'), undefined, [
      {
        text: t('reports.reportEventAction'),
        onPress: () => {
          setNotice(null);
          setIsReportSheetVisible(true);
        },
      },
      {
        text: t('events.common.cancel'),
        style: 'cancel',
      },
    ]);
  }, [t]);

  if (eventQuery.isPending) {
    return (
      <DetailFrame
        bottomInset={insets.bottom}
        menuLabel={t('reports.overflowLabel')}
        onBack={() => navigation.goBack()}
        title={t('shell.eventDetail.title')}
        topInset={insets.top}
      >
        <View style={styles.statePanel}>
          <StateMessage
            body={t('events.detail.loadingSubtitle')}
            iconName="calendar-clear-outline"
            title={t('events.detail.loadingTitle')}
          />
        </View>
      </DetailFrame>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <DetailFrame
        bottomInset={insets.bottom}
        menuLabel={t('reports.overflowLabel')}
        onBack={() => navigation.goBack()}
        title={t('shell.eventDetail.title')}
        topInset={insets.top}
      >
        <View style={styles.statePanel}>
          <StateMessage
            action={
              <ActionButton
                iconName="refresh-outline"
                label={t('events.common.retry')}
                onPress={async () => {
                  await eventQuery.refetch();
                }}
                variant="secondary"
              />
            }
            body={t('events.detail.errorBody')}
            iconName="alert-circle-outline"
            title={t('events.detail.errorTitle')}
            tone="muted"
          />
        </View>
      </DetailFrame>
    );
  }

  const event = eventQuery.data;
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
  const confirmedPlayers = playersQuery.data ?? [];
  const joinOrLeaveBusy = joinMutation.isPending || leaveMutation.isPending;
  const viewerMembershipStatus = event.viewerMembershipStatus;
  const currentSkillLevel = currentSportSkillLevel();
  const canCancelEvent = canOrganizerCancelEvent(event);
  const canEditEvent = canOrganizerEditEvent(event);
  const canRemovePlayers = canOrganizerRemovePlayers(event);
  const canManageEvent = canCancelEvent;
  const canShowOrganizerTools = canManageEvent || canEditEvent;
  const canOpenChat =
    event.viewerMembershipStatus === 'organizer' || event.viewerMembershipStatus === 'confirmed';
  const canInvitePlayers = event.viewerMembershipStatus === 'organizer' && canManageEvent;
  const removePlayerTargetUserId = removePlayerMutation.variables?.targetUserId ?? null;
  const reportNoShowTargetUserId = reportNoShowMutation.variables?.reportedUserId ?? null;
  const thumbsUpTargetUserId = thumbsUpMutation.variables?.toUserId ?? null;
  const isJoinableWindow =
    (event.status === 'active' || event.status === 'full') &&
    new Date(event.startsAt).getTime() > Date.now();
  const isNoShowWindowOpen =
    event.status === 'finished' &&
    Boolean(event.noShowWindowEnd) &&
    new Date(event.noShowWindowEnd ?? '').getTime() > Date.now();
  const isThumbsUpWindowOpen =
    event.status === 'finished' &&
    Boolean(event.chatClosedAt) &&
    new Date(event.chatClosedAt ?? '').getTime() > Date.now();
  const hasEnoughPlayersForNoShow = hasEnoughConfirmedPlayersForNoShow(
    confirmedPlayers,
    event.organizerId,
  );
  const isNoShowEligibilityLoading =
    event.viewerMembershipStatus === 'organizer' && isNoShowWindowOpen && playersQuery.isPending;
  const canReportNoShows =
    event.viewerMembershipStatus === 'organizer' &&
    isNoShowWindowOpen &&
    !playersQuery.isPending &&
    hasEnoughPlayersForNoShow;
  const canGiveThumbsUp =
    isThumbsUpWindowOpen &&
    Boolean(userId) &&
    (event.viewerMembershipStatus === 'organizer' || event.viewerMembershipStatus === 'confirmed');
  const thumbsPromptPlayers = confirmedPlayers.filter(
    (player) => player.userId !== userId && !player.userId.startsWith('deleted-'),
  );
  const noShowReportPlayers = confirmedPlayers.filter(
    (player) =>
      player.userId !== event.organizerId &&
      !player.userId.startsWith('deleted-') &&
      !player.alreadyReportedNoShow,
  );
  const skillModalSport = {
    id: event.sportId,
    slug: event.sportSlug,
    nameCs: event.sportNameCs,
    nameEn: event.sportNameEn,
    iconName: event.sportIcon,
    colorHex: event.sportColor,
    sortOrder: 0,
  };
  const eventDescription = event.description ?? t('events.detail.noDescription');
  const chatSubtitle =
    event.status === 'cancelled'
      ? t('events.chat.cancelledBanner')
      : event.chatClosedAt && new Date(event.chatClosedAt).getTime() <= Date.now()
        ? t('events.chat.readOnlyFinished')
        : t('events.detail.chatShortcutSubtitle');

  let stateTitle = t('events.detail.state.joinTitle');
  let stateBody =
    event.status === 'full'
      ? t('events.detail.state.joinWaitlistBody')
      : t('events.detail.state.joinBody');
  let primaryAction: {
    label: string;
    onPress: () => void;
    iconName?: React.ComponentProps<typeof Ionicons>['name'];
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
  } | null = {
    label: joinMutation.isPending ? t('events.join.pending') : t('events.join.action'),
    iconName: 'checkmark-circle-outline',
    onPress: handleJoinPress,
    disabled: joinOrLeaveBusy || !isJoinableWindow,
  };

  if (event.status === 'cancelled') {
    stateTitle = t('events.detail.state.cancelledTitle');
    stateBody = t('events.detail.state.cancelledBody');
    primaryAction = null;
  } else if (event.status === 'finished') {
    stateTitle = t('events.detail.state.finishedTitle');
    stateBody = t('events.detail.state.finishedBody');
    primaryAction = null;
  } else if (!isJoinableWindow) {
    stateTitle = t('events.detail.state.closedTitle');
    stateBody = t('events.detail.state.closedBody');
    primaryAction = null;
  } else if (viewerMembershipStatus === 'organizer') {
    stateTitle = t('events.detail.state.organizerTitle');
    stateBody = t('events.detail.state.organizerBody');
    primaryAction = {
      label: t('events.detail.state.organizerLabel'),
      iconName: 'person-outline',
      onPress: () => undefined,
      variant: 'secondary',
      disabled: true,
    };
  } else if (viewerMembershipStatus === 'confirmed') {
    stateTitle = t('events.detail.state.confirmedTitle');
    stateBody = t('events.detail.state.confirmedBody');
    primaryAction = {
      label: leaveMutation.isPending ? t('events.leave.pending') : t('events.leave.action'),
      iconName: 'exit-outline',
      onPress: handleLeavePress,
      variant: 'secondary',
      disabled: joinOrLeaveBusy,
    };
  } else if (viewerMembershipStatus === 'waitlisted') {
    stateTitle = t('events.detail.state.waitlistedTitle', {
      position: event.viewerWaitlistPosition ?? '—',
    });
    stateBody = t('events.detail.state.waitlistedBody');
    primaryAction = {
      label: leaveMutation.isPending
        ? t('events.leave.waitlistPending')
        : t('events.leave.waitlistAction'),
      iconName: 'exit-outline',
      onPress: handleLeavePress,
      variant: 'secondary',
      disabled: joinOrLeaveBusy,
    };
  }

  return (
    <>
      <DetailFrame
        bottomInset={insets.bottom}
        menuLabel={t('reports.overflowLabel')}
        onBack={() => navigation.goBack()}
        onMenu={handleOpenReportMenu}
        title={t('shell.eventDetail.title')}
        topInset={insets.top}
      >
        <OrganizerHeroCard event={event} language={language} sportName={sportName} t={t} />

        <NoticeBanner notice={notice} resolveMessage={t} />

        {viewerMembershipStatus !== 'organizer' ? (
          <View style={styles.statusInfoCard}>
            <Text style={styles.statusTitle}>{stateTitle}</Text>
            <Text style={styles.bodyText}>{stateBody}</Text>
            {currentSkillLevel ? (
              <Text style={styles.helperText}>
                {t('events.detail.yourSkill', {
                  level: t(`events.skillLevel.label.${currentSkillLevel}`),
                })}
              </Text>
            ) : null}
            {primaryAction || canOpenChat ? (
              <View style={styles.inlineActions}>
                {primaryAction ? (
                  <View style={styles.inlineAction}>
                    <ActionButton
                      disabled={primaryAction.disabled}
                      iconName={primaryAction.iconName}
                      label={primaryAction.label}
                      onPress={primaryAction.onPress}
                      variant={primaryAction.variant}
                    />
                  </View>
                ) : null}
                {canOpenChat ? (
                  <View style={styles.inlineAction}>
                    <ActionButton
                      iconName="chatbubble-ellipses-outline"
                      label={t('events.chat.openAction')}
                      onPress={handleOpenChatPress}
                      variant={primaryAction ? 'secondary' : 'primary'}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {canShowOrganizerTools ? (
          <View style={styles.organizerToolsSection}>
            <SectionTitle
              eyebrow={t('events.detail.organizerToolsEyebrow')}
              title={t('events.organizerTools.title')}
            />
            <View style={styles.organizerToolGrid}>
              {canEditEvent ? (
                <OrganizerToolButton
                  disabled={cancelMutation.isPending || removePlayerMutation.isPending}
                  iconName="calendar-clear-outline"
                  label={t('events.organizerTools.editAction')}
                  onPress={handleEditPress}
                  tone="dark"
                />
              ) : null}
              {canManageEvent ? (
                <OrganizerToolButton
                  disabled={cancelMutation.isPending || removePlayerMutation.isPending}
                  iconName="close-outline"
                  label={
                    cancelMutation.isPending
                      ? t('events.cancel.pending')
                      : t('events.organizerTools.cancelAction')
                  }
                  onPress={handleCancelPress}
                  tone="light"
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.sectionStack}>
          <SectionTitle
            eyebrow={t('events.detail.playersEyebrow')}
            rightLabel={`${event.spotsTaken}/${event.playerCountTotal}`}
            title={t('events.detail.confirmedPlayersTitle')}
          />
          <ConfirmedPlayersCard
            canInvite={canInvitePlayers}
            canRemovePlayers={canRemovePlayers}
            event={event}
            isLoading={playersQuery.isPending}
            onInvite={handleShare}
            onOpenPlayer={(playerId) => navigation.navigate('PlayerProfile', { playerId })}
            onRemovePlayer={handleRemovePlayerPress}
            players={confirmedPlayers}
            removingUserId={removePlayerTargetUserId}
            t={t}
          />
        </View>

        <View style={styles.sectionStack}>
          <SectionTitle
            eyebrow={t('events.detail.whenWhereEyebrow')}
            title={t('events.detail.whenWhereTitle')}
          />
          <CompactDetailsCard event={event} eventDescription={eventDescription} t={t} />
        </View>

        <ChatShortcutCard
          canOpenChat={canOpenChat}
          onPress={handleOpenChatPress}
          subtitle={chatSubtitle}
          t={t}
        />

        {event.status === 'finished' ? (
          <ScreenCard title={t('events.noShow.title')}>
            {canReportNoShows ? (
              <>
                <Text style={styles.bodyText}>
                  {t('events.noShow.body', {
                    remaining: formatRelativeTime(event.noShowWindowEnd ?? '', language),
                  })}
                </Text>
                {noShowReportPlayers.length ? (
                  <View style={styles.playerList}>
                    {noShowReportPlayers.map((player) => {
                      const playerName =
                        formatDisplayName(player.firstName, player.lastName) ||
                        t('auth.home.defaultName');

                      return (
                        <View key={`no-show-${player.userId}`} style={styles.playerCard}>
                          <View style={styles.playerIdentityPressable}>
                            <AvatarPhoto label={playerName} uri={player.photoUrl} />
                            <View style={styles.playerCopy}>
                              <Text style={styles.playerName}>{playerName}</Text>
                              <Text style={styles.playerMeta}>
                                {t('events.detail.playerStats', {
                                  games: player.gamesPlayed,
                                  noShows: player.noShows,
                                })}
                              </Text>
                            </View>
                          </View>
                          <ActionButton
                            disabled={
                              reportNoShowMutation.isPending &&
                              reportNoShowTargetUserId === player.userId
                            }
                            iconName="alert-circle-outline"
                            label={
                              reportNoShowMutation.isPending &&
                              reportNoShowTargetUserId === player.userId
                                ? t('events.noShow.pending')
                                : t('events.noShow.action')
                            }
                            onPress={() => handleReportNoShowPress(player.userId, playerName)}
                            variant="secondary"
                          />
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <StateMessage
                    body={t('events.noShow.noneLeft')}
                    compact
                    iconName="checkmark-done-outline"
                    title={t('common.allSet')}
                    tone="warm"
                  />
                )}
              </>
            ) : isNoShowEligibilityLoading ? (
              <View style={styles.centeredBlock}>
                <ActivityIndicator color="#183153" />
              </View>
            ) : (
              <Text style={styles.bodyText}>
                {event.viewerMembershipStatus !== 'organizer'
                  ? t('events.noShow.organizerOnly')
                  : isNoShowWindowOpen && !hasEnoughPlayersForNoShow
                    ? t('events.noShow.minimumPlayersBody')
                    : t('events.noShow.closedBody')}
              </Text>
            )}
          </ScreenCard>
        ) : null}

        {event.status === 'finished' ? (
          <ScreenCard title={t('events.thumbsUp.title')}>
            {canGiveThumbsUp ? (
              <>
                <Text style={styles.bodyText}>
                  {t('events.thumbsUp.body', {
                    remaining: formatRelativeTime(event.chatClosedAt ?? '', language),
                  })}
                </Text>
                {thumbsPromptPlayers.length ? (
                  <View style={styles.playerList}>
                    {thumbsPromptPlayers.map((player) => {
                      const playerName =
                        formatDisplayName(player.firstName, player.lastName) ||
                        t('auth.home.defaultName');

                      return (
                        <View key={`thumbs-${player.userId}`} style={styles.playerCard}>
                          <View style={styles.playerIdentityPressable}>
                            <AvatarPhoto label={playerName} uri={player.photoUrl} />
                            <View style={styles.playerCopy}>
                              <Text style={styles.playerName}>{playerName}</Text>
                              <Text style={styles.playerMeta}>
                                {player.skillLevel
                                  ? t(`events.skillLevel.label.${player.skillLevel}`)
                                  : t('events.detail.skillUnknown')}
                              </Text>
                            </View>
                          </View>
                          <ActionButton
                            disabled={
                              player.alreadyThumbedUpByViewer ||
                              (thumbsUpMutation.isPending && thumbsUpTargetUserId === player.userId)
                            }
                            iconName={
                              player.alreadyThumbedUpByViewer
                                ? 'checkmark-outline'
                                : 'thumbs-up-outline'
                            }
                            label={
                              player.alreadyThumbedUpByViewer
                                ? t('events.thumbsUp.done')
                                : thumbsUpMutation.isPending &&
                                    thumbsUpTargetUserId === player.userId
                                  ? t('events.thumbsUp.pending')
                                  : t('events.thumbsUp.action')
                            }
                            onPress={() => handleThumbsUpPress(player.userId)}
                            variant={player.alreadyThumbedUpByViewer ? 'secondary' : 'primary'}
                          />
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <StateMessage
                    body={t('events.thumbsUp.empty')}
                    compact
                    iconName="heart-outline"
                    title={t('common.allSet')}
                    tone="warm"
                  />
                )}
              </>
            ) : (
              <Text style={styles.bodyText}>{t('events.thumbsUp.closedBody')}</Text>
            )}
          </ScreenCard>
        ) : null}
      </DetailFrame>

      <SkillLevelModal
        language={language}
        onClose={() => setIsSkillModalVisible(false)}
        onConfirm={handleSkillModalConfirm}
        onSelectSkillLevel={setSelectedSkillLevel}
        selectedSkillLevel={selectedSkillLevel}
        sport={skillModalSport}
        subtitleKey="events.join.skillModalSubtitle"
        visible={isSkillModalVisible}
      />
      <ReportSheet
        onClose={() => setIsReportSheetVisible(false)}
        onSubmitted={setNotice}
        target={{
          type: 'event',
          eventId,
          title: `${sportName} · ${event.venueName}`,
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
  detailRoot: {
    flex: 1,
    backgroundColor: '#f4f0e8',
  },
  detailTopBar: {
    minHeight: 74,
    paddingHorizontal: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailTopButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#071426',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  detailTopTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    color: '#071426',
  },
  detailContent: {
    paddingHorizontal: 20,
    gap: 16,
  },
  statePanel: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#ffffff',
    shadowColor: '#071426',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  organizerHeroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 24,
    backgroundColor: '#071426',
    shadowColor: '#071426',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 7,
  },
  organizerHeroGrid: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 214,
    height: 166,
    opacity: 0.32,
  },
  organizerHeroGridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 92,
    width: 1,
    backgroundColor: 'rgba(148, 164, 187, 0.32)',
  },
  organizerHeroGridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 88,
    height: 1,
    backgroundColor: 'rgba(148, 164, 187, 0.32)',
  },
  organizerHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  organizerSportPill: {
    minHeight: 27,
    maxWidth: 128,
    borderRadius: 999,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#d8ff45',
  },
  organizerSportPillLabel: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#071426',
    textTransform: 'uppercase',
  },
  organizerHeroMeta: {
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#9fb0c8',
    textTransform: 'uppercase',
  },
  organizerHeroTitle: {
    marginTop: 24,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    color: '#ffffff',
  },
  organizerHeroLocationRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  organizerHeroLocation: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#a9bbd5',
  },
  organizerHeroDivider: {
    marginTop: 18,
    marginBottom: 18,
    height: 1,
    backgroundColor: 'rgba(160, 177, 202, 0.18)',
  },
  organizerHeroLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#8e9bb0',
    textTransform: 'uppercase',
  },
  organizerHeroDateRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  organizerHeroDate: {
    flex: 1,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    color: '#ffffff',
  },
  organizerHeroTimePill: {
    minHeight: 25,
    maxWidth: 132,
    borderRadius: 7,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(216, 255, 69, 0.22)',
  },
  organizerHeroTimePillLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#d8ff45',
  },
  statusInfoCard: {
    borderRadius: 22,
    padding: 16,
    gap: 10,
    backgroundColor: '#ffffff',
    shadowColor: '#071426',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  organizerToolsSection: {
    gap: 12,
  },
  organizerToolGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  organizerToolButton: {
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  organizerToolButtonDark: {
    backgroundColor: '#071426',
  },
  organizerToolButtonLight: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eee9df',
  },
  organizerToolButtonDisabled: {
    opacity: 0.55,
  },
  organizerToolButtonLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#071426',
    textAlign: 'center',
  },
  organizerToolButtonLabelDark: {
    color: '#ffffff',
  },
  sectionStack: {
    gap: 10,
  },
  sectionTitleBlock: {
    gap: 2,
    paddingHorizontal: 4,
  },
  sectionEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#9a948a',
    textTransform: 'uppercase',
  },
  sectionRightLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
    color: '#071426',
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    color: '#071426',
  },
  playersPanel: {
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#ffffff',
  },
  playerSlotRow: {
    minHeight: 64,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee9df',
  },
  playerSlotRowLast: {
    borderBottomWidth: 0,
  },
  playerSlotIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerSlotCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  playerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  playerSlotName: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#071426',
  },
  organizerMiniLabel: {
    flexShrink: 0,
    marginLeft: 4,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    color: '#ff503f',
    textTransform: 'uppercase',
  },
  playerSlotMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: '#8d9299',
  },
  playerSlotActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  confirmedPill: {
    minHeight: 23,
    borderRadius: 7,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c9ffe4',
  },
  confirmedPillLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    color: '#00864f',
    textTransform: 'uppercase',
  },
  removePlayerIconButton: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff1ef',
  },
  openSlotIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d4d6da',
  },
  openSlotText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 18,
    color: '#989da4',
  },
  inviteButton: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#071426',
  },
  inviteButtonLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
    color: '#ffffff',
  },
  moreSlotsRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fbfaf7',
  },
  moreSlotsText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8d9299',
  },
  detailsPanel: {
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#ffffff',
  },
  detailsRow: {
    minHeight: 40,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee9df',
  },
  detailsRowLast: {
    borderBottomWidth: 0,
  },
  descriptionDetailsRow: {
    alignItems: 'flex-start',
  },
  detailsLabel: {
    width: 104,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#ff503f',
    textTransform: 'uppercase',
  },
  detailsValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: '#071426',
  },
  chatShortcutCard: {
    minHeight: 72,
    borderRadius: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#ffffff',
    shadowColor: '#071426',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  },
  chatShortcutIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#071426',
  },
  chatShortcutCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  chatShortcutTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    color: '#071426',
  },
  chatShortcutSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: '#8d9299',
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
  summaryHighlightList: {
    gap: 10,
  },
  summaryHighlightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#f6efe5',
    borderWidth: 1,
    borderColor: '#eadfce',
  },
  summaryHighlightIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7edf4',
  },
  summaryHighlightCopy: {
    flex: 1,
    gap: 2,
  },
  summaryHighlightLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#a16a42',
  },
  summaryHighlightValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  summaryHighlightMeta: {
    fontSize: 13,
    lineHeight: 19,
    color: '#6d7f95',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusPanel: {
    gap: 6,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#f8f1e6',
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
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
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  inlineAction: {
    flexBasis: 160,
    flexGrow: 1,
  },
  detailSectionDivider: {
    height: 1,
    backgroundColor: '#efe2d1',
  },
  compactSection: {
    gap: 6,
  },
  compactSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#183153',
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
  organizerPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  playerList: {
    gap: 10,
  },
  playerCard: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf5',
    padding: 14,
  },
  playerIdentityPressable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  playerPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
