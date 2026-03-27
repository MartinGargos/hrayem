export type PendingDeepLinkReplayAction = 'wait' | 'skip' | 'mark' | 'clear';

type PendingDeepLinkReplayInput = {
  currentUserId: string | null;
  handledUserId: string | null;
};

export function getPendingDeepLinkReplayAction({
  currentUserId,
  handledUserId,
}: PendingDeepLinkReplayInput): PendingDeepLinkReplayAction {
  if (!currentUserId) {
    return 'wait';
  }

  if (!handledUserId) {
    return 'mark';
  }

  if (handledUserId === currentUserId) {
    return 'skip';
  }

  // Preserve one account switch after an unauthenticated deep link, then
  // clear the pending intent once a different authenticated user has consumed it.
  return 'clear';
}
