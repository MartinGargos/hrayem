export function formatDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return combinedName || null;
}
