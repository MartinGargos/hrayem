import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { ScreenCard, ScreenShell, SegmentedTabs, DetailRow } from '../../components/ScreenShell';
import { FoundationScreen } from '../foundation/FoundationScreen';
import { ActionButton } from '../auth/AuthPrimitives';
import { buildEventSchemeUrl, buildEventWebUrl } from '../../navigation/deep-links';
import { signOutAndClearState } from '../../services/auth';
import { useUIStore } from '../../store/ui-store';
import { useUserStore } from '../../store/user-store';
import type { RootStackParamList } from '../../navigation/types';

type RootNavigation = NavigationProp<RootStackParamList>;

function useRootNavigation() {
  return useNavigation<RootNavigation>();
}

function PlaceholderText({ children }: { children: string }) {
  return <Text style={styles.placeholderText}>{children}</Text>;
}

export function HomeFeedScreen() {
  const { t } = useTranslation();
  const navigation = useRootNavigation();
  const profile = useUserStore((state) => state.profile);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'available'>('upcoming');

  const cityValue = profile?.city ?? selectedCity ?? t('shell.common.noCity');

  return (
    <ScreenShell title={t('shell.home.title')} subtitle={t('shell.home.subtitle')}>
      <SegmentedTabs
        onChange={setActiveTab}
        options={[
          { label: t('shell.home.tabs.upcoming'), value: 'upcoming' },
          { label: t('shell.home.tabs.availablePlayers'), value: 'available' },
        ]}
        value={activeTab}
      />

      {activeTab === 'upcoming' ? (
        <>
          <ScreenCard title={t('shell.home.upcoming.title')}>
            <PlaceholderText>{t('shell.home.upcoming.placeholder')}</PlaceholderText>
            <DetailRow label={t('shell.common.cityLabel')} value={cityValue} />
            <ActionButton
              label={t('shell.home.upcoming.openEvent')}
              onPress={() => navigation.navigate('EventDetail', { eventId: 'test-id' })}
            />
            <ActionButton
              label={t('shell.home.upcoming.openCreate')}
              onPress={() =>
                navigation.navigate('MainTabs', {
                  screen: 'CreateEventTab',
                  params: { screen: 'CreateEvent' },
                })
              }
              variant="secondary"
            />
          </ScreenCard>
          <ScreenCard title={t('shell.home.upcoming.secondaryTitle')}>
            <PlaceholderText>{t('shell.home.upcoming.secondaryPlaceholder')}</PlaceholderText>
          </ScreenCard>
        </>
      ) : (
        <>
          <ScreenCard title={t('shell.home.availablePlayers.title')}>
            <PlaceholderText>{t('shell.home.availablePlayers.placeholder')}</PlaceholderText>
            <DetailRow label={t('shell.common.cityLabel')} value={cityValue} />
            <ActionButton
              label={t('shell.home.availablePlayers.postAvailability')}
              onPress={() => navigation.navigate('PostAvailability')}
            />
            <ActionButton
              label={t('shell.home.availablePlayers.openPlayer')}
              onPress={() => navigation.navigate('PlayerProfile', { playerId: 'player-preview' })}
              variant="secondary"
            />
          </ScreenCard>
          <ScreenCard title={t('shell.home.availablePlayers.secondaryTitle')}>
            <PlaceholderText>
              {t('shell.home.availablePlayers.secondaryPlaceholder')}
            </PlaceholderText>
          </ScreenCard>
        </>
      )}
    </ScreenShell>
  );
}

type EventDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

export function EventDetailScreen({ route }: EventDetailScreenProps) {
  const { t } = useTranslation();
  const navigation = useRootNavigation();

  return (
    <ScreenShell title={t('shell.eventDetail.title')} subtitle={t('shell.eventDetail.subtitle')}>
      <ScreenCard title={t('shell.eventDetail.stubTitle')}>
        <PlaceholderText>{t('shell.eventDetail.placeholder')}</PlaceholderText>
        <DetailRow label={t('shell.eventDetail.eventIdLabel')} value={route.params.eventId} />
        <DetailRow
          label={t('shell.eventDetail.schemeLabel')}
          value={buildEventSchemeUrl(route.params.eventId)}
        />
        <DetailRow
          label={t('shell.eventDetail.webLabel')}
          value={buildEventWebUrl(route.params.eventId)}
        />
        <ActionButton
          label={t('shell.eventDetail.openChat')}
          onPress={() => navigation.navigate('Chat', { eventId: route.params.eventId })}
        />
        <ActionButton
          label={t('shell.eventDetail.openPlayer')}
          onPress={() => navigation.navigate('PlayerProfile', { playerId: 'organizer-preview' })}
          variant="secondary"
        />
      </ScreenCard>
    </ScreenShell>
  );
}

