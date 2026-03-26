export const PENDING_CONSENT_TERMS_KEY = 'pending_terms_version';
export const PENDING_CONSENT_PRIVACY_KEY = 'pending_privacy_version';

export type PendingConsentVersions = {
  termsVersion: string;
  privacyVersion: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildPendingConsentMetadata(
  termsVersion: string,
  privacyVersion: string,
): Record<string, string> {
  return {
    [PENDING_CONSENT_TERMS_KEY]: termsVersion,
    [PENDING_CONSENT_PRIVACY_KEY]: privacyVersion,
  };
}

export function readPendingConsentVersions(value: unknown): PendingConsentVersions | null {
  if (!isRecord(value)) {
    return null;
  }

  const termsVersion = value[PENDING_CONSENT_TERMS_KEY];
  const privacyVersion = value[PENDING_CONSENT_PRIVACY_KEY];

  if (
    typeof termsVersion !== 'string' ||
    termsVersion.length === 0 ||
    typeof privacyVersion !== 'string' ||
    privacyVersion.length === 0
  ) {
    return null;
  }

  return {
    termsVersion,
    privacyVersion,
  };
}
