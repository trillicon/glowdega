// Admin authentication. Cloudflare Access sits in front of /admin and /api/admin; this re-verifies the
// Access JWT on every request so the admin stays closed even if the Access application is misconfigured.
//
// env.ACCESS_TEAM_DOMAIN  https://<team>.cloudflareaccess.com
// env.ACCESS_AUD          Access application audience tag(s), comma-separated
// env.ADMIN_EMAILS        optional allow-list, comma-separated
// env.ADMIN_DEV_BYPASS    "true" only in .dev.vars, honoured only on localhost

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));
const list = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

let certs = { team: '', keys: [], fetched: 0 };
async function signingKeys(team) {
  if (certs.team !== team || Date.now() - certs.fetched > 10 * 60 * 1000) {
    const res = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access certs ${res.status}`);
    certs = { team, keys: (await res.json()).keys || [], fetched: Date.now() };
  }
  return certs.keys;
}

async function verifyJwt(token, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  const auds = list(env.ACCESS_AUD);
  if (!team.startsWith('https://') || !auds.length) throw new Error('Access is not configured');

  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) throw new Error('malformed token');
  const header = decodeJson(h);
  const payload = decodeJson(p);
  if (header.alg !== 'RS256') throw new Error('unexpected alg');

  const jwk = (await signingKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 30) throw new Error('expired');
  if (payload.nbf && payload.nbf > now + 30) throw new Error('not yet valid');
  if (payload.iss !== team) throw new Error('wrong issuer');
  const tokenAuds = (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).map((a) => String(a).toLowerCase());
  if (!tokenAuds.some((a) => auds.includes(a))) throw new Error('wrong audience');

  const email = String(payload.email || '').toLowerCase();
  const allowed = list(env.ADMIN_EMAILS);
  if (allowed.length && !allowed.includes(email)) throw new Error('email not allowed');
  return email;
}

const cookie = (request, name) =>
  (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);

// Returns the admin's email, or null.
export async function adminEmail(request, env) {
  const host = new URL(request.url).hostname;
  if (env.ADMIN_DEV_BYPASS === 'true' && (host === 'localhost' || host === '127.0.0.1')) return 'dev@localhost';
  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  if (!token) return null;
  try {
    return await verifyJwt(token, env);
  } catch (err) {
    console.warn('admin auth rejected:', err.message);
    return null;
  }
}

export async function requireAdmin(context) {
  const email = await adminEmail(context.request, context.env);
  if (!email) {
    return new Response('Not authorized', { status: 403, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  }
  context.data.adminEmail = email;
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-store');
  out.headers.set('x-robots-tag', 'noindex, nofollow');
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  return out;
}