type ChatScreenProps = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export function ChatScreen({ route }: ChatScreenProps) {
  const { t } = useTranslation();

  return (
    <ScreenShell title={t('shell.chat.title')} subtitle={t('shell.chat.subtitle')}>
      <ScreenCard title={t('shell.chat.stubTitle')}>
        <PlaceholderText>{t('shell.chat.placeholder')}</PlaceholderText>
        <DetailRow label={t('shell.chat.eventIdLabel')} value={route.params.eventId} />
      </ScreenCard>
    </ScreenShell>
  );
}

export function CreateEventScreen() {
  const { t } = useTranslation();
  const navigation = useRootNavigation();
  const selectedCity = useUserStore((state) => state.selectedCity);

  return (
    <ScreenShell title={t('shell.createEvent.title')} subtitle={t('shell.createEvent.subtitle')}>
      <ScreenCard title={t('shell.createEvent.stubTitle')}>
        <PlaceholderText>{t('shell.createEvent.placeholder')}</PlaceholderText>
        <DetailRow
          label={t('shell.common.cityLabel')}
          value={selectedCity ?? t('shell.common.noCity')}
        />
        <ActionButton
          label={t('shell.createEvent.openAddVenue')}
          onPress={() => navigation.navigate('AddVenue')}
        />
        <ActionButton
          label={t('shell.createEvent.openSkillLevel')}
          onPress={() => navigation.navigate('SkillLevel')}
          variant="secondary"
        />
      </ScreenCard>
    </ScreenShell>
  );
}

export function AddVenueScreen() {
  const { t } = useTranslation();
  const selectedCity = useUserStore((state) => state.selectedCity);

  return (
    <ScreenShell title={t('shell.addVenue.title')} subtitle={t('shell.addVenue.subtitle')}>
      <ScreenCard title={t('shell.addVenue.stubTitle')}>
        <PlaceholderText>{t('shell.addVenue.placeholder')}</PlaceholderText>
        <DetailRow
          label={t('shell.common.cityLabel')}
          value={selectedCity ?? t('shell.common.noCity')}
        />
      </ScreenCard>
    </ScreenShell>
  );
}

export function SkillLevelScreen() {
  const { t } = useTranslation();

  return (
    <ScreenShell title={t('shell.skillLevel.title')} subtitle={t('shell.skillLevel.subtitle')}>
      <ScreenCard title={t('shell.skillLevel.stubTitle')}>
        <PlaceholderText>{t('shell.skillLevel.placeholder')}</PlaceholderText>
      </ScreenCard>
    </ScreenShell>
  );
}

