import type { ImagePickerAsset } from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import type { AppLanguage } from '../types/app';
import { throwIfSupabaseError } from '../utils/supabase';
import { retrySupabaseOperationOnce, supabase } from './supabase';

type ProfileUpdateInput = {
  userId: string;
  firstName: string;
  lastName: string;
  city: string;
  language: AppLanguage;
  latitude: number | null;
  longitude: number | null;
  photoAsset?: ImagePickerAsset | null;
};

type ProfilePreferencesInput = {
  userId: string;
  city: string;
  language: AppLanguage;
};

type ProfilePhotoInput = {
  userId: string;
  photoAsset: ImagePickerAsset;
};

type ProfilePhotoRow = {
  photo_url: string | null;
};

async function uploadProfilePhoto(userId: string, asset: ImagePickerAsset): Promise<string> {
  const shouldKeepPng = asset.mimeType === 'image/png';
  const outputFormat = shouldKeepPng
    ? ImageManipulator.SaveFormat.PNG
    : ImageManipulator.SaveFormat.JPEG;
  const extension = shouldKeepPng ? 'png' : 'jpg';
  const contentType = shouldKeepPng ? 'image/png' : 'image/jpeg';

  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    [
      {
        resize: {
          width: 512,
          height: 512,
        },
      },
    ],
    {
      compress: 0.72,
      format: outputFormat,
    },
  );

  const fileResponse = await fetch(manipulated.uri);
  const fileBuffer = await fileResponse.arrayBuffer();
  const objectPath = `${userId}/avatar-${Date.now()}.${extension}`;

  const uploadResult = await retrySupabaseOperationOnce(() =>
    supabase.storage.from('avatars').upload(objectPath, fileBuffer, {
      cacheControl: '3600',
      contentType,
      upsert: false,
    }),
  );

  throwIfSupabaseError(uploadResult.error, 'Unable to upload the profile photo.');

  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(objectPath);

  return `${publicUrl}?v=${Date.now()}`;
}

export async function saveProfileSetup(input: ProfileUpdateInput): Promise<void> {
  const photoUrl = input.photoAsset
    ? await uploadProfilePhoto(input.userId, input.photoAsset)
    : null;

  const updatePayload = {
    first_name: input.firstName,
    last_name: input.lastName,
    city: input.city,
    language: input.language,
    latitude: input.latitude,
    longitude: input.longitude,
    ...(photoUrl ? { photo_url: photoUrl } : {}),
  };

  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', input.userId)
      .select('id')
      .maybeSingle(),
  );

  throwIfSupabaseError(result.error, 'Unable to save the profile.');

  if (!result.data) {
    throw new Error('Unable to save the profile.');
  }
}

export async function saveProfilePreferences(input: ProfilePreferencesInput): Promise<void> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('profiles')
      .update({
        city: input.city,
        language: input.language,
      })
      .eq('id', input.userId),
  );

  throwIfSupabaseError(result.error, 'Unable to save the profile preferences.');
}

export async function saveProfilePhoto(input: ProfilePhotoInput): Promise<string> {
  const photoUrl = await uploadProfilePhoto(input.userId, input.photoAsset);

  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('profiles')
      .update({ photo_url: photoUrl })
      .eq('id', input.userId)
      .select('photo_url')
      .maybeSingle(),
  );

  throwIfSupabaseError(result.error, 'Unable to save the profile photo.');

  const savedPhotoUrl = (result.data as ProfilePhotoRow | null)?.photo_url ?? null;

  if (!savedPhotoUrl) {
    throw new Error('Unable to save the profile photo.');
  }

  return savedPhotoUrl;
}
