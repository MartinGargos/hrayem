import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { z } from 'zod';

import { CURATED_CITIES, type CityName } from '../../constants/cities';
import { signOutAndClearState } from '../../services/auth';
import { detectSuggestedCity } from '../../services/location';
import { saveProfileSetup } from '../../services/profile';
import { useUIStore } from '../../store/ui-store';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage, UserProfile } from '../../types/app';
import {
  ActionButton,
  AuthScaffold,
  ChoiceChips,
  NoticeBanner,
  FormTextField,
  PickerSheet,
  SelectionField,
  TextLink,
} from './AuthPrimitives';
import { mapAuthErrorToMessageKey } from './auth-errors';

const profileSetupSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'auth.validation.firstName')
    .max(50, 'auth.validation.firstName'),
  lastName: z
    .string()
    .trim()
    .min(1, 'auth.validation.lastName')
    .max(50, 'auth.validation.lastName'),
  city: z
    .string()
    .min(1, 'auth.validation.city')
    .refine((value) => CURATED_CITIES.includes(value as CityName), {
      message: 'auth.validation.city',
    }),
  language: z.enum(['cs', 'en']),
});

type ProfileSetupValues = z.infer<typeof profileSetupSchema>;

type ProfileSetupScreenProps = {
  profile: UserProfile;
  userId: string;
  onCompleted: () => Promise<void> | void;
};

const languageOptions: { labelKey: string; value: AppLanguage }[] = [
  { labelKey: 'auth.profileSetup.languageCzech', value: 'cs' },
  { labelKey: 'auth.profileSetup.languageEnglish', value: 'en' },
];

function translateFieldError(
  t: (key: string) => string,
  message: string | undefined,
): string | null {
  return message ? t(message) : null;
}

export function ProfileSetupScreen({ profile, userId, onCompleted }: ProfileSetupScreenProps) {
  const { t } = useTranslation();
  const notice = useUIStore((state) => state.authNotice);
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const setLanguage = useUserStore((state) => state.setLanguage);
  const setSelectedCity = useUserStore((state) => state.setSelectedCity);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCityPickerVisible, setIsCityPickerVisible] = useState(false);
  const [photoAsset, setPhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [locationCoords, setLocationCoords] = useState({
    latitude: profile.latitude,
    longitude: profile.longitude,
  });
  const form = useForm<ProfileSetupValues>({
    resolver: zodResolver(profileSetupSchema),
    defaultValues: {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      city: profile.city ?? '',
      language: profile.language,
    },
  });

  useEffect(() => {
    let isActive = true;

    async function suggestCity() {
      if (form.getValues('city')) {
        return;
      }

      try {
        const suggestedLocation = await detectSuggestedCity();

        if (!isActive) {
          return;
        }

        if (suggestedLocation.city) {
          form.setValue('city', suggestedLocation.city, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }

        if (suggestedLocation.latitude && suggestedLocation.longitude) {
          setLocationCoords({
            latitude: suggestedLocation.latitude,
            longitude: suggestedLocation.longitude,
          });
        }
      } catch {
        // Ignore location failures; manual city selection remains available.
      }
    }

    void suggestCity();

    return () => {
      isActive = false;
    };
  }, [form]);

  const cityOptions = useMemo(
    () => CURATED_CITIES.map((city) => ({ label: city, value: city })),
    [],
  );

  async function handleChoosePhoto() {
    clearAuthNotice();

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== 'granted') {
      setAuthNotice({
        messageKey: 'auth.profileSetup.photoPermissionDenied',
        tone: 'error',
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled) {
      setPhotoAsset(result.assets[0] ?? null);
    }
  }

  async function handleSubmit(values: ProfileSetupValues) {
    clearAuthNotice();
    setIsSubmitting(true);

    try {
      await saveProfileSetup({
        userId,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        city: values.city,
        language: values.language,
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude,
        photoAsset,
      });

      setLanguage(values.language);
      setSelectedCity(values.city as CityName);
      await onCompleted();
    } catch (error) {
      setAuthNotice({
        messageKey: mapAuthErrorToMessageKey(error),
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScaffold
      title={t('auth.profileSetup.title')}
      subtitle={t('auth.profileSetup.subtitle')}
      footer={<TextLink label={t('auth.home.logout')} onPress={signOutAndClearState} />}
    >
      <NoticeBanner notice={notice} resolveMessage={t} />

      <View style={styles.photoSection}>
        {photoAsset ? (
          <Image source={{ uri: photoAsset.uri }} style={styles.photoPreview} />
        ) : profile.photoUrl ? (
          <Image source={{ uri: profile.photoUrl }} style={styles.photoPreview} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>
              {t('auth.profileSetup.photoPlaceholder')}
            </Text>
          </View>
        )}
        <ActionButton
          label={t('auth.profileSetup.photoAction')}
          onPress={handleChoosePhoto}
          variant="secondary"
        />
      </View>

      <Controller
        control={form.control}
        name="firstName"
        render={({ field, fieldState }) => (
          <FormTextField
            autoCapitalize="words"
            autoComplete="name-given"
            label={t('auth.fields.firstName')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.firstName')}
            textContentType="givenName"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <Controller
        control={form.control}
        name="lastName"
        render={({ field, fieldState }) => (
          <FormTextField
            autoCapitalize="words"
            autoComplete="name-family"
            label={t('auth.fields.lastName')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.lastName')}
            textContentType="familyName"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <Controller
        control={form.control}
        name="city"
        render={({ field, fieldState }) => (
          <>
            <SelectionField
              label={t('auth.fields.city')}
              onPress={() => setIsCityPickerVisible(true)}
              placeholder={t('auth.placeholders.city')}
              value={field.value || null}
              error={translateFieldError(t, fieldState.error?.message)}
            />
            <PickerSheet
              onClose={() => setIsCityPickerVisible(false)}
              onSelect={(value) => field.onChange(value)}
              options={cityOptions}
              selectedValue={field.value || null}
              title={t('auth.profileSetup.cityPickerTitle')}
              visible={isCityPickerVisible}
            />
          </>
        )}
      />
      <Controller
        control={form.control}
        name="language"
        render={({ field, fieldState }) => (
          <ChoiceChips
            label={t('auth.fields.language')}
            onChange={field.onChange}
            options={languageOptions.map((option) => ({
              label: t(option.labelKey),
              value: option.value,
            }))}
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />

      <ActionButton
        disabled={isSubmitting}
        label={t('auth.profileSetup.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  photoSection: {
    gap: 14,
  },
  photoPreview: {
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: '#e6eef7',
  },
  photoPlaceholder: {
    width: 104,
    height: 104,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#e6eef7',
  },
  photoPlaceholderText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: '#395065',
  },
});
