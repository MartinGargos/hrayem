type UpstashPipelineItem = {
  result?: unknown;
  error?: string;
};

type SlidingWindowLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readPipelineResult(item: unknown): unknown {
  if (item && typeof item === 'object' && 'error' in item && (item as UpstashPipelineItem).error) {
    throw new Error((item as UpstashPipelineItem).error);
  }

  if (item && typeof item === 'object' && 'result' in item) {
    return (item as UpstashPipelineItem).result;
  }

  return item;
}

async function runUpstashPipeline(commands: string[][]): Promise<unknown[]> {
  const redisUrl = requiredEnv('UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');
  const redisToken = requiredEnv('UPSTASH_REDIS_REST_TOKEN');
  const response = await fetch(`${redisUrl}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Upstash rate-limit request failed with ${response.status}.`);
  }

  const parsed = (await response.json()) as unknown[];
  return parsed.map(readPipelineResult);
}

export async function enforceSlidingWindowRateLimit(
  input: SlidingWindowLimitInput,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - input.windowMs;
  const cleanupAndCount = await runUpstashPipeline([
    ['ZREMRANGEBYSCORE', input.key, '-inf', `${windowStart}`],
    ['ZCARD', input.key],
    ['PTTL', input.key],
  ]);
  const currentCount = Number(cleanupAndCount[1] ?? 0);
  const ttlMs = Number(cleanupAndCount[2] ?? input.windowMs);

  if (currentCount >= input.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : input.windowMs) / 1_000)),
    };
  }

  await runUpstashPipeline([
    ['ZADD', input.key, `${now}`, `${now}-${crypto.randomUUID()}`],
    ['PEXPIRE', input.key, `${input.windowMs}`],
  ]);

  return {
    allowed: true,
  };
}
