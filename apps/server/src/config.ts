// Centralised environment configuration. All secrets come from the
// environment; nothing is hard-coded. Missing optional integrations simply
// disable the features that need them (documented in README.md).

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v === '' ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// CORS origins: allow bare hosts (e.g. from Render's fromService `host`
// references) and normalise them to https:// origins.
function originList(name: string, fallback: string[]): string[] {
  return list(name, fallback).map((o) =>
    /^https?:\/\//i.test(o) ? o : `https://${o}`,
  );
}

const upstashUrl = str('UPSTASH_REDIS_REST_URL');
const upstashToken = str('UPSTASH_REDIS_REST_TOKEN');
const supabaseUrl = str('SUPABASE_URL').replace(/\/$/, '');
const supabaseServiceKey = str('SUPABASE_SERVICE_ROLE_KEY');
const supabaseAnonKey = str('SUPABASE_ANON_KEY');
const turnstileSecret = str('TURNSTILE_SECRET_KEY');

export const config = {
  port: int('PORT', 4000),
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  // Render injects RENDER_EXTERNAL_URL at runtime, so the prod self-ping
  // needs no manual configuration after deploy.
  socketServerUrl: str(
    'SOCKET_SERVER_URL',
    str('RENDER_EXTERNAL_URL', 'http://localhost:4000'),
  ).replace(/\/$/, ''),
  allowedOrigins: originList('ALLOWED_ORIGINS', ['http://localhost:3000']),

  // Integrations (optional; features degrade gracefully when unset)
  useRedis: upstashUrl !== '' && upstashToken !== '',
  upstashUrl,
  upstashToken,
  useSupabase: supabaseUrl !== '' && supabaseServiceKey !== '',
  supabaseUrl,
  supabaseServiceKey,
  // Anon key is used to validate user JWTs against the Supabase Auth API.
  // History features require all three Supabase vars; metadata features need
  // only the URL + service key as before.
  supabaseAnonKey,
  useSupabaseAuth: supabaseUrl !== '' && supabaseAnonKey !== '',
  useTurnstile: turnstileSecret !== '',
  turnstileSecret,

  // Tunables
  maxMessageLength: 2000,
  queueStaleMs: 90_000,
  sessionIdleMs: 30 * 60_000,
  presenceTtlSec: 120,

  // Admin/moderation panel. Read lazily (not at import time) so tests and
  // tooling can set the vars at runtime. The /admin API is disabled entirely
  // when neither ADMIN_TOKEN nor ADMIN_PASSWORD_HASH is set.
  get adminToken(): string {
    return str('ADMIN_TOKEN');
  },
  // Username for the admin panel login (POST /admin/login).
  get adminUser(): string {
    return str('ADMIN_USER', 'admin');
  },
  // Scrypt hash of the admin password for POST /admin/login.
  // Format: "scrypt$<saltHex>$<keyHex>" (N=16384, r=8, p=1, 64-byte key).
  // Generate one with:
  //   node -e "const c=require('crypto'),u=require('util'),s=u.promisify(c.scrypt);(async()=>{const salt=c.randomBytes(16),k=await s(process.argv[1],salt,64,{N:16384,r:8,p:1});console.log('scrypt$'+salt.toString('hex')+'$'+k.toString('hex'))})()" '<password>'
  // Only the hash is stored — the plain password never touches disk or git.
  get adminPasswordHash(): string {
    return str('ADMIN_PASSWORD_HASH');
  },
};

export type Config = typeof config;
