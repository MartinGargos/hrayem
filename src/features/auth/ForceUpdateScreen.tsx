import { Linking, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ANDROID_UPDATE_URL, IOS_UPDATE_URL } from '../../constants/external-links';
import { ActionButton, AuthScaffold } from './AuthPrimitives';

export function ForceUpdateScreen() {
  const { t } = useTranslation();

  return (
    <AuthScaffold title={t('auth.forceUpdate.title')} subtitle={t('auth.forceUpdate.subtitle')}>
      <ActionButton
        label={t('auth.forceUpdate.update')}
        onPress={() => Linking.openURL(Platform.OS === 'ios' ? IOS_UPDATE_URL : ANDROID_UPDATE_URL)}
      />
    </AuthScaffold>
  );
}
