export const CURATED_CITIES = [
  'Ostrava',
  'Praha (Prague)',
  'Brno',
  'Plzeň',
  'Olomouc',
  'Liberec',
  'České Budějovice',
  'Hradec Králové',
  'Pardubice',
  'Zlín',
  'Opava',
  'Frýdek-Místek',
  'Havířov',
  'Karviná',
] as const;

export type CityName = (typeof CURATED_CITIES)[number];

export function isCuratedCity(value: string): value is CityName {
  return CURATED_CITIES.includes(value as CityName);
}
