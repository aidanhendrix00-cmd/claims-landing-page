// Cloudflare Worker: auth + tenant dashboard routing.
// Falls back to static assets (the marketing site) for everything else.

const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const NO_STORE = 'private, no-store, no-cache, must-revalidate';

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes.buffer);
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.tenant_id, t.slug AS tenant_slug, t.company_name, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token = ?`
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request body' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return new Response(JSON.stringify({ ok: false, error: 'Email and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first();
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid email or password' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
  }

  const computedHash = await hashPassword(password, user.salt);
  if (computedHash !== user.password_hash) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid email or password' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expiresAt).run();

  const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
  return new Response(JSON.stringify({ ok: true, redirect: '/dashboard' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': NO_STORE }
  });
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  const cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  return new Response(JSON.stringify({ ok: true, redirect: '/' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': NO_STORE }
  });
}

async function handleDashboard(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': new URL('/', request.url).toString() + '?login=1', 'Cache-Control': NO_STORE }
    });
  }
  const assetResponse = await env.ASSETS.fetch(new URL('/dashboard.html', request.url));
  let html = await assetResponse.text();
  const safeName = String(user.company_name || '').replace(/"/g, '&quot;');
  html = html
    .replace(/data-company-name="[^"]*"/, 'data-company-name="' + safeName + '"')
    .replace(/data-tenant-slug="[^"]*"/, 'data-tenant-slug="' + user.tenant_slug + '"');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } });
}

async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
  }
  return new Response(JSON.stringify({
    ok: true,
    email: user.email,
    role: user.role,
    tenant: user.tenant_slug,
    companyName: user.company_name
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return handleMe(request, env);
    }
    if (url.pathname === '/dashboard') {
      return handleDashboard(request, env);
    }
    if (url.pathname === '/dashboard.html') {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/dashboard', 'Cache-Control': NO_STORE }
      });
    }
    if (url.pathname === '/dashboard.html') {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/dashboard', 'Cache-Control': NO_STORE }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
