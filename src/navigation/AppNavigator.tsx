import { useEffect, useState, type ComponentProps } from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  type Theme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AddVenueScreen, SkillLevelScreen } from '../features/shell/StubScreens';
import { PostAvailabilityScreen } from '../features/availability/PostAvailabilityScreen';
import { ChatScreen } from '../features/chat/ChatScreen';
import { CreateEventScreen, EditEventScreen } from '../features/events/CreateEventScreen';
import { EventDetailScreen } from '../features/events/EventDetailScreen';
import { HomeFeedScreen } from '../features/home/HomeFeedScreen';
import { MyGamesScreen } from '../features/my-games/MyGamesScreen';
import { PlayerProfileScreen, ProfileScreen } from '../features/profile/ProfileScreen';
import { AccountDeletionScreen } from '../features/settings/AccountDeletionScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { useAuthStore } from '../store/auth-store';
import { parseEventDeepLink } from './deep-links';
import { getPendingDeepLinkReplayAction } from './pending-deep-link';
import { useUIStore } from '../store/ui-store';
import type {
  CreateStackParamList,
  DiscoverStackParamList,
  HomeStackParamList,
  MainTabParamList,
  MyGamesStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const CreateStack = createNativeStackNavigator<CreateStackParamList>();
const MyGamesStack = createNativeStackNavigator<MyGamesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const navigationRef = createNavigationContainerRef<RootStackParamList>();
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f4f7fb',
    card: '#ffffff',
    border: '#dde6ef',
    primary: '#183153',
    text: '#183153',
  },
};

const baseStackScreenOptions = {
  contentStyle: {
    backgroundColor: '#f4f7fb',
  },
  gestureEnabled: Platform.OS === 'ios',
  headerTintColor: '#183153',
  headerStyle: {
    backgroundColor: '#ffffff',
  },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal' as const,
  headerTitleStyle: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
};

function getTabIconName(routeName: keyof MainTabParamList, focused: boolean): IoniconName {
  switch (routeName) {
    case 'HomeTab':
      return focused ? 'home' : 'home-outline';
    case 'MyGamesTab':
      return focused ? 'calendar' : 'calendar-outline';
    case 'DiscoverTab':
      return focused ? 'compass' : 'compass-outline';
    case 'ProfileTab':
      return focused ? 'person' : 'person-outline';
    case 'CreateEventTab':
      return 'add';
  }
}

function HomeStackNavigator() {
  const { t } = useTranslation();

  return (
    <HomeStack.Navigator screenOptions={baseStackScreenOptions}>
      <HomeStack.Screen
        component={HomeFeedScreen}
        name="HomeFeed"
        options={{
          headerShown: false,
          title: t('navigation.titles.home'),
        }}
      />
    </HomeStack.Navigator>
  );
}

function CreateStackNavigator() {
  const { t } = useTranslation();

  return (
    <CreateStack.Navigator screenOptions={baseStackScreenOptions}>
      <CreateStack.Screen
        component={CreateEventScreen}
        name="CreateEvent"
        options={{
          headerShown: false,
          title: t('navigation.titles.createEvent'),
        }}
      />
    </CreateStack.Navigator>
  );
}

function DiscoverFeedScreen() {
  return <HomeFeedScreen initialSurface="players" lockedSurface="players" />;
}

function DiscoverStackNavigator() {
  const { t } = useTranslation();

  return (
    <DiscoverStack.Navigator screenOptions={baseStackScreenOptions}>
      <DiscoverStack.Screen
        component={DiscoverFeedScreen}
        name="DiscoverFeed"
        options={{
          headerShown: false,
          title: t('navigation.titles.discover'),
        }}
      />
    </DiscoverStack.Navigator>
  );
}

function MyGamesStackNavigator() {
  const { t } = useTranslation();

  return (
    <MyGamesStack.Navigator screenOptions={baseStackScreenOptions}>
      <MyGamesStack.Screen
        component={MyGamesScreen}
        name="MyGames"
        options={{
          headerShown: false,
          title: t('navigation.titles.myGames'),
        }}
      />
    </MyGamesStack.Navigator>
  );
}

function ProfileStackNavigator() {
  const { t } = useTranslation();

  return (
    <ProfileStack.Navigator screenOptions={baseStackScreenOptions}>
      <ProfileStack.Screen
        component={ProfileScreen}
        name="ProfileHome"
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
      screenListeners={{
        tabPress: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
      }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#183153',
        tabBarInactiveTintColor: '#9aa7b6',
        tabBarShowLabel: route.name !== 'CreateEventTab',
        tabBarIcon: ({ color, focused }) =>
          route.name === 'CreateEventTab' ? (
            <View
              style={[
                styles.createTabIconWrap,
                focused ? styles.createTabIconWrapFocused : undefined,
              ]}
            >
              <Ionicons color="#10233f" name="add" size={28} />
            </View>
          ) : (
            <Ionicons color={color} name={getTabIconName(route.name, focused)} size={22} />
          ),
        tabBarIconStyle: route.name === 'CreateEventTab' ? { marginTop: -12 } : undefined,
        tabBarItemStyle:
          route.name === 'CreateEventTab'
            ? { marginTop: -10, overflow: 'visible' }
            : { paddingTop: 2 },
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: Platform.OS === 'ios' ? 10 : 12,
          height: 80,
          paddingTop: 8,
          paddingBottom: 10,
          borderTopWidth: 0,
          borderRadius: 26,
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          shadowColor: '#10233f',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.1,
          shadowRadius: 24,
          elevation: 10,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          marginTop: 2,
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
        component={MyGamesStackNavigator}
        name="MyGamesTab"
        options={{
          title: t('navigation.tabs.myGames'),
        }}
      />
      <Tab.Screen
        component={CreateStackNavigator}
        name="CreateEventTab"
        options={{
          title: '',
          tabBarAccessibilityLabel: t('navigation.tabs.create'),
          tabBarStyle: {
            display: 'none',
          },
        }}
      />
      <Tab.Screen
        component={DiscoverStackNavigator}
        name="DiscoverTab"
        options={{
          title: t('navigation.tabs.discover'),
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

const styles = StyleSheet.create({
  createTabIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff45',
    borderWidth: 4,
    borderColor: '#f7f4eb',
    shadowColor: '#92a74a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 7,
  },
  createTabIconWrapFocused: {
    transform: [{ translateY: -4 }, { scale: 1.02 }],
  },
});

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

    navigationRef.navigate(target.screen === 'chat' ? 'Chat' : 'EventDetail', {
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
          ...baseStackScreenOptions,
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
          component={ProfileScreen}
          name="Profile"
          options={{
            title: t('navigation.titles.profile'),
          }}
        />
        <RootStack.Screen
          component={EventDetailScreen}
          name="EventDetail"
          options={{
            headerShown: false,
            title: t('navigation.titles.eventDetail'),
          }}
        />
        <RootStack.Screen
          component={EditEventScreen}
          name="EditEvent"
          options={{
            title: t('navigation.titles.editEvent'),
          }}
        />
        <RootStack.Screen
          component={ChatScreen}
          name="Chat"
          options={{
            headerShown: false,
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
