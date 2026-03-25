import * as Location from 'expo-location';

import type { CityName } from '../constants/cities';
import { resolveCuratedCityFromAddress } from '../utils/cities';

export type LocationSuggestion = {
  city: CityName | null;
  latitude: number | null;
  longitude: number | null;
};

export async function detectSuggestedCity(): Promise<LocationSuggestion> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (permission.status !== 'granted') {
    return {
      city: null,
      latitude: null,
      longitude: null,
    };
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const [address] = await Location.reverseGeocodeAsync(position.coords);

  return {
    city: address ? resolveCuratedCityFromAddress(address) : null,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}
