import { callEdgeFunctionRoute } from './edge-functions';
import type { SubmitReportInput, SubmitReportResponse } from '../types/reports';

type ReportErrorCode =
  | 'DUPLICATE_USER_REPORT'
  | 'EVENT_NOT_FOUND'
  | 'PLAYER_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'INTERNAL_ERROR';

export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResponse> {
  return callEdgeFunctionRoute<SubmitReportResponse, ReportErrorCode>('reports', '', {
    target_type: input.targetType,
    target_event_id: input.targetType === 'event' ? input.targetEventId : null,
    target_user_id: input.targetType === 'player' ? input.targetUserId : null,
    reason: input.reason,
    detail: input.detail ?? null,
  });
}
