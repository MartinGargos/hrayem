import { createClient } from 'jsr:@supabase/supabase-js@2';

type SharedEventDetailRow = {
  id: string;
  sport_id: string;
  sport_slug: string;
  sport_name_cs: string;
  sport_name_en: string;
  sport_icon: string;
  sport_color: string;
  organizer_id: string | null;
  organizer_first_name: string | null;
  organizer_last_name: string | null;
  organizer_photo_url: string | null;
  organizer_no_shows: number;
  organizer_games_played: number;
  venue_id: string;
  venue_name: string;
  venue_address: string | null;
  starts_at: string;
  ends_at: string;
  city: string;
  reservation_type: 'reserved' | 'to_be_arranged';
  player_count_total: number;
  skill_min: number;
  skill_max: number;
  description: string | null;
  status: 'active' | 'full' | 'finished' | 'cancelled';
  spots_taken: number;
  waitlist_count: number;
  created_at: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
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

function parseShareEventId(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const shareIndex = segments.lastIndexOf('share');
  const tail = shareIndex >= 0 ? segments.slice(shareIndex + 1) : [];

  if (tail.length === 2 && tail[0] === 'event' && isUuid(tail[1] ?? '')) {
    return tail[1]!;
  }

  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only GET is supported on this route.', 405);
  }

  const eventId = parseShareEventId(request.url);

  if (!eventId) {
    return errorResponse('VALIDATION_ERROR', 'A valid event ID is required.', 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(
      'INTERNAL_ERROR',
      'Share route is not configured correctly on the server.',
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const result = await supabase
    .from('event_detail_view')
    .select(
      'id, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, organizer_id, organizer_first_name, organizer_last_name, organizer_photo_url, organizer_no_shows, organizer_games_played, venue_id, venue_name, venue_address, starts_at, ends_at, city, reservation_type, player_count_total, skill_min, skill_max, description, status, spots_taken, waitlist_count, created_at',
    )
    .eq('id', eventId)
    .single<SharedEventDetailRow>();

  if (result.error) {
    if (result.error.code === 'PGRST116') {
      return errorResponse('EVENT_NOT_FOUND', 'This event is no longer available.', 404);
    }

    console.error('Share route failed to load event detail.', result.error);
    return errorResponse('INTERNAL_ERROR', 'Unable to load the shared event.', 500);
  }

  if (!result.data) {
    return errorResponse('EVENT_NOT_FOUND', 'This event is no longer available.', 404);
  }

  return jsonResponse({
    data: result.data,
  });
});
