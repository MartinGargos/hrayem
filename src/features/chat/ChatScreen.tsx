import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { isChatChannelReconnectNeeded, shouldRecoverChatOnForeground } from './chat-realtime';
import { ScreenCard } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import {
  EdgeFunctionError,
  fetchEventChatMessages,
  fetchEventDetail,
  sendEventMessage,
} from '../../services/events';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage, AppNotice } from '../../types/app';
import type { ChatMessage, EventDetail } from '../../types/events';
import { formatEventCompactDate, formatEventTime, formatRelativeTime } from '../../utils/dates';
import { translatePlural } from '../../utils/pluralization';

type ChatScreenProps = NativeStackScreenProps<RootStackParamList, 'Chat'>;
type ChatIconName = ComponentProps<typeof Ionicons>['name'];

const CHAT_KEYBOARD_GAP = 8;

type MessageFormValues = {
  body: string;
};

type ChatStateViewProps = {
  actionLabel?: string;
  body: string;
  iconName: ChatIconName;
  onAction?: () => void | Promise<void>;
  title: string;
};

type ChatBannerProps = {
  iconName: ChatIconName;
  text: string;
  tone?: 'default' | 'muted';
};

type ChatTimelineItem =
  | {
      id: string;
      label: string;
      type: 'divider';
    }
  | {
      id: string;
      message: ChatMessage;
      type: 'message';
    };

function createMessageSchema(t: (key: string, options?: Record<string, unknown>) => string) {
  return z.object({
    body: z
      .string()
      .trim()
      .min(1, t('events.chat.validation.bodyRequired'))
      .max(1_000, t('events.chat.validation.bodyLength')),
  });
}

