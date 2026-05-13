import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  formatISO,
  isToday,
  isTomorrow,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { cs as csLocale, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionButton, PickerSheet } from '../auth/AuthPrimitives';
import { CURATED_CITIES, type CityName } from '../../constants/cities';
import { fetchAvailablePlayersFeed } from '../../services/availability';
import { getLifecycleRefetchInterval } from '../events/event-eligibility';
import { AvatarPhoto, FilterChip, InfoPill, SportBadge } from '../events/EventPrimitives';
import { StateMessage } from '../../components/StateMessage';
import { fetchActiveSports, fetchEventFeedPage, fetchMyUpcomingGames } from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { RootStackParamList } from '../../navigation/types';
import type { AvailabilityFeedItem } from '../../types/availability';
import type { AppLanguage } from '../../types/app';
import type { EventFeedItem } from '../../types/events';
import { formatEventDate, formatEventTime, formatRelativeTime } from '../../utils/dates';
import { formatDisplayName } from '../../utils/people';
import { translatePlural } from '../../utils/pluralization';

type RootNavigation = NavigationProp<RootStackParamList>;
type HomeSurface = 'games' | 'players';
type DatePickerTarget = 'start' | 'end' | null;
type HomeIconName = ComponentProps<typeof Ionicons>['name'];
type TimePreset = 'today' | 'thisWeek' | 'nextWeek' | 'custom';

const PAGE_SIZE = 20;
const WEEK_OPTIONS = { weekStartsOn: 1 as const };
const HOME_HIDDEN_VENUE_PATTERNS = [
  /\bmilestone\b/i,
  /\bverifier\b/i,
  /\bdelete venue\b/i,
  /\bdelete lane\b/i,
  /\btest venue\b/i,
  /\breminder\b/i,
  /\bverify\b/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /^\s*m\d+\s+delete venue\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
];

function getDateKey(value: Date) {
  return formatISO(value, { representation: 'date' });
}

function getTodayRange() {
  const today = startOfDay(new Date());

  return {
    start: today,
    end: today,
  };
}

function getThisWeekRange() {
  const today = startOfDay(new Date());

  return {
    start: today,
    end: endOfWeek(today, WEEK_OPTIONS),
  };
}

function getNextWeekRange() {
  const nextWeekAnchor = addWeeks(startOfDay(new Date()), 1);

  return {
    start: startOfWeek(nextWeekAnchor, WEEK_OPTIONS),
    end: endOfWeek(nextWeekAnchor, WEEK_OPTIONS),
  };
}

function getDefaultStartDate() {
  return getThisWeekRange().start;
}

function getDefaultEndDate() {
  return getThisWeekRange().end;
}

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

function buildAvailabilityKey(item: AvailabilityFeedItem) {
  return `${item.userId}-${item.sportId}-${item.timePreference ?? 'any'}-${item.note ?? 'none'}`;
}

function normalizeVenueLabel(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized || null;
}

function isSuspiciousVenueLabel(name: string | null | undefined, address?: string | null) {
  const searchableText = [normalizeVenueLabel(name), normalizeVenueLabel(address)]
    .filter(Boolean)
    .join(' ');

  if (!searchableText) {
    return true;
  }

  return HOME_HIDDEN_VENUE_PATTERNS.some((pattern) => pattern.test(searchableText));
}

function getHomeVenueLabel(
  t: ReturnType<typeof useTranslation>['t'],
  input: Pick<EventFeedItem, 'venueName' | 'venueAddress'>,
) {
  const venueName = normalizeVenueLabel(input.venueName);
  const venueAddress = normalizeVenueLabel(input.venueAddress);

  if (venueName && !isSuspiciousVenueLabel(venueName, venueAddress)) {
    return venueName;
  }

  if (venueAddress && !isSuspiciousVenueLabel(venueAddress)) {
    return venueAddress;
  }

  return t('home.feed.venueFallback');
}

function HomeStateSurface({
  actionLabel,
  body,
  iconName,
  onPress,
  title,
}: {
  actionLabel?: string;
  body: string;
  iconName: HomeIconName;
  onPress?: () => void | Promise<void>;
  title: string;
}) {
  if (iconName === 'cloud-offline-outline') {
    return (
      <View style={styles.stateSurface}>
        <StateMessage
          action={
            actionLabel && onPress ? (
              <ActionButton
                iconName="refresh-outline"
                label={actionLabel}
                onPress={onPress}
                variant="secondary"
              />
            ) : undefined
          }
          body={body}
          iconName={iconName}
          title={title}
          tone="muted"
        />
      </View>
    );
  }

  return (
    <View style={styles.stateSurfaceCustom}>
      <HomeStateArtwork iconName={iconName} />
      <View style={styles.stateSurfaceCopy}>
        <Text style={styles.stateSurfaceTitle}>{title}</Text>
        <Text style={styles.stateSurfaceBody}>{body}</Text>
      </View>
      {actionLabel && onPress ? (
        <HomeActionButton
          iconName={iconName === 'people-outline' ? 'sparkles-outline' : 'add-outline'}
          label={actionLabel}
          onPress={onPress}
        />
      ) : null}
    </View>
  );
}

function getTimePresetForRange(startDate: Date, endDate: Date): TimePreset {
  const startKey = getDateKey(startDate);
  const endKey = getDateKey(endDate);
  const todayRange = getTodayRange();
  const thisWeekRange = getThisWeekRange();
  const nextWeekRange = getNextWeekRange();

  if (startKey === getDateKey(todayRange.start) && endKey === getDateKey(todayRange.end)) {
    return 'today';
  }

  if (startKey === getDateKey(thisWeekRange.start) && endKey === getDateKey(thisWeekRange.end)) {
    return 'thisWeek';
  }

  if (startKey === getDateKey(nextWeekRange.start) && endKey === getDateKey(nextWeekRange.end)) {
    return 'nextWeek';
  }

  return 'custom';
}

function getTimePresetRange(preset: Exclude<TimePreset, 'custom'>) {
  if (preset === 'today') {
    return getTodayRange();
  }

  if (preset === 'nextWeek') {
    return getNextWeekRange();
  }

  return getThisWeekRange();
}

function getDateFnsLocale(language: AppLanguage) {
  return language === 'cs' ? csLocale : enUS;
}

function formatHomeShortDate(value: string, language: AppLanguage) {
  const parsed = new Date(value);

  if (isToday(parsed)) {
    return language === 'cs' ? 'Dnes' : 'Today';
  }

  if (isTomorrow(parsed)) {
    return language === 'cs' ? 'Zítra' : 'Tomorrow';
  }

  return format(parsed, language === 'cs' ? 'EEE d. M.' : 'EEE, MMM d', {
    locale: getDateFnsLocale(language),
  });
}

function isSoonEvent(startsAt: string) {
  const delta = new Date(startsAt).getTime() - Date.now();
  return delta > 0 && delta <= 18 * 60 * 60 * 1000;
}

function formatHomeCityLabel(city: CityName, language: AppLanguage) {
  if (city !== 'Praha (Prague)') {
    return city;
  }

  return language === 'cs' ? 'Praha' : 'Prague';
}

