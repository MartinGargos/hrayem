import type { TFunction } from 'i18next';

import type { AppLanguage } from '../types/app';

type PluralSuffix = 'one' | 'few' | 'many' | 'other';
type InterpolationValues = Record<string, unknown>;

function normalizeLanguage(language: AppLanguage | string): AppLanguage {
  return language.startsWith('en') ? 'en' : 'cs';
}

export function selectPluralSuffix(language: AppLanguage | string, count: number): PluralSuffix {
  const normalizedLanguage = normalizeLanguage(language);
  const absoluteCount = Math.abs(count);

  if (normalizedLanguage === 'cs') {
    if (absoluteCount === 1) {
      return 'one';
    }

    if (Number.isInteger(absoluteCount) && absoluteCount >= 2 && absoluteCount <= 4) {
      return 'few';
    }

    return 'other';
  }

  return absoluteCount === 1 ? 'one' : 'other';
}

export function translatePlural(
  t: TFunction,
  language: AppLanguage | string,
  baseKey: string,
  count: number,
  values: InterpolationValues = {},
): string {
  const suffix = selectPluralSuffix(language, count);
  const fallbackKeys =
    suffix === 'other'
      ? [`${baseKey}_other`, baseKey]
      : [`${baseKey}_${suffix}`, `${baseKey}_other`, baseKey];

  return String(
    t(fallbackKeys, {
      replace: {
        ...values,
        count,
      },
    }),
  );
}
