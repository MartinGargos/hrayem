import type { NavigatorScreenParams } from '@react-navigation/native';

export type HomeStackParamList = {
  HomeFeed: undefined;
  PlayerProfile: { playerId: string };
};

export type DiscoverStackParamList = {
  DiscoverFeed: undefined;
  PlayerProfile: { playerId: string };
};

export type CreateStackParamList = {
  CreateEvent: undefined;
};

export type MyGamesStackParamList = {
  MyGames: undefined;
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  PlayerProfile: { playerId: string };
  Settings: undefined;
  AccountDeletion: undefined;
};

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  MyGamesTab: NavigatorScreenParams<MyGamesStackParamList>;
  CreateEventTab: NavigatorScreenParams<CreateStackParamList>;
  DiscoverTab: NavigatorScreenParams<DiscoverStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  Profile: undefined;
  EventDetail: { eventId: string };
  VenueDetail: { venueId: string };
  EditEvent: { eventId: string };
  Chat: { eventId: string };
  PlayerProfile: { playerId: string };
  PostAvailability: undefined;
  AddVenue: undefined;
  SkillLevel: undefined;
  Settings: undefined;
  AccountDeletion: undefined;
};
