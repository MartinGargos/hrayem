export type ReportTargetType = 'event' | 'player';

export type ReportReason = 'inappropriate_content' | 'spam_or_fake' | 'abusive_behavior' | 'other';

export type SubmitReportInput =
  | {
      targetType: 'event';
      targetEventId: string;
      reason: ReportReason;
      detail?: string | null;
    }
  | {
      targetType: 'player';
      targetUserId: string;
      reason: ReportReason;
      detail?: string | null;
    };

export type SubmitReportResponse = {
  id: string;
  reporter_id: string | null;
  target_type: ReportTargetType;
  target_event_id: string | null;
  target_user_id: string | null;
  reason: ReportReason;
  detail: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  created_at: string;
};
