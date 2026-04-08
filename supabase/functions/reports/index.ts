import { createClient } from 'jsr:@supabase/supabase-js@2';

import { enforceSlidingWindowRateLimit } from '../_shared/rate-limit.ts';

type SubmitReportPayload = {
  target_type: 'event' | 'player';
  target_event_id: string | null;
  target_user_id: string | null;
  reason: 'inappropriate_content' | 'spam_or_fake' | 'abusive_behavior' | 'other';
  detail: string | null;
};

type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'EVENT_NOT_FOUND'
  | 'PLAYER_NOT_FOUND'
  | 'DUPLICATE_USER_REPORT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

type ReportRow = {
  id: string;
  reporter_id: string | null;
  target_type: 'event' | 'player';
  target_event_id: string | null;
  target_user_id: string | null;
  reason: SubmitReportPayload['reason'];
  detail: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  created_at: string;
};

type EventSummaryRow = {
  id: string;
  sport_name_en: string;
  venue_name: string;
  starts_at: string;
};

type PlayerSummaryRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
};

type ReporterSummaryRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
};

type ReportEmailConfig = {
  adminEmail: string;
  resendApiKey: string;
  reportEmailFrom: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

class MissingAuthorizationHeaderError extends Error {
  constructor() {
    super('Missing Authorization header.');
    this.name = 'MissingAuthorizationHeaderError';
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(code: ApiErrorCode, message: string, status: number): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    status,
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}

function createSupabaseClients(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Supabase environment is not configured.');
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    throw new MissingAuthorizationHeaderError();
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    authClient,
    adminClient: createAdminClient(),
  };
}

function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase environment is not configured.');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function requireAuthenticatedUser(request: Request) {
  const { authClient, adminClient } = createSupabaseClients(request);
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return {
      ok: false as const,
      response: errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401),
    };
  }

  return {
    ok: true as const,
    user,
    adminClient,
  };
}

function validatePayload(value: unknown): SubmitReportPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const targetType = payload.target_type;
  const targetEventId =
    typeof payload.target_event_id === 'string'
      ? payload.target_event_id
      : payload.target_event_id === null || typeof payload.target_event_id === 'undefined'
        ? null
        : undefined;
  const targetUserId =
    typeof payload.target_user_id === 'string'
      ? payload.target_user_id
      : payload.target_user_id === null || typeof payload.target_user_id === 'undefined'
        ? null
        : undefined;
  const reason = payload.reason;
  const detail =
    typeof payload.detail === 'string'
      ? payload.detail.trim()
      : payload.detail === null || typeof payload.detail === 'undefined'
        ? null
        : undefined;

  if (targetType !== 'event' && targetType !== 'player') {
    throw new Error("target_type must be 'event' or 'player'.");
  }

  if (targetType === 'event' && !targetEventId) {
    throw new Error('target_event_id is required when reporting an event.');
  }

  if (targetType === 'player' && !targetUserId) {
    throw new Error('target_user_id is required when reporting a player.');
  }

  if (
    (targetType === 'event' && !isUuid(targetEventId!)) ||
    (targetType === 'player' && !isUuid(targetUserId!))
  ) {
    throw new Error('Report target ids must be UUID values.');
  }

  if (
    reason !== 'inappropriate_content' &&
    reason !== 'spam_or_fake' &&
    reason !== 'abusive_behavior' &&
    reason !== 'other'
  ) {
    throw new Error(
      "reason must be one of 'inappropriate_content', 'spam_or_fake', 'abusive_behavior', or 'other'.",
    );
  }

  if (typeof detail === 'undefined') {
    throw new Error('detail must be omitted, null, or a string.');
  }

  if (detail && detail.length > 300) {
    throw new Error('detail must be 300 characters or fewer.');
  }

  return {
    target_type: targetType,
    target_event_id: targetType === 'event' ? targetEventId : null,
    target_user_id: targetType === 'player' ? targetUserId : null,
    reason,
    detail,
  };
}

function getDisplayName(input: { firstName: string | null; lastName: string | null }): string {
  const combinedName = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();

  return combinedName || 'Deleted User';
}

