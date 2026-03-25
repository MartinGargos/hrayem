import type { LocationGeocodedAddress } from 'expo-location';

import { CURATED_CITIES, type CityName, isCuratedCity } from '../constants/cities';

const CITY_ALIASES: Record<string, CityName> = {
  ostrava: 'Ostrava',
  'ostrava-poruba': 'Ostrava',
  poruba: 'Ostrava',
  praha: 'Praha (Prague)',
  prague: 'Praha (Prague)',
  brno: 'Brno',
  plzen: 'Plzeň',
  plzeň: 'Plzeň',
  olomouc: 'Olomouc',
  liberec: 'Liberec',
  'ceske budejovice': 'České Budějovice',
  'české budějovice': 'České Budějovice',
  'hradec kralove': 'Hradec Králové',
  'hradec králové': 'Hradec Králové',
  pardubice: 'Pardubice',
  zlin: 'Zlín',
  zlín: 'Zlín',
  opava: 'Opava',
  'frydek-mistek': 'Frýdek-Místek',
  'frýdek-místek': 'Frýdek-Místek',
  havirov: 'Havířov',
  havířov: 'Havířov',
  karvina: 'Karviná',
  karviná: 'Karviná',
};

function normalizeCityCandidate(value: string): string {
  return value.trim().toLocaleLowerCase('cs-CZ');
}

export function resolveCuratedCity(...candidates: (string | null | undefined)[]): CityName | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (isCuratedCity(candidate)) {
      return candidate;
    }

    const alias = CITY_ALIASES[normalizeCityCandidate(candidate)];
    if (alias) {
      return alias;
    }
  }

  return null;
}

export function resolveCuratedCityFromAddress(
  address: Pick<
    LocationGeocodedAddress,
    'city' | 'district' | 'subregion' | 'region' | 'street' | 'name'
  >,
): CityName | null {
  return resolveCuratedCity(
    address.city,
    address.district,
    address.subregion,
    address.region,
    address.name,
    address.street,
  );
}

export function getPreferredCityFallback(): CityName {
  return CURATED_CITIES[0];
}
