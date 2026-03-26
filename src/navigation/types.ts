import type { NavigatorScreenParams } from '@react-navigation/native';

export type HomeStackParamList = {
  HomeFeed: undefined;
};

export type CreateStackParamList = {
  CreateEvent: undefined;
};

export type MyGamesStackParamList = {
  MyGames: undefined;
};

export type ProfileStackParamList = {
  Profile: undefined;
};

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  CreateEventTab: NavigatorScreenParams<CreateStackParamList>;
  MyGamesTab: NavigatorScreenParams<MyGamesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  EventDetail: { eventId: string };
  Chat: { eventId: string };
  PlayerProfile: { playerId: string };
  PostAvailability: undefined;
  AddVenue: undefined;
  SkillLevel: undefined;
  Settings: undefined;
  AccountDeletion: undefined;
  FoundationTools: undefined;
};