function buildEventDetailUrl(eventId: string): string {
  return `https://hrayem.cz/event/${eventId}`;
}

async function loadEventSummary(
  adminClient: ReturnType<typeof createAdminClient>,
  eventId: string,
): Promise<EventSummaryRow | null> {
  const result = await adminClient
    .from('event_detail_view')
    .select('id, sport_name_en, venue_name, starts_at')
    .eq('id', eventId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data as EventSummaryRow | null) ?? null;
}

async function loadPlayerSummary(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<PlayerSummaryRow | null> {
  const result = await adminClient
    .from('profiles')
    .select('id, first_name, last_name, city')
    .eq('id', userId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data as PlayerSummaryRow | null) ?? null;
}

async function loadReporterSummary(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<ReporterSummaryRow | null> {
  const result = await adminClient
    .from('profiles')
    .select('id, first_name, last_name, city')
    .eq('id', userId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data as ReporterSummaryRow | null) ?? null;
}

function renderReportEmailText(input: {
  report: ReportRow;
  reporter: ReporterSummaryRow | null;
  targetSummary: string;
}): string {
  const reporterName = input.reporter
    ? getDisplayName({
        firstName: input.reporter.first_name,
        lastName: input.reporter.last_name,
      })
    : 'Unknown reporter';

  const lines = [
    'A new Hrayem report was submitted.',
    '',
    `Target: ${input.targetSummary}`,
    `Reason: ${input.report.reason}`,
    `Reporter: ${reporterName}`,
    `Reporter city: ${input.reporter?.city ?? 'Unknown'}`,
    `Created at: ${input.report.created_at}`,
  ];

  if (input.report.detail) {
    lines.push('', `Detail: ${input.report.detail}`);
  }

  return lines.join('\n');
}

function renderReportEmailHtml(input: {
  report: ReportRow;
  reporter: ReporterSummaryRow | null;
  targetSummary: string;
}): string {
  const reporterName = input.reporter
    ? getDisplayName({
        firstName: input.reporter.first_name,
        lastName: input.reporter.last_name,
      })
    : 'Unknown reporter';

  return `
    <h2>New Hrayem report</h2>
    <p><strong>Target:</strong> ${escapeHtml(input.targetSummary)}</p>
    <p><strong>Reason:</strong> ${escapeHtml(input.report.reason)}</p>
    <p><strong>Reporter:</strong> ${escapeHtml(reporterName)}</p>
    <p><strong>Reporter city:</strong> ${escapeHtml(input.reporter?.city ?? 'Unknown')}</p>
    <p><strong>Created at:</strong> ${escapeHtml(input.report.created_at)}</p>
    ${
      input.report.detail
        ? `<p><strong>Detail:</strong><br />${escapeHtml(input.report.detail).replace(/\n/g, '<br />')}</p>`
        : ''
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function requireReportEmailConfig(): ReportEmailConfig {
  const adminEmail = Deno.env.get('ADMIN_REPORT_EMAIL')?.trim();
  const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const reportEmailFrom = Deno.env.get('REPORT_EMAIL_FROM')?.trim();

  if (!adminEmail || !resendApiKey || !reportEmailFrom) {
    throw new Error(
      'Report email delivery is not configured. Set ADMIN_REPORT_EMAIL, RESEND_API_KEY, and REPORT_EMAIL_FROM.',
    );
  }

  return {
    adminEmail,
    resendApiKey,
    reportEmailFrom,
  };
}

async function sendAdminReportEmail(input: {
  report: ReportRow;
  reporter: ReporterSummaryRow | null;
  targetSummary: string;
  subject: string;
}): Promise<void> {
  const { adminEmail, resendApiKey, reportEmailFrom } = requireReportEmailConfig();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: reportEmailFrom,
      to: [adminEmail],
      subject: input.subject,
      text: renderReportEmailText(input),
      html: renderReportEmailHtml(input),
    }),
  });

  if (!response.ok) {
    const responseText = (await response.text().catch(() => '')).trim();
    const suffix = responseText ? ` ${responseText.slice(0, 300)}` : '';
    throw new Error(`Report email delivery failed with ${response.status}.${suffix}`.trim());
  }
}

async function deleteInsertedReport(
  adminClient: ReturnType<typeof createAdminClient>,
  reportId: string,
): Promise<void> {
  const result = await adminClient.from('reports').delete().eq('id', reportId);

  if (result.error) {
    throw new Error(`Unable to roll back the report after email failure: ${result.error.message}`);
  }
}

async function enforceSubmitReportRateLimit(userId: string): Promise<Response | null> {
  const result = await enforceSlidingWindowRateLimit({
    key: `submit-report:${userId}`,
    limit: 5,
    windowMs: 60_000,
  });

  if (result.allowed) {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': `${result.retryAfterSeconds}`,
      },
    },
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for reports.', 405);
  }

  if (!request.headers.get('Authorization')) {
    return errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401);
  }

  let payload: SubmitReportPayload;

  try {
    payload = validatePayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  let authResult: Awaited<ReturnType<typeof requireAuthenticatedUser>>;

  try {
    authResult = await requireAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof MissingAuthorizationHeaderError) {
      return errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401);
    }

    const message =
      error instanceof Error ? error.message : 'Supabase environment is not configured.';
    return errorResponse('INTERNAL_ERROR', message, 500);
  }

  if (!authResult.ok) {
    return authResult.response;
  }

  const rateLimitResponse = await enforceSubmitReportRateLimit(authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let targetSummary = '';
  let subject = 'New Hrayem report';

  try {
    if (payload.target_type === 'event') {
      const eventSummary = await loadEventSummary(authResult.adminClient, payload.target_event_id!);

      if (!eventSummary) {
        return errorResponse('EVENT_NOT_FOUND', 'The requested event no longer exists.', 404);
      }

      targetSummary = `${eventSummary.sport_name_en} at ${eventSummary.venue_name} (${buildEventDetailUrl(eventSummary.id)})`;
      subject = `New Hrayem event report · ${eventSummary.sport_name_en} at ${eventSummary.venue_name}`;
    } else {
      const playerSummary = await loadPlayerSummary(
        authResult.adminClient,
        payload.target_user_id!,
      );

      if (!playerSummary) {
        return errorResponse('PLAYER_NOT_FOUND', 'The requested player no longer exists.', 404);
      }

      const playerName = getDisplayName({
        firstName: playerSummary.first_name,
        lastName: playerSummary.last_name,
      });
      targetSummary = `${playerName}${playerSummary.city ? ` (${playerSummary.city})` : ''}`;
      subject = `New Hrayem player report · ${playerName}`;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to validate the report target.';
    return errorResponse('INTERNAL_ERROR', message, 500);
  }

  let report: ReportRow | null = null;

  const insertResult = await authResult.adminClient
    .from('reports')
    .insert({
      reporter_id: authResult.user.id,
      target_type: payload.target_type,
      target_event_id: payload.target_event_id,
      target_user_id: payload.target_user_id,
      reason: payload.reason,
      detail: payload.detail,
      status: 'pending',
    })
    .select(
      'id, reporter_id, target_type, target_event_id, target_user_id, reason, detail, status, created_at',
    )
    .single();

  if (insertResult.error) {
    if (insertResult.error.code === '23505') {
      return errorResponse('DUPLICATE_USER_REPORT', 'You already reported this target.', 409);
    }

    return errorResponse('INTERNAL_ERROR', insertResult.error.message, 500);
  }

  report = insertResult.data as ReportRow;

  try {
    const reporter = await loadReporterSummary(authResult.adminClient, authResult.user.id);
    await sendAdminReportEmail({
      report,
      reporter,
      subject,
      targetSummary,
    });
  } catch (error) {
    if (report?.id) {
      try {
        await deleteInsertedReport(authResult.adminClient, report.id);
      } catch (rollbackError) {
        console.error('Report rollback after email failure failed.', rollbackError);
      }
    }

    const message =
      error instanceof Error ? error.message : 'Report email delivery failed. Please try again.';
    return errorResponse('INTERNAL_ERROR', message, 500);
  }

  return jsonResponse(
    {
      data: report,
    },
    201,
  );
});
