import type { NavigatorScreenParams } from '@react-navigation/native';

export type HomeStackParamList = {
  HomeFeed: undefined;
};

export type DiscoverStackParamList = {
  DiscoverFeed: undefined;
};

export type CreateStackParamList = {
  CreateEvent: undefined;
};

export type MyGamesStackParamList = {
  MyGames: undefined;
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
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
  EditEvent: { eventId: string };
  Chat: { eventId: string };
  PlayerProfile: { playerId: string };
  PostAvailability: undefined;
  AddVenue: undefined;
  SkillLevel: undefined;
  Settings: undefined;
  AccountDeletion: undefined;
};