export function MyGamesScreen() {
  const { t } = useTranslation();
  const navigation = useRootNavigation();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  return (
    <ScreenShell title={t('shell.myGames.title')} subtitle={t('shell.myGames.subtitle')}>
      <SegmentedTabs
        onChange={setActiveTab}
        options={[
          { label: t('shell.myGames.tabs.upcoming'), value: 'upcoming' },
          { label: t('shell.myGames.tabs.past'), value: 'past' },
        ]}
        value={activeTab}
      />

      {activeTab === 'upcoming' ? (
        <ScreenCard title={t('shell.myGames.upcomingTitle')}>
          <PlaceholderText>{t('shell.myGames.upcomingPlaceholder')}</PlaceholderText>
          <ActionButton
            label={t('shell.myGames.openEvent')}
            onPress={() => navigation.navigate('EventDetail', { eventId: 'my-game-upcoming' })}
          />
        </ScreenCard>
      ) : (
        <ScreenCard title={t('shell.myGames.pastTitle')}>
          <PlaceholderText>{t('shell.myGames.pastPlaceholder')}</PlaceholderText>
          <ActionButton
            label={t('shell.myGames.openChat')}
            onPress={() => navigation.navigate('Chat', { eventId: 'my-game-past' })}
          />
        </ScreenCard>
      )}
    </ScreenShell>
  );
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useRootNavigation();
  const profile = useUserStore((state) => state.profile);
  const language = useUserStore((state) => state.language);

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');

  return (
    <ScreenShell title={t('shell.profile.title')} subtitle={t('shell.profile.subtitle')}>
      <ScreenCard title={t('shell.profile.stubTitle')}>
        <DetailRow
          label={t('shell.profile.nameLabel')}
          value={fullName || t('auth.home.defaultName')}
        />
        <DetailRow
          label={t('shell.common.cityLabel')}
          value={profile?.city ?? t('shell.common.noCity')}
        />
        <DetailRow
          label={t('shell.profile.languageLabel')}
          value={t(`auth.language.${profile?.language ?? language}`)}
        />
        <ActionButton
          label={t('shell.profile.openSettings')}
          onPress={() => navigation.navigate('Settings')}
        />
        <ActionButton
          label={t('shell.profile.openSkillLevel')}
          onPress={() => navigation.navigate('SkillLevel')}
          variant="secondary"
        />
      </ScreenCard>
    </ScreenShell>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useRootNavigation();
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);

  async function handleLogout() {
    try {
      await signOutAndClearState();
    } catch {
      setAuthNotice({
        messageKey: 'auth.errors.logoutFailed',
        tone: 'error',
      });
    }
  }

  return (
    <ScreenShell title={t('shell.settings.title')} subtitle={t('shell.settings.subtitle')}>
      <ScreenCard title={t('shell.settings.stubTitle')}>
        <PlaceholderText>{t('shell.settings.placeholder')}</PlaceholderText>
        <ActionButton
          label={t('shell.settings.openAccountDeletion')}
          onPress={() => navigation.navigate('AccountDeletion')}
        />
        <ActionButton
          label={t('shell.settings.openFoundationTools')}
          onPress={() => navigation.navigate('FoundationTools')}
          variant="secondary"
        />
        <ActionButton label={t('auth.home.logout')} onPress={handleLogout} variant="secondary" />
      </ScreenCard>
    </ScreenShell>
  );
}

export function AccountDeletionScreen() {
  const { t } = useTranslation();

  return (
    <ScreenShell
      title={t('shell.accountDeletion.title')}
      subtitle={t('shell.accountDeletion.subtitle')}
    >
      <ScreenCard title={t('shell.accountDeletion.stubTitle')}>
        <PlaceholderText>{t('shell.accountDeletion.placeholder')}</PlaceholderText>
      </ScreenCard>
    </ScreenShell>
  );
}

type PlayerProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'PlayerProfile'>;

export function PlayerProfileScreen({ route }: PlayerProfileScreenProps) {
  const { t } = useTranslation();

  return (
    <ScreenShell
      title={t('shell.playerProfile.title')}
      subtitle={t('shell.playerProfile.subtitle')}
    >
      <ScreenCard title={t('shell.playerProfile.stubTitle')}>
        <PlaceholderText>{t('shell.playerProfile.placeholder')}</PlaceholderText>
        <DetailRow label={t('shell.playerProfile.playerIdLabel')} value={route.params.playerId} />
      </ScreenCard>
    </ScreenShell>
  );
}

export function PostAvailabilityScreen() {
  const { t } = useTranslation();
  const selectedCity = useUserStore((state) => state.selectedCity);

  return (
    <ScreenShell
      title={t('shell.postAvailability.title')}
      subtitle={t('shell.postAvailability.subtitle')}
    >
      <ScreenCard title={t('shell.postAvailability.stubTitle')}>
        <PlaceholderText>{t('shell.postAvailability.placeholder')}</PlaceholderText>
        <DetailRow
          label={t('shell.common.cityLabel')}
          value={selectedCity ?? t('shell.common.noCity')}
        />
      </ScreenCard>
    </ScreenShell>
  );
}

export function FoundationToolsScreen() {
  return <FoundationScreen />;
}

const styles = StyleSheet.create({
  placeholderText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
});
