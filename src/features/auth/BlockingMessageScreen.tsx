import { useTranslation } from 'react-i18next';

import { ActionButton, AuthScaffold } from './AuthPrimitives';

type BlockingMessageScreenProps = {
  titleKey: string;
  subtitleKey: string;
  actionLabelKey: string;
  onAction: () => void | Promise<void>;
};

export function BlockingMessageScreen({
  titleKey,
  subtitleKey,
  actionLabelKey,
  onAction,
}: BlockingMessageScreenProps) {
  const { t } = useTranslation();

  return (
    <AuthScaffold title={t(titleKey)} subtitle={t(subtitleKey)}>
      <ActionButton label={t(actionLabelKey)} onPress={onAction} />
    </AuthScaffold>
  );
}
