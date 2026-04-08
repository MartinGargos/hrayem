export type ReservationType = 'reserved' | 'to_be_arranged';

export type EventStatus = 'active' | 'full' | 'finished' | 'cancelled';

export type EventMembershipStatus = 'organizer' | 'confirmed' | 'waitlisted';

export type SportSummary = {
  id: string;
  slug: string;
  nameCs: string;
  nameEn: string;
  iconName: string;
  colorHex: string;
  sortOrder: number;
};

export type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  createdBy: string | null;
  isVerified: boolean;
};

export type UserSportProfile = {
  id: string;
  userId: string;
  sportId: string;
  skillLevel: number;
  gamesPlayed: number;
  hoursPlayed: number;
  noShows: number;
};

export type EventFeedItem = {
  id: string;
  sportId: string;
  sportSlug: string;
  sportNameCs: string;
  sportNameEn: string;
  sportIcon: string;
  sportColor: string;
  organizerId: string | null;
  organizerFirstName: string | null;
  organizerPhotoUrl: string | null;
  organizerNoShows: number;
  organizerGamesPlayed: number;
  venueId: string;
  venueName: string;
  venueAddress: string | null;
  startsAt: string;
  endsAt: string;
  city: string;
  reservationType: ReservationType;
  playerCountTotal: number;
  skillMin: number;
  skillMax: number;
  description: string | null;
  status: EventStatus;
  spotsTaken: number;
  waitlistCount: number;
  createdAt: string;
};

export type EventConfirmedPlayer = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  skillLevel: number | null;
  gamesPlayed: number;
  hoursPlayed: number;
  noShows: number;
  thumbsUpPercentage: number | null;
  isPlayAgainConnection: boolean;
  alreadyThumbedUpByViewer: boolean;
  alreadyReportedNoShow: boolean;
  joinedAt: string;
};

export type EventDetail = EventFeedItem & {
  organizerLastName: string | null;
  noShowWindowEnd: string | null;
  chatClosedAt: string | null;
  viewerMembershipStatus: EventMembershipStatus | null;
  viewerWaitlistPosition: number | null;
};

export type SharedEventDetail = EventFeedItem & {
  organizerLastName: string | null;
};

export type MyGamesUpcomingItem = EventFeedItem & {
  viewerMembershipStatus: Extract<EventMembershipStatus, 'organizer' | 'confirmed'>;
};

export type MyGamesPastItem = EventFeedItem & {
  noShowWindowEnd: string | null;
  chatClosedAt: string | null;
  viewerMembershipStatus: Extract<EventMembershipStatus, 'organizer' | 'confirmed'>;
};

export type ChatMessage = {
  id: string;
  eventId: string;
  userId: string | null;
  body: string;
  sentAt: string;
  isDeleted: boolean;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorPhotoUrl: string | null;
};

export type PlayerSportStat = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  city: string | null;
  sportId: string;
  sportSlug: string;
  sportNameCs: string;
  sportNameEn: string;
  sportIcon: string;
  sportColor: string;
  skillLevel: number;
  gamesPlayed: number;
  hoursPlayed: number;
  noShows: number;
  thumbsUpGames: number;
  thumbsUpPercentage: number | null;
  isPlayAgainConnection: boolean;
};

export type PlayAgainConnection = {
  connectionUserId: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  city: string | null;
  sportId: string;
  sportSlug: string;
  sportNameCs: string;
  sportNameEn: string;
  sportIcon: string;
  sportColor: string;
  skillLevel: number;
  gamesPlayed: number;
  hoursPlayed: number;
  noShows: number;
  thumbsUpPercentage: number | null;
};

export type EventFeedFilters = {
  city: string;
  sportIds: string[];
  startsAtFrom: string;
  startsAtTo: string;
};

export type CreateEventInput = {
  sportId: string;
  venueId: string;
  startsAt: string;
  endsAt: string;
  reservationType: ReservationType;
  playerCountTotal: number;
  skillMin: number;
  skillMax: number;
  description?: string | null;
};

export type UpdateEventInput = {
  eventId: string;
  venueId?: string;
  startsAt?: string;
  endsAt?: string;
  reservationType?: ReservationType;
  playerCountTotal?: number;
  skillMin?: number;
  skillMax?: number;
  description?: string | null;
};

export type CreateEventResponse = {
  id: string;
  sport_id: string;
  organizer_id: string | null;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  city: string;
  reservation_type: ReservationType;
  player_count_total: number;
  skill_min: number;
  skill_max: number;
  description: string | null;
  status: EventStatus;
  reminder_sent: boolean;
  no_show_window_end: string | null;
  chat_closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateEventResponse = CreateEventResponse;

export type CancelEventInput = {
  eventId: string;
};

export type CancelEventResponse = CreateEventResponse;

export type ReportNoShowInput = {
  eventId: string;
  reportedUserId: string;
};

export type ReportNoShowResponse = {
  id: string;
  event_id: string;
  reported_user: string | null;
  reported_by: string | null;
  sport_id: string;
  created_at: string;
};

export type GiveThumbsUpInput = {
  eventId: string;
  toUserId: string;
};

export type GiveThumbsUpResponse = {
  id: string;
  event_id: string;
  from_user: string | null;
  to_user: string | null;
  sport_id: string;
  created_at: string;
};

export type CreateEventErrorCode =
  | 'SKILL_LEVEL_REQUIRED'
  | 'VENUE_NOT_FOUND'
  | 'EVENT_NOT_FOUND'
  | 'CHAT_CLOSED'
  | 'EVENT_NOT_JOINABLE'
  | 'EVENT_NOT_LEAVABLE'
  | 'EVENT_NOT_CANCELLABLE'
  | 'EVENT_NOT_EDITABLE'
  | 'EVENT_ALREADY_STARTED'
  | 'ALREADY_JOINED'
  | 'ORGANIZER_CANNOT_JOIN'
  | 'ORGANIZER_CANNOT_LEAVE'
  | 'PLAYER_NOT_IN_EVENT'
  | 'FORBIDDEN'
  | 'NO_SHOW_NOT_ALLOWED'
  | 'ALREADY_REPORTED'
  | 'THUMBS_UP_NOT_ALLOWED'
  | 'ALREADY_THUMBED_UP'
  | 'INVALID_SKILL_LEVEL'
  | 'PLAYER_COUNT_TOO_LOW'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'INTERNAL_ERROR';

export type JoinEventInput = {
  eventId: string;
  skillLevel?: number | null;
};

export type JoinEventResponse = {
  event_id: string;
  membership_status: Extract<EventMembershipStatus, 'confirmed' | 'waitlisted'>;
  waitlist_position: number | null;
  event_status: EventStatus;
  spots_taken: number;
  waitlist_count: number;
};

export type LeaveEventInput = {
  eventId: string;
};

export type RemovePlayerInput = {
  eventId: string;
  targetUserId: string;
};

export type SendChatMessageInput = {
  eventId: string;
  body: string;
};

export type LeaveEventResponse = {
  event_id: string;
  membership_status: null;
  waitlist_position: null;
  event_status: EventStatus;
  spots_taken: number;
  waitlist_count: number;
  promoted_user_id: string | null;
};

export type RemovePlayerResponse = LeaveEventResponse;

export type SendChatMessageResponse = ChatMessage;