function getLocalDateKey(input: string): string {
  const date = new Date(input);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isToday(input: string): boolean {
  return getLocalDateKey(input) === getLocalDateKey(new Date().toISOString());
}

function getTimelineDividerLabel(
  input: string,
  language: AppLanguage,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return isToday(input) ? t('events.chat.todayDivider') : formatEventCompactDate(input, language);
}

function buildChatTimeline(
  messages: ChatMessage[],
  language: AppLanguage,
  t: ReturnType<typeof useTranslation>['t'],
): ChatTimelineItem[] {
  const sortedMessages = [...messages].sort(
    (first, second) => new Date(first.sentAt).getTime() - new Date(second.sentAt).getTime(),
  );
  const timelineItems: ChatTimelineItem[] = [];
  let currentDateKey: string | null = null;

  sortedMessages.forEach((message) => {
    const nextDateKey = getLocalDateKey(message.sentAt);

    if (nextDateKey !== currentDateKey) {
      timelineItems.push({
        id: `divider-${nextDateKey}`,
        label: getTimelineDividerLabel(message.sentAt, language, t),
        type: 'divider',
      });
      currentDateKey = nextDateKey;
    }

    timelineItems.push({
      id: message.id,
      message,
      type: 'message',
    });
  });

  return timelineItems;
}

function canAccessEventChat(event: EventDetail): boolean {
  return (
    event.viewerMembershipStatus === 'organizer' || event.viewerMembershipStatus === 'confirmed'
  );
}

function isEventChatReadOnly(event: EventDetail): boolean {
  if (event.status === 'cancelled') {
    return true;
  }

  if (!event.chatClosedAt) {
    return false;
  }

  return new Date(event.chatClosedAt).getTime() <= Date.now();
}

function mapChatErrorToNotice(error: unknown): AppNotice {
  if (error instanceof EdgeFunctionError) {
    if (error.code === 'CHAT_CLOSED') {
      return {
        messageKey: 'events.chat.errors.closed',
        tone: 'info',
      };
    }

    if (error.code === 'FORBIDDEN') {
      return {
        messageKey: 'events.chat.errors.forbidden',
        tone: 'info',
      };
    }

    if (error.code === 'VALIDATION_ERROR') {
      return {
        messageKey: 'events.chat.errors.validation',
        tone: 'error',
      };
    }

    if (error.code === 'RATE_LIMITED') {
      return {
        messageKey: 'events.chat.errors.rateLimited',
        tone: 'info',
      };
    }
  }

  return {
    messageKey: 'events.chat.errors.generic',
    tone: 'error',
  };
}

function upsertChatMessage(
  messages: ChatMessage[] | undefined,
  nextMessage: ChatMessage,
): ChatMessage[] {
  const currentMessages = messages ?? [];
  const existingIndex = currentMessages.findIndex((message) => message.id === nextMessage.id);

  if (existingIndex >= 0) {
    const nextMessages = [...currentMessages];
    nextMessages[existingIndex] = nextMessage;
    return nextMessages;
  }

  return [nextMessage, ...currentMessages];
}

function ChatStateView({ actionLabel, body, iconName, onAction, title }: ChatStateViewProps) {
  return (
    <StateMessage
      action={
        actionLabel && onAction ? (
          <ActionButton
            iconName={iconName === 'cloud-offline-outline' ? 'refresh-outline' : undefined}
            label={actionLabel}
            onPress={onAction}
            variant={iconName === 'cloud-offline-outline' ? 'secondary' : 'primary'}
          />
        ) : undefined
      }
      body={body}
      iconName={iconName}
      title={title}
      tone={
        iconName === 'sparkles-outline'
          ? 'warm'
          : iconName === 'cloud-offline-outline'
            ? 'muted'
            : 'default'
      }
    />
  );
}

function ChatBanner({ iconName, text, tone = 'default' }: ChatBannerProps) {
  return (
    <View style={[styles.banner, tone === 'muted' ? styles.bannerMuted : undefined]}>
      <View style={[styles.bannerIconWrap, tone === 'muted' ? styles.bannerIconWrapMuted : null]}>
        <Ionicons color={tone === 'muted' ? '#8a694f' : '#183153'} name={iconName} size={16} />
      </View>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

type ChatHeaderProps = {
  event: EventDetail;
  language: AppLanguage;
  onBack: () => void;
  onOpenEvent: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  topInset: number;
};

function ChatHeader({ event, language, onBack, onOpenEvent, t, topInset }: ChatHeaderProps) {
  const title = `${event.venueName} · ${formatEventCompactDate(event.startsAt, language)}`;

  return (
    <View style={[styles.header, { paddingTop: topInset + 8 }]}>
      <Pressable
        accessibilityLabel={t('events.chat.backAction')}
        accessibilityRole="button"
        onPress={onBack}
        style={styles.headerButton}
      >
        <Ionicons color="#10233f" name="chevron-back" size={25} />
      </Pressable>

      <Pressable
        accessibilityLabel={t('events.chat.openEventAction')}
        accessibilityRole="button"
        onPress={onOpenEvent}
        style={styles.headerCopy}
      >
        <Text numberOfLines={2} style={styles.headerTitle}>
          {title}
        </Text>
        <View style={styles.headerMetaRow}>
          <View style={styles.headerStatusDot} />
          <Text numberOfLines={1} style={styles.headerMeta}>
            {t('events.chat.headerMeta', {
              players: translatePlural(t, language, 'events.chat.playersCount', event.spotsTaken),
              status: t(`events.chat.status.${event.status}`),
            })}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityLabel={t('events.chat.openEventAction')}
        accessibilityRole="button"
        onPress={onOpenEvent}
        style={styles.headerButton}
      >
        <Ionicons color="#10233f" name="tennisball-outline" size={20} />
      </Pressable>
    </View>
  );
}

type EventSummaryCardProps = {
  event: EventDetail;
  language: AppLanguage;
  onPress: () => void;
  sportName: string;
  t: ReturnType<typeof useTranslation>['t'];
};

function EventSummaryCard({ event, language, onPress, sportName, t }: EventSummaryCardProps) {
  return (
    <Pressable
      accessibilityLabel={t('events.chat.openEventAction')}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.eventCard}
    >
      <View style={styles.eventIconWrap}>
        <Ionicons color="#071426" name="tennisball-outline" size={20} />
      </View>
      <View style={styles.eventCardCopy}>
        <Text numberOfLines={2} style={styles.eventCardTitle}>
          {t('events.chat.summaryTitle', {
            sport: sportName,
            time: formatEventTime(event.startsAt, language),
            venue: event.venueName,
          })}
        </Text>
        <Text numberOfLines={1} style={styles.eventCardMeta}>
          {t('events.chat.summaryMeta', {
            count: event.playerCountTotal,
            current: event.spotsTaken,
            time: formatRelativeTime(event.startsAt, language),
            total: event.playerCountTotal,
          })}
        </Text>
      </View>
      <Ionicons color="#d8ff45" name="arrow-forward" size={18} />
    </Pressable>
  );
}

function ChatDateDivider({ label }: { label: string }) {
  return (
    <View style={styles.dateDivider}>
      <View style={styles.dateDividerLine} />
      <Text style={styles.dateDividerLabel}>{label}</Text>
      <View style={styles.dateDividerLine} />
    </View>
  );
}

function ChatAvatar({ label, uri }: { label: string; uri: string | null }) {
  const initial = label.trim().slice(0, 1).toUpperCase() || '?';

  return uri ? (
    <Image accessibilityLabel={label} contentFit="cover" source={{ uri }} style={styles.avatar} />
  ) : (
    <View accessibilityLabel={label} style={styles.avatarFallback}>
      <Text style={styles.avatarFallbackText}>{initial}</Text>
    </View>
  );
}

type ChatMessageRowProps = {
  item: ChatMessage;
  t: ReturnType<typeof useTranslation>['t'];
  userId: string | null;
};

function ChatMessageRow({ item, t, userId }: ChatMessageRowProps) {
  const isOwnMessage = item.userId === userId;
  const authorName =
    [item.authorFirstName, item.authorLastName].filter(Boolean).join(' ') ||
    t('events.chat.deletedParticipant');
  const body = item.isDeleted ? t('events.chat.deletedBody') : item.body;

  if (isOwnMessage) {
    return (
      <View style={[styles.messageRow, styles.messageRowOwn]}>
        <View
          style={[
            styles.messageBubble,
            styles.messageBubbleOwnSize,
            item.isDeleted ? styles.messageBubbleDeleted : styles.messageBubbleOwn,
          ]}
        >
          <Text
            style={[
              styles.messageBody,
              item.isDeleted ? styles.messageBodyDeleted : styles.messageBodyOwn,
            ]}
          >
            {body}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.messageRow}>
      <ChatAvatar label={authorName} uri={item.authorPhotoUrl} />
      <View style={styles.messageColumn}>
        <Text numberOfLines={1} style={styles.messageAuthor}>
          {authorName}
        </Text>
        <View
          style={[
            styles.messageBubble,
            item.isDeleted ? styles.messageBubbleDeleted : styles.messageBubbleOther,
          ]}
        >
          <Text style={[styles.messageBody, item.isDeleted ? styles.messageBodyDeleted : null]}>
            {body}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function ChatScreen({ navigation, route }: ChatScreenProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isScreenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const language = useUserStore((state) => state.language);
  const userId = useAuthStore((state) => state.userId);
  const eventId = route.params.eventId;
  const messageListRef = useRef<FlatList<ChatTimelineItem>>(null);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [channelReconnectNonce, setChannelReconnectNonce] = useState(0);
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const footerBottomPadding = Platform.OS === 'ios' ? Math.max(insets.bottom, 14) : 14;

  const messageForm = useForm<MessageFormValues>({
    resolver: zodResolver(createMessageSchema(t)),
    mode: 'onChange',
    defaultValues: {
      body: '',
    },
  });

  const eventQuery = useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: () => fetchEventDetail(eventId),
    staleTime: 10_000,
  });

  const canReadMessages = Boolean(eventQuery.data && canAccessEventChat(eventQuery.data));

  const messagesQuery = useQuery({
    queryKey: ['events', 'chat', eventId, 'messages'],
    queryFn: () => fetchEventChatMessages(eventId),
    enabled: canReadMessages,
    staleTime: 10_000,
  });
  const timelineItems = useMemo(
    () => buildChatTimeline(messagesQuery.data ?? [], language, t),
    [language, messagesQuery.data, t],
  );

  const requestChannelReconnect = useCallback(() => {
    setChannelReconnectNonce((current) => current + 1);
  }, []);

  const scrollToLatestMessage = useCallback(() => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const refetchChatState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['events', 'chat', eventId, 'messages'] }),
    ]);
  }, [eventId, queryClient]);

  useEffect(() => {
    if (!canReadMessages) {
      return;
    }

    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let channel = supabase.channel(`event:${eventId}:chat:${channelReconnectNonce}`);

    const connect = () => {
      channel = supabase
        .channel(`event:${eventId}:chat:${channelReconnectNonce}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void refetchChatState();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'event_players',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void refetchChatState();
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
            void refetchChatState();
          },
        );

      channel.subscribe((status) => {
        if (!active) {
          return;
        }

        if (isChatChannelReconnectNeeded(status)) {
          void supabase.removeChannel(channel);

          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }

          reconnectTimer = setTimeout(() => {
            if (active) {
              requestChannelReconnect();
            }
          }, 1_500);
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
  }, [canReadMessages, channelReconnectNonce, eventId, refetchChatState, requestChannelReconnect]);

  useEffect(() => {
    if (!canReadMessages) {
      return;
    }

    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (
        !shouldRecoverChatOnForeground({
          appStateStatus: status,
          canReadMessages,
          isScreenFocused,
        })
      ) {
        return;
      }

      requestChannelReconnect();
      void refetchChatState();
    });

    return () => subscription.remove();
  }, [canReadMessages, isScreenFocused, refetchChatState, requestChannelReconnect]);

  useEffect(() => {
    function handleKeyboardFrame(event: KeyboardEvent) {
      setKeyboardBottomInset(Math.max(0, windowHeight - event.endCoordinates.screenY));
    }

    function handleKeyboardHide() {
      setKeyboardBottomInset(0);
    }

    const frameSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      handleKeyboardFrame,
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      handleKeyboardHide,
    );

    return () => {
      frameSubscription.remove();
      hideSubscription.remove();
    };
  }, [windowHeight]);

  const sendMessageMutation = useMutation({
    mutationFn: sendEventMessage,
    onSuccess: async (message) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      messageForm.reset({
        body: '',
      });
      setNotice(null);
      queryClient.setQueryData<ChatMessage[]>(['events', 'chat', eventId, 'messages'], (current) =>
        upsertChatMessage(current, message),
      );
      await refetchChatState();
    },
    onError: (error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setNotice(mapChatErrorToNotice(error));
    },
  });

  async function handleSendMessage(values: MessageFormValues) {
    if (!eventQuery.data) {
      return;
    }

    if (!canAccessEventChat(eventQuery.data)) {
      setNotice({
        messageKey: 'events.chat.errors.forbidden',
        tone: 'info',
      });
      return;
    }

    if (isEventChatReadOnly(eventQuery.data)) {
      setNotice({
        messageKey: 'events.chat.errors.closed',
        tone: 'info',
      });
      return;
    }

    setNotice(null);
    await sendMessageMutation.mutateAsync({
      eventId,
      body: values.body,
    });
  }

  if (eventQuery.isPending) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
        {isScreenFocused ? <StatusBar style="dark" /> : null}
        <ScreenCard title={t('events.chat.loadingTitle')}>
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        </ScreenCard>
      </View>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
        {isScreenFocused ? <StatusBar style="dark" /> : null}
        <ScreenCard>
          <ChatStateView
            actionLabel={t('events.common.retry')}
            body={t('events.chat.errorBody')}
            iconName="alert-circle-outline"
            onAction={async () => {
              await eventQuery.refetch();
            }}
            title={t('events.chat.errorTitle')}
          />
        </ScreenCard>
      </View>
    );
  }

  const event = eventQuery.data;
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
  const canOpenChat = canAccessEventChat(event);
  const isReadOnly = isEventChatReadOnly(event);
  const finishedCountdownVisible =
    event.status === 'finished' &&
    Boolean(event.chatClosedAt) &&
    new Date(event.chatClosedAt ?? '').getTime() > Date.now();
  const showInput = canOpenChat && !isReadOnly;
  const keyboardLift =
    keyboardBottomInset > 0
      ? Math.max(0, keyboardBottomInset - footerBottomPadding + CHAT_KEYBOARD_GAP)
      : 0;

  return (
    <View style={styles.keyboardWrap}>
      {isScreenFocused ? <StatusBar style="dark" /> : null}
      <View style={styles.screen}>
        <ChatHeader
          event={event}
          language={language}
          onBack={() => navigation.goBack()}
          onOpenEvent={() => navigation.navigate('EventDetail', { eventId })}
          t={t}
          topInset={insets.top}
        />

        <View style={styles.content}>
          <EventSummaryCard
            event={event}
            language={language}
            onPress={() => navigation.navigate('EventDetail', { eventId })}
            sportName={sportName}
            t={t}
          />
          <NoticeBanner notice={notice} resolveMessage={t} />

          {!canOpenChat ? (
            <ScreenCard>
              <ChatStateView
                body={t('events.chat.forbiddenBody')}
                iconName="lock-closed-outline"
                title={t('events.chat.forbiddenTitle')}
              />
            </ScreenCard>
          ) : (
            <>
              {event.status === 'cancelled' ? (
                <ChatBanner
                  iconName="close-circle-outline"
                  text={t('events.chat.cancelledBanner')}
                  tone="muted"
                />
              ) : null}

              {finishedCountdownVisible ? (
                <ChatBanner
                  iconName="time-outline"
                  text={t('events.chat.finishedBanner', {
                    remaining: formatRelativeTime(event.chatClosedAt ?? '', language),
                  })}
                />
              ) : null}

              {event.status === 'finished' && isReadOnly ? (
                <ChatBanner
                  iconName="lock-closed-outline"
                  text={t('events.chat.readOnlyFinished')}
                  tone="muted"
                />
              ) : null}

              <View style={styles.timeline}>
                {messagesQuery.isError ? (
                  <ChatStateView
                    actionLabel={t('events.common.retry')}
                    body={t('events.chat.messagesErrorBody')}
                    iconName="cloud-offline-outline"
                    onAction={async () => {
                      await messagesQuery.refetch();
                    }}
                    title={t('events.chat.messagesErrorTitle')}
                  />
                ) : (
                  <FlatList
                    ref={messageListRef}
                    contentContainerStyle={[
                      styles.messageListContent,
                      !timelineItems.length ? styles.messageListContentEmpty : undefined,
                    ]}
                    data={timelineItems}
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    keyboardShouldPersistTaps="handled"
                    onContentSizeChange={scrollToLatestMessage}
                    onLayout={scrollToLatestMessage}
                    keyExtractor={(item) => item.id}
                    ListEmptyComponent={
                      messagesQuery.isPending ? (
                        <View style={styles.centeredBlock}>
                          <ActivityIndicator color="#183153" />
                        </View>
                      ) : (
                        <ChatStateView
                          body={t('events.chat.emptyBody')}
                          iconName="sparkles-outline"
                          title={t('events.chat.emptyTitle')}
                        />
                      )
                    }
                    renderItem={({ item }) =>
                      item.type === 'divider' ? (
                        <ChatDateDivider label={item.label} />
                      ) : (
                        <ChatMessageRow item={item.message} t={t} userId={userId} />
                      )
                    }
                    showsVerticalScrollIndicator={false}
                    style={styles.messageList}
                  />
                )}
              </View>
            </>
          )}
        </View>

        {showInput ? (
          <View
            style={[
              styles.inputWrap,
              {
                paddingBottom: footerBottomPadding,
                transform: [{ translateY: -keyboardLift }],
              },
            ]}
          >
            <Controller
              control={messageForm.control}
              name="body"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <>
                  <View
                    style={[
                      styles.composerCard,
                      fieldState.error ? styles.composerCardError : undefined,
                    ]}
                  >
                    <TextInput
                      accessibilityLabel={t('events.chat.inputLabel')}
                      autoCapitalize="sentences"
                      maxLength={1_000}
                      multiline
                      onBlur={onBlur}
                      onChangeText={onChange}
                      placeholder={t('events.chat.inputPlaceholder')}
                      placeholderTextColor="#7a8ca3"
                      selectionColor="#183153"
                      style={styles.input}
                      textAlignVertical="top"
                      value={value}
                    />
                    <Pressable
                      accessibilityLabel={t('events.chat.sendAction')}
                      accessibilityRole="button"
                      disabled={!messageForm.formState.isValid || sendMessageMutation.isPending}
                      onPress={() => {
                        void messageForm.handleSubmit(handleSendMessage)();
                      }}
                      style={({ pressed }) => [
                        styles.sendButton,
                        (!messageForm.formState.isValid || sendMessageMutation.isPending) &&
                          styles.sendButtonDisabled,
                        pressed &&
                          messageForm.formState.isValid &&
                          !sendMessageMutation.isPending &&
                          styles.sendButtonPressed,
                      ]}
                    >
                      {sendMessageMutation.isPending ? (
                        <ActivityIndicator color="#10233f" size="small" />
                      ) : (
                        <Ionicons color="#10233f" name="paper-plane" size={20} />
                      )}
                    </Pressable>
                  </View>

                  {messageForm.formState.errors.body?.message ? (
                    <Text style={styles.errorText}>
                      {messageForm.formState.errors.body.message}
                    </Text>
                  ) : null}
                </>
              )}
            />
          </View>
        ) : canOpenChat ? (
          <View style={[styles.readOnlyFooter, { paddingBottom: footerBottomPadding }]}>
            <Ionicons color="#8ea0b4" name="lock-closed-outline" size={16} />
            <Text style={styles.helperText}>
              {event.status === 'cancelled'
                ? t('events.chat.cancelledBanner')
                : t('events.chat.readOnlyFinished')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#06162f',
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  headerStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#29e778',
  },
  headerMeta: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: '#20d66f',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 10,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerMuted: {
    backgroundColor: '#f4eadb',
  },
  bannerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf3f8',
  },
  bannerIconWrapMuted: {
    backgroundColor: '#f8efe3',
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: '#08162b',
  },
  eventIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff45',
  },
  eventCardCopy: {
    flex: 1,
    minWidth: 0,
  },
  eventCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  eventCardMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#aebed0',
  },
  timeline: {
    flex: 1,
    paddingTop: 8,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingBottom: 18,
    paddingTop: 8,
  },
  messageListContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 14,
  },
  dateDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2d8ca',
  },
  dateDividerLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#948b80',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginTop: 18,
  },
  avatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    backgroundColor: '#5aa0ff',
  },
  avatarFallbackText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
  },
  messageColumn: {
    maxWidth: '78%',
    gap: 4,
  },
  messageAuthor: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#8d8173',
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  messageBubbleOwnSize: {
    maxWidth: '78%',
  },
  messageBubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
  },
  messageBubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#08162b',
  },
  messageBubbleDeleted: {
    backgroundColor: '#eee6da',
  },
  messageBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#071426',
  },
  messageBodyOwn: {
    color: '#ffffff',
  },
  messageBodyDeleted: {
    fontStyle: 'italic',
    color: '#6f7c8b',
  },
  inputWrap: {
    backgroundColor: '#f7f0e6',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  composerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    paddingLeft: 18,
    paddingRight: 7,
    paddingVertical: 7,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 1,
  },
  composerCardError: {
    borderWidth: 1,
    borderColor: '#d15b5b',
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 112,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#183153',
    includeFontPadding: false,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#d8ff45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.42,
  },
  sendButtonPressed: {
    opacity: 0.9,
  },
  helperText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#6d7f95',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#d15b5b',
  },
  readOnlyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eadfce',
    backgroundColor: '#f7f0e6',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
});
