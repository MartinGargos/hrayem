export type ReservationType = 'reserved' | 'to_be_arranged';

export type EventStatus = 'active' | 'full' | 'finished' | 'cancelled';

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
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'INTERNAL_ERROR';
