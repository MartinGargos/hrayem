import { useEffect, useState } from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  type Theme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import {
  AccountDeletionScreen,
  AddVenueScreen,
  ChatScreen,
  MyGamesScreen,
  PlayerProfileScreen,
  PostAvailabilityScreen,
  ProfileScreen,
  SettingsScreen,
  SkillLevelScreen,
} from '../features/shell/StubScreens';
import { CreateEventScreen } from '../features/events/CreateEventScreen';
import { EventDetailScreen } from '../features/events/EventDetailScreen';
import { HomeFeedScreen } from '../features/home/HomeFeedScreen';
import { useAuthStore } from '../store/auth-store';
import { parseEventDeepLink } from './deep-links';
import { getPendingDeepLinkReplayAction } from './pending-deep-link';
import { useUIStore } from '../store/ui-store';
import type {
  CreateStackParamList,
  HomeStackParamList,
  MainTabParamList,
  MyGamesStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const CreateStack = createNativeStackNavigator<CreateStackParamList>();
const MyGamesStack = createNativeStackNavigator<MyGamesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const navigationRef = createNavigationContainerRef<RootStackParamList>();

const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f7f0e6',
    card: '#fffaf3',
    border: '#eadfce',
    primary: '#183153',
    text: '#183153',
  },
};

function HomeStackNavigator() {
  const { t } = useTranslation();

  return (
    <HomeStack.Navigator
      screenOptions={{
        contentStyle: {
          backgroundColor: '#f7f0e6',
        },
      }}
    >
      <HomeStack.Screen
        component={HomeFeedScreen}
        name="HomeFeed"
        options={{
          title: t('navigation.titles.home'),
        }}
      />
    </HomeStack.Navigator>
  );
}

function CreateStackNavigator() {
  const { t } = useTranslation();

  return (
    <CreateStack.Navigator
      screenOptions={{
        contentStyle: {
          backgroundColor: '#f7f0e6',
        },
      }}
    >
      <CreateStack.Screen
        component={CreateEventScreen}
        name="CreateEvent"
        options={{
          title: t('navigation.titles.createEvent'),
        }}
      />
    </CreateStack.Navigator>
  );
}

function MyGamesStackNavigator() {
  const { t } = useTranslation();

  return (
    <MyGamesStack.Navigator
      screenOptions={{
        contentStyle: {
          backgroundColor: '#f7f0e6',
        },
      }}
    >
      <MyGamesStack.Screen
        component={MyGamesScreen}
        name="MyGames"
        options={{
          title: t('navigation.titles.myGames'),
        }}
      />
    </MyGamesStack.Navigator>
  );
}

function ProfileStackNavigator() {
  const { t } = useTranslation();

  return (
    <ProfileStack.Navigator
      screenOptions={{
        contentStyle: {
          backgroundColor: '#f7f0e6',
        },
      }}
    >
      <ProfileStack.Screen
        component={ProfileScreen}
        name="Profile"
        options={{
          title: t('navigation.titles.profile'),
        }}
      />
    </ProfileStack.Navigator>
  );
}

