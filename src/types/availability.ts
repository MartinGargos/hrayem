import type { CityName } from '../constants/cities';

export type AvailabilityTimePreference = 'morning' | 'afternoon' | 'evening' | 'any' | null;

export type AvailabilityRow = {
  id: string;
  userId: string;
  sportId: string;
  city: CityName;
  availableDate: string;
  timePreference: AvailabilityTimePreference;
  note: string | null;
  createdAt: string;
};

export type AvailabilityFeedItem = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  city: CityName | null;
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
  isPlayAgainConnection: boolean;
  availableDates: string[];
  timePreference: AvailabilityTimePreference;
  note: string | null;
};
