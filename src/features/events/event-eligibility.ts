import type { EventMembershipStatus, EventStatus } from '../../types/events';

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
