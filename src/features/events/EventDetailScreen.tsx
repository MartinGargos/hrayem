import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import {
  canOrganizerCancelEvent,
  canOrganizerEditEvent,
  canOrganizerRemovePlayers,
  hasEnoughConfirmedPlayersForNoShow,
} from './event-eligibility';
import { AvatarPhoto, InfoPill, SportBadge } from './EventPrimitives';
import { SkillLevelModal } from './SkillLevelModal';
import { DetailRow, ScreenCard, ScreenShell } from '../../components/ScreenShell';
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
import type { AppNotice } from '../../types/app';
import type {
  EventConfirmedPlayer,
  EventDetail,
  EventMembershipStatus,
  JoinEventResponse,
  LeaveEventResponse,
} from '../../types/events';
import { formatEventDate, formatEventTime, formatRelativeTime } from '../../utils/dates';

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
  }

  return {
    messageKey: 'events.common.errors.generic',
    tone: 'error',
  };
}

export function EventDetailScreen({ route }: EventDetailScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const userId = useAuthStore((state) => state.userId);
  const eventId = route.params.eventId;
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [isSkillModalVisible, setIsSkillModalVisible] = useState(false);
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
  const organizerPlayer = confirmedPlayers.find((player) => player.userId === event.organizerId);
  const canOpenOrganizerProfile = Boolean(
    event.organizerId &&
    (event.organizerFirstName || event.organizerLastName || event.organizerPhotoUrl),
  );
  const joinOrLeaveBusy = joinMutation.isPending || leaveMutation.isPending;
  const viewerMembershipStatus = event.viewerMembershipStatus;
  const currentSkillLevel = currentSportSkillLevel();
  const canCancelEvent = canOrganizerCancelEvent(event);
  const canEditEvent = canOrganizerEditEvent(event);
  const canRemovePlayers = canOrganizerRemovePlayers(event);
  const canManageEvent = canCancelEvent;
  const canOpenChat =
    event.viewerMembershipStatus === 'organizer' || event.viewerMembershipStatus === 'confirmed';
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

  let stateTitle = t('events.detail.state.joinTitle');
  let stateBody =
    event.status === 'full'
      ? t('events.detail.state.joinWaitlistBody')
      : t('events.detail.state.joinBody');
  let primaryAction: {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
  } | null = {
    label: joinMutation.isPending ? t('events.join.pending') : t('events.join.action'),
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
      onPress: () => undefined,
      variant: 'secondary',
      disabled: true,
    };
  } else if (viewerMembershipStatus === 'confirmed') {
    stateTitle = t('events.detail.state.confirmedTitle');
    stateBody = t('events.detail.state.confirmedBody');
    primaryAction = {
      label: leaveMutation.isPending ? t('events.leave.pending') : t('events.leave.action'),
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
      onPress: handleLeavePress,
      variant: 'secondary',
      disabled: joinOrLeaveBusy,
    };
  }

  return (
    <>
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

        <ScreenCard title={t('events.detail.yourStatusTitle')}>
          <NoticeBanner notice={notice} resolveMessage={t} />
          <Text style={styles.statusTitle}>{stateTitle}</Text>
          <Text style={styles.bodyText}>{stateBody}</Text>
          {currentSkillLevel ? (
            <Text style={styles.helperText}>
              {t('events.detail.yourSkill', {
                level: t(`events.skillLevel.label.${currentSkillLevel}`),
              })}
            </Text>
          ) : null}
          {primaryAction ? (
            <ActionButton
              disabled={primaryAction.disabled}
              label={primaryAction.label}
              onPress={primaryAction.onPress}
              variant={primaryAction.variant}
            />
          ) : null}
          {canOpenChat ? (
            <ActionButton
              label={t('events.chat.openAction')}
              onPress={handleOpenChatPress}
              variant="secondary"
            />
          ) : null}
        </ScreenCard>

        {canManageEvent ? (
          <ScreenCard title={t('events.organizerTools.title')}>
            <Text style={styles.bodyText}>{t('events.organizerTools.body')}</Text>
            {canEditEvent ? (
              <ActionButton
                disabled={cancelMutation.isPending || removePlayerMutation.isPending}
                label={t('events.organizerTools.editAction')}
                onPress={handleEditPress}
              />
            ) : null}
            <ActionButton
              disabled={cancelMutation.isPending || removePlayerMutation.isPending}
              label={
                cancelMutation.isPending
                  ? t('events.cancel.pending')
                  : t('events.organizerTools.cancelAction')
              }
              onPress={handleCancelPress}
              variant="secondary"
            />
          </ScreenCard>
        ) : null}

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
          <Text style={styles.bodyText}>
            {event.description ?? t('events.detail.noDescription')}
          </Text>
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
              {organizerPlayer && organizerPlayer.thumbsUpPercentage !== null ? (
                <Text style={styles.helperText}>
                  {t('events.detail.thumbsUpPercentage', {
                    percentage: organizerPlayer.thumbsUpPercentage,
                  })}
                </Text>
              ) : (
                <Text style={styles.helperText}>{t('events.detail.thumbsUpPercentageHidden')}</Text>
              )}
            </View>
          </View>
          {organizerPlayer?.isPlayAgainConnection ? (
            <InfoPill accentColor="#183153">{t('events.detail.playAgainBadge')}</InfoPill>
          ) : null}
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
                  <View key={player.userId} style={styles.playerCard}>
                    <Pressable
                      onPress={() =>
                        navigation.navigate('PlayerProfile', { playerId: player.userId })
                      }
                      style={styles.playerIdentityPressable}
                    >
                      <AvatarPhoto label={playerName} uri={player.photoUrl} />
                      <View style={styles.playerCopy}>
                        <Text style={styles.playerName}>{playerName}</Text>
                        <Text style={styles.playerMeta}>
                          {player.skillLevel
                            ? t(`events.skillLevel.label.${player.skillLevel}`)
                            : t('events.detail.skillUnknown')}
                        </Text>
                        <Text style={styles.playerMeta}>
                          {t('events.detail.playerStats', {
                            games: player.gamesPlayed,
                            noShows: player.noShows,
                          })}
                        </Text>
                        {player.thumbsUpPercentage !== null ? (
                          <Text style={styles.playerMeta}>
                            {t('events.detail.thumbsUpPercentage', {
                              percentage: player.thumbsUpPercentage,
                            })}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.playerPills}>
                        {player.skillLevel ? (
                          <InfoPill>{t(`events.skillLevel.short.${player.skillLevel}`)}</InfoPill>
                        ) : null}
                        {player.isPlayAgainConnection ? (
                          <InfoPill accentColor="#183153">
                            {t('events.detail.playAgainBadge')}
                          </InfoPill>
                        ) : null}
                      </View>
                    </Pressable>
                    {canRemovePlayers && player.userId !== event.organizerId ? (
                      <ActionButton
                        disabled={
                          removePlayerMutation.isPending &&
                          removePlayerTargetUserId === player.userId
                        }
                        label={
                          removePlayerMutation.isPending &&
                          removePlayerTargetUserId === player.userId
                            ? t('events.removePlayer.pending')
                            : t('events.removePlayer.action')
                        }
                        onPress={() => handleRemovePlayerPress(player.userId, playerName)}
                        variant="secondary"
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.bodyText}>{t('events.detail.confirmedPlayersEmpty')}</Text>
          )}
        </ScreenCard>

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
                        [player.firstName, player.lastName].filter(Boolean).join(' ') ||
                        t('events.common.organizerFallback');

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
                  <Text style={styles.helperText}>{t('events.noShow.noneLeft')}</Text>
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
                        [player.firstName, player.lastName].filter(Boolean).join(' ') ||
                        t('events.common.organizerFallback');

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
                  <Text style={styles.helperText}>{t('events.thumbsUp.empty')}</Text>
                )}
              </>
            ) : (
              <Text style={styles.bodyText}>{t('events.thumbsUp.closedBody')}</Text>
            )}
          </ScreenCard>
        ) : null}
      </ScreenShell>

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
    </>
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
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf9',
    padding: 14,
  },
  playerIdentityPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerPills: {
    alignItems: 'flex-end',
    gap: 6,
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
