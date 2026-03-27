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
  joinedAt: string;
};

export type EventDetail = EventFeedItem & {
  organizerLastName: string | null;
  viewerMembershipStatus: EventMembershipStatus | null;
  viewerWaitlistPosition: number | null;
};

export type MyGamesUpcomingItem = EventFeedItem & {
  viewerMembershipStatus: Extract<EventMembershipStatus, 'organizer' | 'confirmed'>;
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

export type CreateEventErrorCode =
  | 'SKILL_LEVEL_REQUIRED'
  | 'VENUE_NOT_FOUND'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_JOINABLE'
  | 'EVENT_NOT_LEAVABLE'
  | 'EVENT_ALREADY_STARTED'
  | 'ALREADY_JOINED'
  | 'ORGANIZER_CANNOT_JOIN'
  | 'ORGANIZER_CANNOT_LEAVE'
  | 'PLAYER_NOT_IN_EVENT'
  | 'FORBIDDEN'
  | 'INVALID_SKILL_LEVEL'
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

export type LeaveEventResponse = {
  event_id: string;
  membership_status: null;
  waitlist_position: null;
  event_status: EventStatus;
  spots_taken: number;
  waitlist_count: number;
  promoted_user_id: string | null;
};
