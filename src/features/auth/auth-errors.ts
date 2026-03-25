export function mapAuthErrorToMessageKey(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'auth.errors.generic';
  }

  const message = error.message.toLocaleLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'auth.errors.invalidCredentials';
  }

  if (message.includes('email not confirmed')) {
    return 'auth.errors.emailNotConfirmed';
  }

  if (message.includes('user already registered')) {
    return 'auth.errors.userAlreadyExists';
  }

  if (message.includes('password')) {
    return 'auth.errors.passwordTooWeak';
  }

  if (message.includes('cancelled')) {
    return 'auth.errors.oauthCancelled';
  }

  if (message.includes('rate')) {
    return 'auth.errors.rateLimited';
  }

  if (message.includes('network')) {
    return 'auth.errors.network';
  }

  return 'auth.errors.generic';
}
