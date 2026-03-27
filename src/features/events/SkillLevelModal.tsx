import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import { SportBadge } from './EventPrimitives';
import type { AppLanguage } from '../../types/app';
import type { SportSummary } from '../../types/events';

const skillLevelValues = [1, 2, 3, 4] as const;

type SkillLevelModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  selectedSkillLevel: number | null;
  onSelectSkillLevel: (value: number) => void;
  sport: SportSummary | null;
  language: AppLanguage;
  subtitleKey?: string;
};

export function SkillLevelModal({
  visible,
  onClose,
  onConfirm,
  selectedSkillLevel,
  onSelectSkillLevel,
  sport,
  language,
  subtitleKey = 'events.skillLevel.modalSubtitle',
}: SkillLevelModalProps) {
  const { t } = useTranslation();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('shell.skillLevel.title')}</Text>
          {sport ? (
            <View style={styles.modalSportHeader}>
              <SportBadge
                colorHex={sport.colorHex}
                label={
                  language === 'cs'
                    ? sport.nameCs.slice(0, 2).toUpperCase()
                    : sport.nameEn.slice(0, 2).toUpperCase()
                }
              />
              <Text style={styles.modalSportName}>
                {language === 'cs' ? sport.nameCs : sport.nameEn}
              </Text>
            </View>
          ) : null}
          <Text style={styles.modalSubtitle}>{t(subtitleKey)}</Text>
          {skillLevelValues.map((value) => {
            const selected = selectedSkillLevel === value;

            return (
              <Pressable
                key={value}
                onPress={() => onSelectSkillLevel(value)}
                style={[styles.skillOption, selected ? styles.skillOptionSelected : undefined]}
              >
                <Text
                  style={[
                    styles.skillOptionTitle,
                    selected ? styles.skillOptionTitleSelected : undefined,
                  ]}
                >
                  {t(`events.skillLevel.label.${value}`)}
                </Text>
                <Text
                  style={[
                    styles.skillOptionBody,
                    selected ? styles.skillOptionBodySelected : undefined,
                  ]}
                >
                  {t(`events.skillLevel.description.${value}`)}
                </Text>
              </Pressable>
            );
          })}
          <ActionButton
            disabled={!selectedSkillLevel}
            label={t('events.skillLevel.confirm')}
            onPress={onConfirm}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff9f1',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#183153',
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  modalSportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalSportName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  skillOption: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8c8b2',
    padding: 14,
    gap: 4,
    backgroundColor: '#fffdf9',
  },
  skillOptionSelected: {
    borderColor: '#183153',
    backgroundColor: '#183153',
  },
  skillOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  skillOptionTitleSelected: {
    color: '#fff8f0',
  },
  skillOptionBody: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5a6475',
  },
  skillOptionBodySelected: {
    color: '#d2dde8',
  },
});
