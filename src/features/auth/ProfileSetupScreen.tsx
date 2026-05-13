import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

const languageOptions: { labelKey: string; shortLabel: string; value: AppLanguage }[] = [
  { labelKey: 'auth.profileSetup.languageCzech', shortLabel: 'CZ', value: 'cs' },
  { labelKey: 'auth.profileSetup.languageEnglish', shortLabel: 'GB', value: 'en' },
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

  function handleRemoveSelectedPhoto() {
    setPhotoAsset(null);
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

  const photoUri = photoAsset?.uri ?? profile.photoUrl;

  return (
    <AuthScaffold
      betweenHeroAndCard={
        <View style={styles.progressCard}>
          <View style={[styles.progressSegment, styles.progressSegmentDone]} />
          <View style={[styles.progressSegment, styles.progressSegmentDone]} />
          <View style={[styles.progressSegment, styles.progressSegmentDone]} />
          <View style={styles.progressSegment} />
          <Text style={styles.progressLabel}>{t('auth.profileSetup.progress')}</Text>
        </View>
      }
      title={t('auth.profileSetup.title')}
      subtitle={t('auth.profileSetup.subtitle')}
      footer={
        <View style={styles.footerActions}>
          <ActionButton
            disabled={isSubmitting}
            iconName="arrow-forward"
            iconPosition="right"
            label={t('auth.profileSetup.submit')}
            onPress={form.handleSubmit(handleSubmit)}
            variant="lime"
          />
          <TextLink label={t('auth.home.logout')} onPress={signOutAndClearState} />
        </View>
      }
    >
      <NoticeBanner notice={notice} resolveMessage={t} />

      <View style={styles.photoSection}>
        <View style={styles.photoFrame}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons color="#aba69e" name="person-outline" size={42} />
            </View>
          )}
          <Pressable
            accessibilityLabel={t('auth.profileSetup.photoAction')}
            accessibilityRole="button"
            onPress={handleChoosePhoto}
            style={styles.photoPlusButton}
          >
            <Text style={styles.photoPlusText}>+</Text>
          </Pressable>
        </View>
        <View style={styles.photoCopy}>
          <Text style={styles.photoTitle}>{t('auth.profileSetup.photoTitle')}</Text>
          <Text style={styles.photoHelp}>{t('auth.profileSetup.photoHelp')}</Text>
          <View style={styles.photoActions}>
            <Pressable
              accessibilityLabel={t('auth.profileSetup.photoAction')}
              accessibilityRole="button"
              onPress={handleChoosePhoto}
              style={styles.photoSmallButton}
            >
              <Text style={styles.photoSmallButtonText}>{t('auth.profileSetup.photoAction')}</Text>
            </Pressable>
            {photoAsset ? (
              <Pressable
                accessibilityLabel={t('auth.profileSetup.photoRemove')}
                accessibilityRole="button"
                onPress={handleRemoveSelectedPhoto}
                style={[styles.photoSmallButton, styles.photoSmallButtonSecondary]}
              >
                <Text style={styles.photoSmallButtonSecondaryText}>
                  {t('auth.profileSetup.photoRemove')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.twoColumnRow}>
        <View style={styles.twoColumnField}>
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
        </View>
        <View style={styles.twoColumnField}>
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
        </View>
      </View>
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
          <View style={styles.languageField}>
            <Text style={styles.languageLabel}>{t('auth.fields.language')}</Text>
            <View style={styles.languageSegment}>
              {languageOptions.map((option) => {
                const selected = option.value === field.value;

                return (
                  <Pressable
                    accessibilityLabel={`${t('auth.fields.language')}: ${t(option.labelKey)}`}
                    accessibilityRole="button"
                    key={option.value}
                    onPress={() => field.onChange(option.value)}
                    style={[styles.languageOption, selected ? styles.languageOptionSelected : null]}
                  >
                    <Text
                      style={[styles.languageShort, selected ? styles.languageShortSelected : null]}
                    >
                      {option.shortLabel}
                    </Text>
                    <Text
                      style={[
                        styles.languageOptionText,
                        selected ? styles.languageOptionTextSelected : null,
                      ]}
                    >
                      {t(option.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {fieldState.error ? (
              <Text style={styles.errorText}>
                {translateFieldError(t, fieldState.error.message)}
              </Text>
            ) : null}
          </View>
        )}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  progressCard: {
    minHeight: 42,
    borderRadius: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fffbf6',
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e6e1d9',
  },
  progressSegmentDone: {
    backgroundColor: '#c8ff28',
  },
  progressLabel: {
    marginLeft: 8,
    fontSize: 13,
    fontWeight: '900',
    color: '#67615a',
  },
  photoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  photoFrame: {
    width: 96,
    height: 96,
  },
  photoPreview: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#c8ff28',
    backgroundColor: '#e8e0d4',
  },
  photoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#ddd5c9',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0ebe2',
  },
  photoPlusButton: {
    position: 'absolute',
    right: -2,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fffbf6',
    backgroundColor: '#c8ff28',
  },
  photoPlusText: {
    marginTop: -1,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '900',
    color: '#061427',
  },
  photoCopy: {
    flex: 1,
    gap: 5,
  },
  photoTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    color: '#061427',
  },
  photoHelp: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5f6670',
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  photoSmallButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#061427',
  },
  photoSmallButtonText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#fffdf8',
  },
  photoSmallButtonSecondary: {
    borderWidth: 1,
    borderColor: '#dedbd7',
    backgroundColor: '#fffdf8',
  },
  photoSmallButtonSecondaryText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#67615a',
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  twoColumnField: {
    flex: 1,
  },
  languageField: {
    gap: 8,
  },
  languageLabel: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: '#66707c',
  },
  languageSegment: {
    minHeight: 60,
    borderRadius: 18,
    padding: 4,
    flexDirection: 'row',
    backgroundColor: '#f3efe7',
  },
  languageOption: {
    flex: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  languageOptionSelected: {
    backgroundColor: '#061427',
  },
  languageShort: {
    fontSize: 11,
    fontWeight: '900',
    color: '#6f665d',
  },
  languageShortSelected: {
    color: '#fffdf8',
  },
  languageOptionText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#6f665d',
  },
  languageOptionTextSelected: {
    color: '#fffdf8',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#b44740',
  },
  footerActions: {
    gap: 20,
    alignItems: 'center',
  },
});
