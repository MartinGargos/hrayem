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

async function uploadProfilePhoto(userId: string, asset: ImagePickerAsset): Promise<string> {
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
      format:
        asset.mimeType === 'image/png'
          ? ImageManipulator.SaveFormat.PNG
          : ImageManipulator.SaveFormat.JPEG,
    },
  );

  const fileResponse = await fetch(manipulated.uri);
  const blob = await fileResponse.blob();
  const extension =
    asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${userId}/avatar.${extension}`;

  const uploadResult = await retrySupabaseOperationOnce(() =>
    supabase.storage.from('avatars').upload(objectPath, blob, {
      cacheControl: '3600',
      contentType: asset.mimeType ?? 'image/jpeg',
      upsert: true,
    }),
  );

  throwIfSupabaseError(uploadResult.error, 'Unable to upload the profile photo.');

  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(objectPath);

  return publicUrl;
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
    supabase.from('profiles').update(updatePayload).eq('id', input.userId),
  );

  throwIfSupabaseError(result.error, 'Unable to save the profile.');
}