function getSkillRangeLabel(
  t: ReturnType<typeof useTranslation>['t'],
  minimum: number,
  maximum: number,
) {
  if (minimum === 1 && maximum === 4) {
    return t('home.feed.allLevels');
  }

  if (minimum === maximum) {
    return t(`events.skillLevel.label.${minimum}`);
  }

  return `${t(`events.skillLevel.label.${minimum}`)} – ${t(`events.skillLevel.label.${maximum}`)}`;
}

function HeroSurface({ children, tone }: { children: ReactNode; tone: 'dark' | 'light' }) {
  const isDark = tone === 'dark';

  return (
    <View style={[styles.heroCard, isDark ? styles.heroCardDark : styles.heroCardLight]}>
      {isDark ? <View pointerEvents="none" style={styles.heroTopHighlight} /> : null}
      {children}
    </View>
  );
}

function HomeActionButton({
  label,
  onPress,
  iconName,
  inverted = false,
  secondary = false,
  accent = false,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  iconName?: HomeIconName;
  inverted?: boolean;
  secondary?: boolean;
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityHint={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.homeActionButton,
        accent
          ? styles.homeActionButtonAccent
          : inverted
            ? secondary
              ? styles.homeActionButtonDarkSecondary
              : styles.homeActionButtonDarkPrimary
            : secondary
              ? styles.homeActionButtonLightSecondary
              : styles.homeActionButtonLightPrimary,
        pressed ? styles.homeActionButtonPressed : undefined,
      ]}
    >
      <View style={styles.homeActionButtonContent}>
        {iconName ? (
          <Ionicons
            color={
              accent
                ? '#0d1728'
                : inverted
                  ? secondary
                    ? '#eff5fb'
                    : '#0f2a45'
                  : secondary
                    ? '#183153'
                    : '#fff8f0'
            }
            name={iconName}
            size={16}
          />
        ) : null}
        <Text
          style={[
            styles.homeActionButtonLabel,
            accent
              ? styles.homeActionButtonLabelAccent
              : inverted
                ? secondary
                  ? styles.homeActionButtonLabelDarkSecondary
                  : styles.homeActionButtonLabelDarkPrimary
                : secondary
                  ? styles.homeActionButtonLabelLightSecondary
                  : styles.homeActionButtonLabelLightPrimary,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function HomeStateArtwork({ iconName }: { iconName: HomeIconName }) {
  const displayIcon = iconName === 'people-outline' ? 'people-outline' : 'tennisball-outline';

  return (
    <View style={styles.stateArtworkWrap}>
      <View style={styles.stateArtworkIconCircle}>
        <Ionicons color="#183153" name={displayIcon} size={24} />
      </View>
    </View>
  );
}

function HomeRailEventCard({
  event,
  language,
  onPress,
}: {
  event: EventFeedItem;
  language: AppLanguage;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const organizerName = event.organizerFirstName ?? t('events.common.organizerFallback');
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
  const venueLabel = getHomeVenueLabel(t, event);
  const occupancyRatio = event.playerCountTotal ? event.spotsTaken / event.playerCountTotal : 0;
  const filledSegments = Math.max(1, Math.round(occupancyRatio * 4));
  const startsSoon = isSoonEvent(event.startsAt);

  return (
    <Pressable
      accessibilityHint={t('events.detail.openEventHint', {
        sport: sportName,
        venue: venueLabel,
      })}
      accessibilityLabel={sportName}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.homeRailCardPressable}
    >
      <View style={styles.homeRailCard}>
        <View style={styles.homeRailCardHeader}>
          <View style={styles.homeRailSportChip}>
            <Text numberOfLines={1} style={styles.homeRailSportChipLabel}>
              {sportName.toUpperCase()}
            </Text>
          </View>
          {startsSoon ? (
            <View style={styles.homeRailUrgentChip}>
              <Text style={styles.homeRailUrgentChipLabel}>{t('home.feed.soon')}</Text>
            </View>
          ) : (
            <Text numberOfLines={1} style={styles.homeRailSupportLabel}>
              {getSkillRangeLabel(t, event.skillMin, event.skillMax)}
            </Text>
          )}
        </View>

        <Text numberOfLines={2} style={styles.homeRailVenueTitle}>
          {venueLabel}
        </Text>

        <View style={styles.homeRailMetaRow}>
          <Ionicons color="#7a8a9c" name="location-outline" size={14} />
          <Text numberOfLines={1} style={styles.homeRailMetaLabel}>
            {event.city} · {t(`events.reservationType.${event.reservationType}`)}
          </Text>
        </View>

        <View style={styles.homeRailTimeRow}>
          <Text style={styles.homeRailTimeValue}>{formatEventTime(event.startsAt, language)}</Text>
          <Text style={styles.homeRailTimeMeta}>
            {formatHomeShortDate(event.startsAt, language)}
          </Text>
        </View>

        <View style={styles.homeRailCapacityRow}>
          <View style={styles.homeRailCapacityBars}>
            {Array.from({ length: 4 }).map((_, index) => (
              <View
                key={`${event.id}-capacity-${index}`}
                style={[
                  styles.homeRailCapacityBar,
                  index < filledSegments ? styles.homeRailCapacityBarFilled : undefined,
                ]}
              />
            ))}
          </View>
          <Text style={styles.homeRailCapacityLabel}>
            {t('events.feed.spotsTaken', {
              count: event.playerCountTotal,
              current: event.spotsTaken,
              total: event.playerCountTotal,
            })}
          </Text>
        </View>

        <View style={styles.homeRailOrganizerRow}>
          <AvatarPhoto label={organizerName} size={28} uri={event.organizerPhotoUrl} />
          <View style={styles.homeRailOrganizerCopy}>
            <Text numberOfLines={1} style={styles.homeRailOrganizerLabel}>
              {organizerName}
            </Text>
            <Text style={styles.homeRailOrganizerMeta}>
              {translatePlural(t, language, 'home.feed.organizerMeta', event.organizerGamesPlayed)}
            </Text>
          </View>
          <View style={styles.homeRailChevron}>
            <Ionicons color="#102844" name="chevron-forward" size={18} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function AvailabilityPlayerCard({
  fallbackName,
  item,
  language,
  onPress,
  playAgainLabel,
  timePreferenceLabel,
}: {
  fallbackName: string;
  item: AvailabilityFeedItem;
  language: AppLanguage;
  onPress: () => void;
  playAgainLabel: string;
  timePreferenceLabel: string;
}) {
  const { t } = useTranslation();
  const fullName = [item.firstName, item.lastName].filter(Boolean).join(' ') || fallbackName;
  const sportName = language === 'cs' ? item.sportNameCs : item.sportNameEn;
  const translatedSkillLevel = t(`events.skillLevel.label.${item.skillLevel}`);

  return (
    <Pressable
      accessibilityHint={t('events.detail.openPlayerProfileHint')}
      accessibilityLabel={fullName}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.cardPressable}
    >
      <View style={styles.availabilityCard}>
        <View style={styles.availabilityHeader}>
          <View style={styles.availabilityIdentity}>
            <AvatarPhoto label={fullName} size={44} uri={item.photoUrl} />
            <View style={styles.availabilityIdentityCopy}>
              <Text style={styles.availabilityName}>{fullName}</Text>
              <Text style={styles.availabilitySport}>{sportName}</Text>
            </View>
          </View>
          <SportBadge
            colorHex={item.sportColor}
            label={getSportBadgeLabel(item.sportSlug, sportName)}
          />
        </View>

        <View style={styles.availabilitySignalsRow}>
          <InfoPill accentColor={item.sportColor}>{translatedSkillLevel}</InfoPill>
          <InfoPill>{timePreferenceLabel}</InfoPill>
          {item.isPlayAgainConnection ? (
            <InfoPill accentColor="#183153">{playAgainLabel}</InfoPill>
          ) : null}
        </View>

        <View style={styles.availabilityDatesRow}>
          <Ionicons color="#708298" name="calendar-clear-outline" size={15} />
          <Text style={styles.availabilityDates}>
            {item.availableDates
              .map((dateValue) => formatEventDate(`${dateValue}T00:00:00`, language))
              .join(' · ')}
          </Text>
        </View>

        {item.note ? (
          <Text numberOfLines={2} style={styles.availabilityNote}>
            {item.note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function HomeFeedScreen({
  initialSurface = 'games',
  lockedSurface,
}: {
  initialSurface?: HomeSurface;
  lockedSurface?: HomeSurface;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isScreenFocused = useIsFocused();
  const navigation = useNavigation<RootNavigation>();
  const userId = useAuthStore((state) => state.userId);
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const setSelectedCity = useUserStore((state) => state.setSelectedCity);
  const [activeSurface, setActiveSurface] = useState<HomeSurface>(initialSurface);
  const [selectedSportIds, setSelectedSportIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(() => getDefaultStartDate());
  const [endDate, setEndDate] = useState(() => getDefaultEndDate());
  const [pickerTarget, setPickerTarget] = useState<DatePickerTarget>(null);
  const [draftDate, setDraftDate] = useState(() => getDefaultStartDate());
  const [customRangeDraft, setCustomRangeDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [isCityPickerVisible, setIsCityPickerVisible] = useState(false);

  const sportsQuery = useQuery({
    queryKey: ['sports', 'active'],
    queryFn: fetchActiveSports,
    staleTime: 86_400_000,
  });

  const upcomingGamesQuery = useQuery({
    queryKey: ['events', 'my-games', 'upcoming', userId],
    queryFn: fetchMyUpcomingGames,
    enabled: Boolean(userId),
    refetchInterval: getLifecycleRefetchInterval(isScreenFocused),
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const feedQuery = useInfiniteQuery({
    queryKey: [
      'events',
      'feed',
      selectedCity,
      [...selectedSportIds].sort().join(','),
      startDate.toISOString(),
      endDate.toISOString(),
    ],
    queryFn: ({ pageParam }) =>
      fetchEventFeedPage({
        filters: {
          city: selectedCity ?? '',
          sportIds: selectedSportIds,
          startsAtFrom: startDate.toISOString(),
          startsAtTo: addDays(endDate, 1).toISOString(),
        },
        offset: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    enabled: Boolean(selectedCity) && activeSurface === 'games',
    refetchInterval:
      activeSurface === 'games' ? getLifecycleRefetchInterval(isScreenFocused) : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const availablePlayersQuery = useQuery({
    queryKey: [
      'availability',
      'feed',
      selectedCity,
      [...selectedSportIds].sort().join(','),
      formatISO(startDate, { representation: 'date' }),
      formatISO(endDate, { representation: 'date' }),
      userId,
    ],
    queryFn: () => {
      if (!selectedCity) {
        throw new Error('Missing selected city for availability feed.');
      }

      return fetchAvailablePlayersFeed({
        city: selectedCity,
        sportIds: selectedSportIds,
        availableDateFrom: formatISO(startDate, { representation: 'date' }),
        availableDateTo: formatISO(endDate, { representation: 'date' }),
        viewerUserId: userId,
      });
    },
    enabled: Boolean(selectedCity),
    refetchInterval: getLifecycleRefetchInterval(isScreenFocused),
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const feedItems = feedQuery.data?.pages.flat() ?? [];
  const availablePlayers = availablePlayersQuery.data ?? [];
  const previewPlayers = availablePlayers.slice(0, 2);
  const upcomingGames = [...(upcomingGamesQuery.data ?? [])].sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  );
  const nextGame = upcomingGames[0] ?? null;
  const extraUpcomingCount = Math.max(upcomingGames.length - 1, 0);
  const displayFeedItems = nextGame
    ? feedItems.filter((item) => item.id !== nextGame.id)
    : feedItems;
  const hasOnlyHeroGameInFeed =
    Boolean(nextGame) && feedItems.length > 0 && displayFeedItems.length === 0;
  const selectedTimePreset = getTimePresetForRange(startDate, endDate);
  const hasActiveFilters = selectedSportIds.length > 0 || selectedTimePreset !== 'thisWeek';
  const topIdentityLabel =
    profile?.firstName?.trim() ||
    formatDisplayName(profile?.firstName, profile?.lastName) ||
    t('home.topBar.defaultIdentity');
  const atmosphereInset = insets.top + 12;
  const canSwitchSurface = !lockedSurface;
  const cityOptions = useMemo(
    () =>
      CURATED_CITIES.map((city) => ({
        label: formatHomeCityLabel(city, language),
        value: city,
      })),
    [language],
  );

  function navigateToCreate() {
    navigation.navigate('MainTabs', {
      screen: 'CreateEventTab',
      params: { screen: 'CreateEvent' },
    });
  }

  function openCityPicker() {
    setIsCityPickerVisible(true);
  }

  function openDiscover() {
    navigation.navigate('MainTabs', {
      screen: 'DiscoverTab',
      params: { screen: 'DiscoverFeed' },
    });
  }

  function switchSurface(nextSurface: HomeSurface) {
    if (!canSwitchSurface) {
      return;
    }

    setActiveSurface(nextSurface);
  }

  async function selectCity(nextCity: CityName) {
    setSelectedCity(nextCity);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function closePicker() {
    setPickerTarget(null);
    setCustomRangeDraft(null);
  }

  function applyTimePreset(preset: Exclude<TimePreset, 'custom'>) {
    const range = getTimePresetRange(preset);

    setStartDate(range.start);
    setEndDate(range.end);
    setCustomRangeDraft(null);
  }

  function openCustomRangePicker() {
    setCustomRangeDraft({
      start: startDate,
      end: endDate,
    });
    setDraftDate(startDate);
    setPickerTarget('start');
  }

  function handlePickerChange(_event: DateTimePickerEvent, nextValue?: Date) {
    if (!nextValue) {
      return;
    }

    setDraftDate(nextValue);
  }

  function confirmPicker() {
    if (!pickerTarget) {
      return;
    }

    if (customRangeDraft) {
      if (pickerTarget === 'start') {
        const nextStart = draftDate;
        const nextEnd = customRangeDraft.end < nextStart ? nextStart : customRangeDraft.end;

        setCustomRangeDraft({
          start: nextStart,
          end: nextEnd,
        });
        setDraftDate(nextEnd);
        setPickerTarget('end');

        return;
      }

      const nextEnd = draftDate < customRangeDraft.start ? customRangeDraft.start : draftDate;

      setStartDate(customRangeDraft.start);
      setEndDate(nextEnd);
      setCustomRangeDraft(null);
      setPickerTarget(null);

      return;
    }

    if (pickerTarget === 'start') {
      setStartDate(draftDate);

      if (draftDate > endDate) {
        setEndDate(draftDate);
      }
    } else {
      setEndDate(draftDate < startDate ? startDate : draftDate);
    }

    setPickerTarget(null);
  }

  function resetFilters() {
    setSelectedSportIds([]);
    setStartDate(getDefaultStartDate());
    setEndDate(getDefaultEndDate());
    setCustomRangeDraft(null);
  }

  function toggleSportFilter(sportId: string) {
    setSelectedSportIds((current) =>
      current.includes(sportId)
        ? current.filter((value) => value !== sportId)
        : [...current, sportId],
    );
  }

  async function handleRefresh() {
    setIsPullRefreshing(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Promise.all([
        upcomingGamesQuery.refetch(),
        availablePlayersQuery.refetch(),
        activeSurface === 'games' ? feedQuery.refetch() : Promise.resolve(),
      ]);
    } finally {
      setIsPullRefreshing(false);
    }
  }

  function renderTopBar() {
    return (
      <View style={styles.topBar}>
        <View style={styles.brandBlock}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkLabel}>H</Text>
          </View>
          <Text style={styles.brandName}>{t('home.topBar.brandName')}</Text>
        </View>

        <Pressable
          accessibilityHint={t('home.topBar.openCity')}
          accessibilityLabel={selectedCity ?? t('home.topBar.setCity')}
          accessibilityRole="button"
          onPress={openCityPicker}
          style={styles.cityChip}
        >
          <Ionicons color="#eef4fa" name="location-outline" size={15} />
          <Text numberOfLines={1} style={styles.cityChipLabel}>
            {selectedCity ? formatHomeCityLabel(selectedCity, language) : t('home.topBar.setCity')}
          </Text>
          <Ionicons color="#c8d6e2" name="chevron-down" size={14} />
        </Pressable>
      </View>
    );
  }

  function renderHeroLead() {
    if (activeSurface !== 'games' || !nextGame) {
      return null;
    }

    return (
      <View style={styles.heroLead}>
        <Text style={styles.heroGreeting}>
          {t('home.topBar.helloName', { name: topIdentityLabel })}
        </Text>
        <Text style={styles.heroLeadTitle}>{t('home.hero.upcomingHeadline')}</Text>
        <Text style={styles.heroLeadAccent}>{formatRelativeTime(nextGame.startsAt, language)}</Text>
      </View>
    );
  }

  function renderHero() {
    if (nextGame) {
      const sportName = language === 'cs' ? nextGame.sportNameCs : nextGame.sportNameEn;
      const venueLabel = getHomeVenueLabel(t, nextGame);
      const organizerName = nextGame.organizerFirstName ?? t('events.common.organizerFallback');
      const roleLabel =
        nextGame.viewerMembershipStatus === 'organizer'
          ? t('home.hero.organizingBadge')
          : t('home.hero.confirmedBadge');
      const relativeStart = formatRelativeTime(nextGame.startsAt, language);
      const openSpots = Math.max(nextGame.playerCountTotal - nextGame.spotsTaken, 0);

      return (
        <HeroSurface tone="dark">
          <View style={styles.heroTopRow}>
            <View style={styles.heroTopIdentity}>
              <View style={styles.heroSportChip}>
                <Text style={styles.heroSportChipLabel}>{sportName.toUpperCase()}</Text>
              </View>
              <Text style={styles.heroTopMetaLabel}>{roleLabel}</Text>
            </View>
            <View style={[styles.heroMetaPill, styles.heroMetaPillDark]}>
              <Ionicons color="#d9e5ef" name="time-outline" size={14} />
              <Text style={[styles.heroMetaPillLabel, styles.heroMetaPillLabelDark]}>
                {relativeStart}
              </Text>
            </View>
          </View>

          <View style={styles.heroGameRow}>
            <View style={styles.heroGameCopy}>
              <Text numberOfLines={2} style={styles.heroVenueTitle}>
                {venueLabel}
              </Text>
              <View style={styles.heroVenueMetaRow}>
                <Ionicons color="#9fb3c6" name="location-outline" size={14} />
                <Text numberOfLines={1} style={styles.heroVenueMetaLabel}>
                  {`${nextGame.city} · ${t(`events.reservationType.${nextGame.reservationType}`)}`}
                </Text>
              </View>
            </View>
            <View style={styles.heroTimeBlock}>
              <Text style={styles.heroTimeValue}>
                {formatEventTime(nextGame.startsAt, language)}
              </Text>
              <Text style={styles.heroTimeMeta}>
                {`→ ${formatEventTime(nextGame.endsAt, language)}`}
              </Text>
              <Text style={styles.heroTimeMeta}>
                {formatEventDate(nextGame.startsAt, language)}
              </Text>
            </View>
          </View>

          <View style={styles.heroDivider} />

          <View style={styles.heroBottomRow}>
            <View style={styles.heroBottomInfo}>
              <AvatarPhoto label={organizerName} size={34} uri={nextGame.organizerPhotoUrl} />
              <View style={styles.heroBottomCopy}>
                <Text numberOfLines={2} style={styles.heroBottomHeadline}>
                  {t('home.feed.organizerBy', { name: organizerName })}
                </Text>
                <Text numberOfLines={2} style={styles.heroBottomCaption}>
                  {openSpots > 0
                    ? translatePlural(t, language, 'home.hero.lookingForPlayers', openSpots)
                    : t('events.feed.spotsTaken', {
                        count: nextGame.playerCountTotal,
                        current: nextGame.spotsTaken,
                        total: nextGame.playerCountTotal,
                      })}
                </Text>
              </View>
              {extraUpcomingCount > 0 ? (
                <Text style={styles.heroExtraGamesNote}>
                  {translatePlural(t, language, 'home.hero.moreGames', extraUpcomingCount)}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityHint={t('home.actions.openDetail')}
              accessibilityLabel={t('home.actions.detailShort')}
              accessibilityRole="button"
              onPress={() => navigation.navigate('EventDetail', { eventId: nextGame.id })}
              style={({ pressed }) => [
                styles.heroDetailButton,
                pressed ? styles.heroDetailButtonPressed : undefined,
              ]}
            >
              <Text style={styles.heroDetailButtonLabel}>{t('home.actions.detailShort')}</Text>
              <Ionicons color="#0d1728" name="arrow-forward" size={16} />
            </Pressable>
          </View>
        </HeroSurface>
      );
    }

    if (!selectedCity) {
      return (
        <HeroSurface tone="dark">
          <Text style={[styles.heroCardTitle, styles.heroCardTitleDark]}>
            {t('home.hero.noCityTitle')}
          </Text>
          <Text style={styles.heroSubtitleDark}>{t('home.hero.noCityBody')}</Text>
          <View style={styles.heroActions}>
            <View style={styles.heroActionWrap}>
              <HomeActionButton
                iconName="location-outline"
                inverted
                label={t('home.actions.openSettings')}
                onPress={openCityPicker}
              />
            </View>
          </View>
        </HeroSurface>
      );
    }

    if (activeSurface === 'players') {
      return (
        <HeroSurface tone="dark">
          <Text style={[styles.heroCardTitle, styles.heroCardTitleDark]}>
            {t('home.players.sectionTitle')}
          </Text>
          <Text style={styles.heroSubtitleDark}>
            {availablePlayers.length
              ? translatePlural(t, language, 'home.players.teaserBody', availablePlayers.length)
              : t('home.players.teaserEmpty')}
          </Text>
        </HeroSurface>
      );
    }

    if (feedItems.length > 0) {
      return (
        <HeroSurface tone="dark">
          <Text style={[styles.heroCardTitle, styles.heroCardTitleDark]}>
            {t('home.hero.feedReadyTitle')}
          </Text>
          <Text style={styles.heroSubtitleDark}>
            {translatePlural(t, language, 'home.hero.feedReadyBody', feedItems.length)}
          </Text>
          {availablePlayers.length ? (
            <View style={styles.heroActions}>
              <View style={styles.heroActionWrap}>
                <HomeActionButton
                  iconName="people-outline"
                  inverted
                  label={t('home.actions.openPlayers')}
                  onPress={openDiscover}
                  secondary
                />
              </View>
            </View>
          ) : null}
        </HeroSurface>
      );
    }

    return (
      <HeroSurface tone="dark">
        <Text style={[styles.heroCardTitle, styles.heroCardTitleDark]}>
          {hasActiveFilters ? t('home.hero.emptyFilteredTitle') : t('home.hero.emptyOpenTitle')}
        </Text>
        <Text style={styles.heroSubtitleDark}>
          {hasActiveFilters ? t('home.hero.emptyFilteredBody') : t('home.hero.emptyOpenBody')}
        </Text>
        <View style={styles.heroActions}>
          <View style={styles.heroActionWrap}>
            <HomeActionButton
              iconName={availablePlayers.length ? 'people-outline' : 'sparkles-outline'}
              inverted={availablePlayers.length > 0}
              label={
                availablePlayers.length
                  ? t('home.actions.openPlayers')
                  : t('home.players.postAction')
              }
              onPress={() =>
                availablePlayers.length ? openDiscover() : navigation.navigate('PostAvailability')
              }
              secondary={availablePlayers.length > 0}
            />
          </View>
        </View>
      </HeroSurface>
    );
  }

  function renderFilters() {
    if (!selectedCity) {
      return null;
    }

    return (
      <View style={styles.filtersToolbar}>
        <ScrollView
          contentContainerStyle={styles.filtersToolbarContent}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <View style={styles.filterChipWrap}>
            <FilterChip
              label={t('availability.allSports')}
              onPress={() => setSelectedSportIds([])}
              selected={selectedSportIds.length === 0}
            />
            {(sportsQuery.data ?? []).map((sport) => (
              <FilterChip
                key={sport.id}
                label={language === 'cs' ? sport.nameCs : sport.nameEn}
                onPress={() => toggleSportFilter(sport.id)}
                selected={selectedSportIds.includes(sport.id)}
              />
            ))}
            <FilterChip
              label={t('home.filters.today')}
              onPress={() => applyTimePreset('today')}
              selected={selectedTimePreset === 'today'}
            />
            <FilterChip
              label={t('home.filters.thisWeek')}
              onPress={() => applyTimePreset('thisWeek')}
              selected={selectedTimePreset === 'thisWeek'}
            />
            <FilterChip
              label={t('home.filters.nextWeek')}
              onPress={() => applyTimePreset('nextWeek')}
              selected={selectedTimePreset === 'nextWeek'}
            />
            <FilterChip
              label={t('home.filters.custom')}
              onPress={openCustomRangePicker}
              selected={selectedTimePreset === 'custom'}
            />
          </View>
          {hasActiveFilters ? (
            <FilterChip
              label={t('home.actions.resetFilters')}
              onPress={resetFilters}
              selected={false}
            />
          ) : null}
        </ScrollView>
      </View>
    );
  }

  function renderPlayersTeaser() {
    if (!selectedCity || activeSurface !== 'games') {
      return null;
    }

    if (availablePlayersQuery.isPending || availablePlayersQuery.isError) {
      return null;
    }

    if (availablePlayers.length === 0) {
      return null;
    }

    return (
      <Pressable
        accessibilityHint={t('home.actions.openPlayers')}
        accessibilityLabel={t('home.players.teaserTitle')}
        accessibilityRole="button"
        onPress={openDiscover}
        style={styles.inlineAvailabilityLink}
      >
        <View style={styles.playersAvatarStack}>
          {previewPlayers.map((item, index) => {
            const fullName =
              [item.firstName, item.lastName].filter(Boolean).join(' ') ||
              t('auth.home.defaultName');

            return (
              <View
                key={buildAvailabilityKey(item)}
                style={[
                  styles.playersAvatarStackItem,
                  index === 0 ? undefined : styles.playersAvatarStackItemOverlap,
                  { zIndex: previewPlayers.length - index },
                ]}
              >
                <AvatarPhoto label={fullName} size={30} uri={item.photoUrl} />
              </View>
            );
          })}
        </View>
        <Text style={styles.inlineAvailabilityLinkLabel}>
          {translatePlural(t, language, 'home.players.inlineCount', availablePlayers.length)}
        </Text>
        <Ionicons color="#7b8d9f" name="arrow-forward" size={16} />
      </Pressable>
    );
  }

  function renderSectionHeader() {
    return (
      <View style={styles.sectionIntro}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionCopy}>
            <Text style={styles.sectionEyebrow}>{t('home.feed.eyebrow')}</Text>
            <Text style={styles.sectionTitle}>{t('home.feed.title')}</Text>
          </View>
          <Pressable
            accessibilityHint={t('home.actions.resetFilters')}
            accessibilityLabel={t('home.actions.viewAll')}
            accessibilityRole="button"
            onPress={resetFilters}
            style={styles.sectionLink}
          >
            <Text style={styles.sectionLinkLabel}>{t('home.actions.viewAll')}</Text>
            <Ionicons color="#7b684f" name="arrow-forward" size={15} />
          </Pressable>
        </View>
      </View>
    );
  }

  function renderHeader() {
    return (
      <View style={styles.headerWrap}>
        <View
          style={[
            styles.atmosphereShell,
            {
              paddingTop: atmosphereInset,
            },
          ]}
        >
          <View pointerEvents="none" style={styles.atmosphereBackdrop}>
            <View style={[styles.atmosphereGridLine, styles.atmosphereGridLineVerticalLeft]} />
            <View style={[styles.atmosphereGridLine, styles.atmosphereGridLineVerticalRight]} />
            <View style={[styles.atmosphereGridLine, styles.atmosphereGridLineHorizontal]} />
          </View>
          {renderTopBar()}
          {activeSurface === 'players' && canSwitchSurface ? (
            <View style={styles.surfaceBackRow}>
              <Pressable
                accessibilityHint={t('home.actions.backToGames')}
                accessibilityLabel={t('home.actions.backToGames')}
                accessibilityRole="button"
                onPress={() => switchSurface('games')}
                style={styles.surfaceBackAction}
              >
                <Ionicons color="#eff4fa" name="chevron-back" size={14} />
                <Text style={styles.surfaceBackActionLabel}>{t('home.actions.backToGames')}</Text>
              </Pressable>
            </View>
          ) : null}
          {renderHeroLead()}
          {renderHero()}
        </View>
      </View>
    );
  }

  function renderGamesList() {
    if (!selectedCity) {
      return null;
    }

    if (feedQuery.isPending) {
      return (
        <View style={styles.discoveryBody}>
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        </View>
      );
    }

    if (feedQuery.isError) {
      return (
        <View style={styles.discoveryBody}>
          <HomeStateSurface
            actionLabel={t('events.common.retry')}
            body={t('events.feed.errorBody')}
            iconName="cloud-offline-outline"
            onPress={async () => {
              await feedQuery.refetch();
            }}
            title={t('events.feed.errorTitle')}
          />
        </View>
      );
    }

    if (displayFeedItems.length === 0) {
      return (
        <View style={styles.discoveryBody}>
          <HomeStateSurface
            actionLabel={t('home.actions.create')}
            body={
              hasOnlyHeroGameInFeed
                ? t('home.feed.noMoreGamesBody')
                : selectedSportIds.length > 0 || selectedTimePreset === 'custom'
                  ? t('home.feed.emptyBodyFiltered')
                  : t('home.feed.emptyBodyDefault', {
                      period: t(`home.filters.summary.${selectedTimePreset}`),
                    })
            }
            iconName="tennisball-outline"
            onPress={navigateToCreate}
            title={
              hasOnlyHeroGameInFeed ? t('home.feed.noMoreGamesTitle') : t('home.feed.emptyTitle')
            }
          />
        </View>
      );
    }

    return (
      <View style={styles.gamesList}>
        {displayFeedItems.map((item) => (
          <HomeRailEventCard
            event={item}
            key={item.id}
            language={language}
            onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
          />
        ))}

        {feedQuery.isFetchingNextPage ? (
          <View style={styles.gamesListLoading}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : feedQuery.hasNextPage ? (
          <View style={styles.gamesListLoadMore}>
            <ActionButton
              label={t('home.actions.loadMore')}
              onPress={async () => {
                await feedQuery.fetchNextPage();
              }}
              variant="secondary"
            />
          </View>
        ) : null}
      </View>
    );
  }

  const refreshControl = (
    <RefreshControl
      onRefresh={() => void handleRefresh()}
      progressBackgroundColor="#10233b"
      progressViewOffset={insets.top + 18}
      refreshing={isPullRefreshing}
      tintColor="#eff4fa"
    />
  );
  const bottomSafePadding = Math.max(insets.bottom, 16) + 150;

  if (activeSurface === 'players') {
    return (
      <View style={styles.screenRoot}>
        <View pointerEvents="none" style={styles.screenTopBackdrop}>
          <View style={[styles.screenBackdropGridLine, styles.screenBackdropGridLineLeft]} />
          <View style={[styles.screenBackdropGridLine, styles.screenBackdropGridLineRight]} />
          <View style={[styles.screenBackdropGridLine, styles.screenBackdropGridLineHorizontal]} />
        </View>
        <StatusBar style="light" />
        <FlatList
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomSafePadding }]}
          data={availablePlayers}
          keyExtractor={buildAvailabilityKey}
          ListEmptyComponent={
            !selectedCity ? null : availablePlayersQuery.isPending ? (
              <View style={styles.centeredBlock}>
                <ActivityIndicator color="#183153" />
              </View>
            ) : availablePlayersQuery.isError ? (
              <HomeStateSurface
                actionLabel={t('events.common.retry')}
                body={t('availability.errorBody')}
                iconName="cloud-offline-outline"
                onPress={async () => {
                  await availablePlayersQuery.refetch();
                }}
                title={t('availability.errorTitle')}
              />
            ) : (
              <HomeStateSurface
                actionLabel={t('home.players.postAction')}
                body={t('home.players.emptyBody')}
                iconName="people-outline"
                onPress={() => navigation.navigate('PostAvailability')}
                title={t('home.players.emptyTitle')}
              />
            )
          }
          ListHeaderComponent={renderHeader}
          ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <AvailabilityPlayerCard
              fallbackName={t('auth.home.defaultName')}
              item={item}
              language={language}
              onPress={() => navigation.navigate('PlayerProfile', { playerId: item.userId })}
              playAgainLabel={t('profile.playAgainBadge')}
              timePreferenceLabel={t(
                `availability.timePreferenceValues.${item.timePreference ?? 'any'}`,
              )}
            />
          )}
          showsVerticalScrollIndicator={false}
          style={styles.rootList}
        />

        <PickerSheet
          closeAccessibilityLabel={t('home.topBar.openCity')}
          onClose={() => setIsCityPickerVisible(false)}
          onSelect={(value) => {
            void selectCity(value);
          }}
          options={cityOptions}
          selectedValue={selectedCity}
          title={t('home.topBar.pickerTitle')}
          visible={isCityPickerVisible}
        />

        <Modal
          animationType="slide"
          onRequestClose={closePicker}
          transparent
          visible={pickerTarget !== null}
        >
          <Pressable onPress={closePicker} style={styles.modalBackdrop}>
            <Pressable style={styles.modalCard}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>
                {pickerTarget === 'start' ? t('events.feed.startDate') : t('events.feed.endDate')}
              </Text>
              <DateTimePicker
                display="spinner"
                mode="date"
                onChange={handlePickerChange}
                style={styles.modalPicker}
                value={draftDate}
              />
              <View style={styles.modalActions}>
                <View style={styles.modalActionWrap}>
                  <ActionButton
                    label={t('events.common.pickerCancel')}
                    onPress={closePicker}
                    variant="secondary"
                  />
                </View>
                <View style={styles.modalActionWrap}>
                  <ActionButton label={t('events.common.pickerDone')} onPress={confirmPicker} />
                </View>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.screenRoot}>
      <View pointerEvents="none" style={styles.screenTopBackdrop}>
        <View style={[styles.screenBackdropGridLine, styles.screenBackdropGridLineLeft]} />
        <View style={[styles.screenBackdropGridLine, styles.screenBackdropGridLineRight]} />
        <View style={[styles.screenBackdropGridLine, styles.screenBackdropGridLineHorizontal]} />
      </View>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.gamesScrollContent, { paddingBottom: bottomSafePadding }]}
        contentInsetAdjustmentBehavior="never"
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        style={styles.gamesScroll}
      >
        {renderHeader()}
        <View style={styles.discoveryStage}>
          {selectedCity ? (
            <>
              {renderSectionHeader()}
              {renderFilters()}
              {renderGamesList()}
              {renderPlayersTeaser()}
            </>
          ) : null}
        </View>
      </ScrollView>

      <PickerSheet
        closeAccessibilityLabel={t('home.topBar.openCity')}
        onClose={() => setIsCityPickerVisible(false)}
        onSelect={(value) => {
          void selectCity(value);
        }}
        options={cityOptions}
        selectedValue={selectedCity}
        title={t('home.topBar.pickerTitle')}
        visible={isCityPickerVisible}
      />

      <Modal
        animationType="slide"
        onRequestClose={closePicker}
        transparent
        visible={pickerTarget !== null}
      >
        <Pressable onPress={closePicker} style={styles.modalBackdrop}>
          <Pressable style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {pickerTarget === 'start' ? t('events.feed.startDate') : t('events.feed.endDate')}
            </Text>
            <DateTimePicker
              display="spinner"
              mode="date"
              onChange={handlePickerChange}
              style={styles.modalPicker}
              value={draftDate}
            />
            <View style={styles.modalActions}>
              <View style={styles.modalActionWrap}>
                <ActionButton
                  label={t('events.common.pickerCancel')}
                  onPress={closePicker}
                  variant="secondary"
                />
              </View>
              <View style={styles.modalActionWrap}>
                <ActionButton label={t('events.common.pickerDone')} onPress={confirmPicker} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: '#f4f7fb',
  },
  screenTopBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 520,
    backgroundColor: '#10233b',
  },
  screenBackdropGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(238, 244, 250, 0.07)',
  },
  screenBackdropGridLineLeft: {
    top: 0,
    bottom: 0,
    left: '38%',
    width: 1,
  },
  screenBackdropGridLineRight: {
    top: 0,
    bottom: 0,
    right: '22%',
    width: 1,
  },
  screenBackdropGridLineHorizontal: {
    left: 0,
    right: 0,
    top: 112,
    height: 1,
  },
  rootList: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  gamesScroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  gamesScrollContent: {
    paddingBottom: 126,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 112,
    backgroundColor: '#f4f7fb',
  },
  headerWrap: {
    marginBottom: 0,
  },
  atmosphereShell: {
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingBottom: 22,
    borderBottomLeftRadius: 38,
    borderBottomRightRadius: 38,
    backgroundColor: '#10233b',
  },
  atmosphereBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  atmosphereGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(238, 244, 250, 0.07)',
  },
  atmosphereGridLineVerticalLeft: {
    top: 0,
    bottom: 0,
    left: '38%',
    width: 1,
  },
  atmosphereGridLineVerticalRight: {
    top: 0,
    bottom: 0,
    right: '22%',
    width: 1,
  },
  atmosphereGridLineHorizontal: {
    left: 0,
    right: 0,
    top: 112,
    height: 1,
  },
  discoveryStage: {
    flex: 1,
    marginTop: -10,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: '#f5efe3',
    paddingTop: 24,
    paddingBottom: 34,
    gap: 18,
  },
  discoveryBody: {
    paddingHorizontal: 24,
  },
  surfaceBackRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  surfaceBackAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(233, 241, 249, 0.16)',
    backgroundColor: 'rgba(244, 248, 252, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  surfaceBackActionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#eff4fa',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 22,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff45',
  },
  brandMarkLabel: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f1a29',
  },
  brandName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f7fbff',
  },
  identityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  identityCopy: {
    flex: 1,
    gap: 4,
  },
  identityName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#f9fbff',
  },
  identityGreeting: {
    fontSize: 13,
    lineHeight: 18,
    color: '#bfd0df',
  },
  cityChip: {
    maxWidth: 156,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245, 250, 255, 0.12)',
    backgroundColor: 'rgba(245, 250, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cityChipLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#f4f7fb',
  },
  heroGreeting: {
    fontSize: 15,
    lineHeight: 22,
    color: '#c2d2df',
  },
  heroWrap: {
    gap: 14,
  },
  heroLead: {
    gap: 7,
    paddingHorizontal: 2,
    marginBottom: 14,
  },
  heroLeadTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#f8fbff',
  },
  heroLeadAccent: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    color: '#d8ff45',
  },
  heroCard: {
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
  },
  heroCardDark: {
    backgroundColor: '#16293f',
    borderColor: 'rgba(233, 240, 246, 0.1)',
    shadowColor: '#081628',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 5,
  },
  heroCardLight: {
    backgroundColor: '#fefefe',
    borderColor: '#dfe8f1',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 3,
  },
  heroTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTopIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  heroTopMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: '#97acc1',
  },
  heroIntro: {
    flex: 1,
    gap: 10,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#9bb0c4',
  },
  heroSportChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#d8ff45',
  },
  heroSportChipLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f1a29',
  },
  heroMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  heroMetaPillDark: {
    backgroundColor: 'rgba(244, 248, 252, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244, 248, 252, 0.12)',
  },
  heroMetaPillLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroMetaPillLabelDark: {
    color: '#ecf3f8',
  },
  heroCardTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  heroCardTitleDark: {
    color: '#f7fbff',
  },
  heroCardTitleLight: {
    color: '#183153',
  },
  heroCardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  heroCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
  },
  heroCardMetaItemDark: {
    backgroundColor: 'rgba(243, 247, 251, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(243, 247, 251, 0.1)',
  },
  heroCardMetaText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heroCardMetaTextDark: {
    color: '#d5e1eb',
  },
  heroMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b2c3d4',
  },
  heroGameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  heroGameCopy: {
    flex: 1,
    gap: 6,
  },
  heroVenueTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    color: '#f8fbff',
  },
  heroVenueMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroVenueMetaLabel: {
    fontSize: 14,
    lineHeight: 20,
    color: '#bfd0df',
  },
  heroTimeBlock: {
    minWidth: 102,
    alignItems: 'flex-end',
    gap: 4,
  },
  heroTimeValue: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '900',
    color: '#f8fbff',
  },
  heroTimeMeta: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    color: '#a9bbcc',
  },
  heroSubtitleLight: {
    fontSize: 15,
    lineHeight: 21,
    color: '#566d82',
  },
  heroSubtitleDark: {
    fontSize: 15,
    lineHeight: 21,
    color: '#c4d3e0',
  },
  heroSignalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(227, 236, 245, 0.12)',
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroBottomInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroBottomCopy: {
    flex: 1,
    gap: 2,
  },
  heroBottomHeadline: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f4f8fc',
  },
  heroBottomCaption: {
    fontSize: 12,
    lineHeight: 17,
    color: '#adc0d2',
  },
  heroNeedPlayersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroNeedPlayersLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#eff5fb',
  },
  heroExtraGamesNote: {
    fontSize: 12,
    fontWeight: '700',
    color: '#97acc1',
  },
  heroDetailButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#d8ff45',
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: '#7c9231',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
  heroDetailButtonPressed: {
    opacity: 0.94,
  },
  heroDetailButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0d1728',
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  heroActionWrap: {
    flex: 1,
    minWidth: 148,
  },
  filtersToolbar: {
    paddingHorizontal: 24,
  },
  filtersToolbarContent: {
    alignItems: 'center',
    gap: 10,
    paddingRight: 24,
  },
  filtersToolbarDivider: {
    width: 1,
    height: 22,
    borderRadius: 999,
    backgroundColor: 'rgba(240, 246, 251, 0.16)',
    marginHorizontal: 2,
  },
  filterChipWrap: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 24,
  },
  sectionIntro: {
    gap: 2,
  },
  sectionCopy: {
    flex: 1,
    gap: 3,
  },
  sectionEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#9c7f5b',
  },
  sectionTitle: {
    flex: 1,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '800',
    color: '#102844',
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  sectionLinkLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7b684f',
  },
  cardPressable: {
    borderRadius: 24,
  },
  gamesList: {
    gap: 14,
    paddingHorizontal: 24,
    paddingBottom: 6,
  },
  gamesListLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  gamesListLoadMore: {
    paddingTop: 4,
  },
  homeRailCardPressable: {
    borderRadius: 28,
  },
  homeRailCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(16, 40, 68, 0.06)',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 13,
    shadowColor: '#122841',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 4,
  },
  homeRailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  homeRailSportChip: {
    borderRadius: 10,
    backgroundColor: '#0f2540',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  homeRailSportChipLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  homeRailUrgentChip: {
    borderRadius: 999,
    backgroundColor: '#ff6f53',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  homeRailUrgentChipLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  homeRailSupportLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#73869b',
  },
  homeRailVenueTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#102844',
  },
  homeRailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  homeRailMetaLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#708298',
  },
  homeRailTimeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#edf1f6',
  },
  homeRailTimeValue: {
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '900',
    color: '#0f2540',
  },
  homeRailTimeMeta: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7b8c9d',
  },
  homeRailCapacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  homeRailCapacityBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  homeRailCapacityBar: {
    height: 6,
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#e2e7ed',
  },
  homeRailCapacityBarFilled: {
    backgroundColor: '#142b47',
  },
  homeRailCapacityLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#526477',
  },
  homeRailOrganizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeRailOrganizerCopy: {
    flex: 1,
    gap: 1,
  },
  homeRailOrganizerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#102844',
  },
  homeRailOrganizerMeta: {
    fontSize: 12,
    color: '#728399',
  },
  homeRailChevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7fb',
    borderWidth: 1,
    borderColor: '#e3eaf2',
  },
  homeEventCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e2e9f2',
    backgroundColor: '#ffffff',
    padding: 18,
    gap: 14,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  homeEventAccent: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 5,
    borderRadius: 999,
  },
  homeEventTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  homeEventIdentity: {
    flex: 1,
  },
  homeEventIdentityCopy: {
    gap: 7,
  },
  homeEventSportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeEventSportLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#183153',
  },
  homeEventVenue: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
    color: '#183153',
  },
  homeEventMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  homeEventMetaInlineLabel: {
    flexShrink: 1,
    fontSize: 14,
    color: '#566d82',
  },
  homeEventMetaInlineDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#c8d4df',
  },
  homeEventMetaInlineReservation: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  homeEventTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#eef4fb',
    borderWidth: 1,
    borderColor: '#dde6ef',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  homeEventTimePillLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#183153',
  },
  homeEventTimeBlock: {
    minWidth: 88,
    alignItems: 'flex-end',
    gap: 2,
  },
  homeEventTimeValue: {
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '900',
    color: '#183153',
  },
  homeEventTimeMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71849a',
    textAlign: 'right',
  },
  homeEventScheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  homeEventScheduleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#60758a',
  },
  homeEventMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  homeEventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  homeEventOrganizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  homeEventOrganizerCopy: {
    flex: 1,
    gap: 1,
  },
  homeEventOrganizerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#183153',
  },
  homeEventOrganizerMeta: {
    fontSize: 12,
    color: '#708298',
  },
  homeChevronWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#f5f8fb',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dde6ef',
  },
  homeChevronLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#183153',
  },
  availabilityCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dde6ef',
    backgroundColor: '#ffffff',
    padding: 18,
    gap: 13,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  availabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  availabilityIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  availabilityIdentityCopy: {
    flex: 1,
    gap: 2,
  },
  availabilityName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  availabilitySport: {
    fontSize: 13,
    color: '#708298',
  },
  availabilitySignalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  availabilityDatesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  availabilityDates: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#526477',
  },
  availabilityNote: {
    fontSize: 13,
    lineHeight: 19,
    color: '#526477',
  },
  stateSurface: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dfe8f1',
    backgroundColor: '#ffffff',
    padding: 8,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 26,
  },
  listSeparator: {
    height: 10,
  },
  feedFooter: {
    gap: 8,
    paddingTop: 10,
  },
  playersInlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dfe8f1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  playersInlineLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  playersAvatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 58,
  },
  playersAvatarStackItem: {
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  playersAvatarStackItemOverlap: {
    marginLeft: -12,
  },
  playersInlineCopy: {
    flex: 1,
    gap: 1,
  },
  playersInlineTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#183153',
  },
  playersInlineMeta: {
    fontSize: 12,
    color: '#6f8296',
  },
  inlineAvailabilityLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginLeft: 24,
    paddingVertical: 6,
  },
  inlineAvailabilityLinkLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5a7085',
  },
  homeActionButton: {
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    justifyContent: 'center',
  },
  homeActionButtonLightPrimary: {
    backgroundColor: '#183153',
    borderColor: '#183153',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 3,
  },
  homeActionButtonLightSecondary: {
    backgroundColor: '#ffffff',
    borderColor: '#d8e2ec',
  },
  homeActionButtonAccent: {
    backgroundColor: '#d8ff45',
    borderColor: '#d8ff45',
    shadowColor: '#7c9231',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
  homeActionButtonDarkPrimary: {
    backgroundColor: '#f4f7fb',
    borderColor: '#f4f7fb',
    shadowColor: '#081628',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 4,
  },
  homeActionButtonDarkSecondary: {
    backgroundColor: 'rgba(244, 247, 251, 0.08)',
    borderColor: 'rgba(244, 247, 251, 0.14)',
  },
  homeActionButtonPressed: {
    opacity: 0.92,
  },
  homeActionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  homeActionButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  homeActionButtonLabelLightPrimary: {
    color: '#fff8f0',
  },
  homeActionButtonLabelLightSecondary: {
    color: '#183153',
  },
  homeActionButtonLabelAccent: {
    color: '#0d1728',
  },
  homeActionButtonLabelDarkPrimary: {
    color: '#102845',
  },
  homeActionButtonLabelDarkSecondary: {
    color: '#eff5fb',
  },
  stateSurfaceCustom: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#dfe8f1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  stateSurfaceCopy: {
    gap: 7,
  },
  stateSurfaceTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: '#183153',
  },
  stateSurfaceBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#586d82',
  },
  stateArtworkWrap: {
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stateArtworkIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f7fc',
    borderWidth: 1,
    borderColor: '#dde5ee',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#d7e1ec',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
    textAlign: 'center',
  },
  modalPicker: {
    alignSelf: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalActionWrap: {
    flex: 1,
  },
});