function MainTabNavigator() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={() => ({
        headerShown: false,
        tabBarActiveTintColor: '#183153',
        tabBarInactiveTintColor: '#7a8ca3',
        tabBarStyle: {
          height: 70,
          paddingTop: 8,
          paddingBottom: 10,
          backgroundColor: '#fffaf3',
          borderTopColor: '#eadfce',
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      })}
    >
      <Tab.Screen
        component={HomeStackNavigator}
        name="HomeTab"
        options={{
          title: t('navigation.tabs.home'),
        }}
      />
      <Tab.Screen
        component={CreateStackNavigator}
        name="CreateEventTab"
        options={{
          title: t('navigation.tabs.create'),
          tabBarAccessibilityLabel: t('navigation.tabs.create'),
          tabBarLabel: t('navigation.tabs.createPlus'),
          tabBarLabelStyle: {
            fontSize: 22,
            fontWeight: '800',
            marginTop: -2,
          },
        }}
      />
      <Tab.Screen
        component={MyGamesStackNavigator}
        name="MyGamesTab"
        options={{
          title: t('navigation.tabs.myGames'),
        }}
      />
      <Tab.Screen
        component={ProfileStackNavigator}
        name="ProfileTab"
        options={{
          title: t('navigation.tabs.profile'),
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.userId);
  const pendingDeepLink = useUIStore((state) => state.pendingDeepLink);
  const pendingDeepLinkHandledUserId = useUIStore((state) => state.pendingDeepLinkHandledUserId);
  const clearPendingDeepLink = useUIStore((state) => state.clearPendingDeepLink);
  const markPendingDeepLinkHandledByUser = useUIStore(
    (state) => state.markPendingDeepLinkHandledByUser,
  );
  const [isNavigationReady, setIsNavigationReady] = useState(false);

  useEffect(() => {
    if (!isNavigationReady || !pendingDeepLink || !navigationRef.isReady() || !userId) {
      return;
    }

    const target = parseEventDeepLink(pendingDeepLink);

    if (!target) {
      clearPendingDeepLink();
      return;
    }

    const replayAction = getPendingDeepLinkReplayAction({
      currentUserId: userId,
      handledUserId: pendingDeepLinkHandledUserId,
    });

    if (replayAction === 'wait' || replayAction === 'skip') {
      return;
    }

    navigationRef.navigate('EventDetail', {
      eventId: target.eventId,
    });

    if (replayAction === 'clear') {
      clearPendingDeepLink();
      return;
    }

    markPendingDeepLinkHandledByUser(userId);
  }, [
    clearPendingDeepLink,
    isNavigationReady,
    markPendingDeepLinkHandledByUser,
    pendingDeepLink,
    pendingDeepLinkHandledUserId,
    userId,
  ]);

  return (
    <NavigationContainer
      onReady={() => setIsNavigationReady(true)}
      ref={navigationRef}
      theme={navigationTheme}
    >
      <RootStack.Navigator
        screenOptions={{
          contentStyle: {
            backgroundColor: '#f7f0e6',
          },
          headerTintColor: '#183153',
          headerStyle: {
            backgroundColor: '#fffaf3',
          },
        }}
      >
        <RootStack.Screen
          component={MainTabNavigator}
          name="MainTabs"
          options={{
            headerShown: false,
          }}
        />
        <RootStack.Screen
          component={EventDetailScreen}
          name="EventDetail"
          options={{
            title: t('navigation.titles.eventDetail'),
          }}
        />
        <RootStack.Screen
          component={ChatScreen}
          name="Chat"
          options={{
            title: t('navigation.titles.chat'),
          }}
        />
        <RootStack.Screen
          component={PlayerProfileScreen}
          name="PlayerProfile"
          options={{
            title: t('navigation.titles.playerProfile'),
          }}
        />
        <RootStack.Screen
          component={PostAvailabilityScreen}
          name="PostAvailability"
          options={{
            title: t('navigation.titles.postAvailability'),
          }}
        />
        <RootStack.Screen
          component={SettingsScreen}
          name="Settings"
          options={{
            title: t('navigation.titles.settings'),
          }}
        />
        <RootStack.Screen
          component={AccountDeletionScreen}
          name="AccountDeletion"
          options={{
            title: t('navigation.titles.accountDeletion'),
          }}
        />
        <RootStack.Screen
          component={AddVenueScreen}
          name="AddVenue"
          options={{
            presentation: 'modal',
            title: t('navigation.titles.addVenue'),
          }}
        />
        <RootStack.Screen
          component={SkillLevelScreen}
          name="SkillLevel"
          options={{
            presentation: 'modal',
            title: t('navigation.titles.skillLevel'),
          }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
