import type { EventMembershipStatus, EventStatus } from '../../types/events';

export const EVENT_LIFECYCLE_REFRESH_INTERVAL_MS = 15_000;

type OrganizerEventEligibilityInput = {
  startsAt: string;
  status: EventStatus;
  viewerMembershipStatus: EventMembershipStatus | null;
};

function isManageableStatus(status: EventStatus): boolean {
  return status === 'active' || status === 'full';
}

export function canOrganizerCancelEvent(
  event: OrganizerEventEligibilityInput,
  now = Date.now(),
): boolean {
  return event.viewerMembershipStatus === 'organizer' && isManageableStatus(event.status);
}

export function canOrganizerEditEvent(
  event: OrganizerEventEligibilityInput,
  now = Date.now(),
): boolean {
  return canOrganizerCancelEvent(event, now) && new Date(event.startsAt).getTime() > now;
}

export function canOrganizerRemovePlayers(
  event: OrganizerEventEligibilityInput,
  now = Date.now(),
): boolean {
  return canOrganizerEditEvent(event, now);
}

export function getLifecycleRefetchInterval(isScreenFocused: boolean): number | false {
  return isScreenFocused ? EVENT_LIFECYCLE_REFRESH_INTERVAL_MS : false;
}

export function hasEnoughConfirmedPlayersForNoShow(
  players: readonly { userId: string }[],
  organizerId: string | null,
): boolean {
  return (
    players.filter(
      (player) => player.userId !== organizerId && !player.userId.startsWith('deleted-'),
    ).length >= 2
  );
}
