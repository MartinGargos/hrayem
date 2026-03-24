import { formatDistanceToNow } from 'date-fns';
import { cs, enUS } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';

import type { AppLanguage } from '../types/app';

const localeMap = {
  cs,
  en: enUS,
} as const;

type DateInput = Date | number | string;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatEventDate(input: DateInput, language: AppLanguage = 'cs'): string {
  return formatInTimeZone(
    toDate(input),
    getLocalTimeZone(),
    language === 'cs' ? 'EEEE d. MMMM yyyy' : 'EEEE, MMMM d, yyyy',
    { locale: localeMap[language] },
  );
}

export function formatEventTime(input: DateInput, language: AppLanguage = 'cs'): string {
  return formatInTimeZone(toDate(input), getLocalTimeZone(), 'HH:mm', {
    locale: localeMap[language],
  });
}

export function formatRelativeTime(input: DateInput, language: AppLanguage = 'cs'): string {
  return formatDistanceToNow(toDate(input), {
    addSuffix: true,
    locale: localeMap[language],
  });
}

export function formatChatTimestamp(input: DateInput, language: AppLanguage = 'cs'): string {
  return formatInTimeZone(
    toDate(input),
    getLocalTimeZone(),
    language === 'cs' ? 'd. MMM HH:mm' : 'MMM d, HH:mm',
    { locale: localeMap[language] },
  );
}
