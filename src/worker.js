// Cloudflare Worker: auth + tenant dashboard routing + signup/onboarding flow.
// Falls back to static assets (the marketing site) for everything else.

const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const NO_STORE = 'private, no-store, no-cache, must-revalidate';
const VERIFICATION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const NOTIFY_EMAIL = 'hndrx@claims-collection.net';
const FROM_EMAIL = 'clAIms <onboarding@claims-collection.net>';
const SITE_URL = 'https://claims-collection.net';

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com',
  'protonmail.com','live.com','msn.com','me.com','mail.com','gmx.com'
]);

const STRIPE_LINKS = {
  starter: 'https://buy.stripe.com/3cI9AM8I3a1j5Rnf5Zb7y00',
  growth: 'https://buy.stripe.com/dRm5kw2jF8Xf6Vr0b5b7y01',
  enterprise: null
};

function planForSize(size) {
  if (size === '1-10') return 'starter';
  if (size === '11-50') return 'growth';
  return 'enterprise';
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
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
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes.buffer);
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toHex(bytes.buffer);
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach(function(part) {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function slugify(name) {
  const s = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return s || 'company';
}

function emailDomain(email) {
  const parts = String(email).toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
}

function redirectTo(target) {
  const location = target.indexOf('http') === 0 ? target : (SITE_URL + target);
  return new Response(null, { status: 302, headers: { 'Location': location, 'Cache-Control': NO_STORE } });
}

async function uniqueSlug(env, base) {
  let slug = base;
  let n = 1;
  while (true) {
    const row = await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
    if (!row) return slug;
    n++;
    slug = base + '-' + n;
  }
}

async function sendEmail(env, opts) {
  const to = opts.to, subject = opts.subject, html = opts.html, kind = opts.kind, tenantId = opts.tenantId, userId = opts.userId;
  if (!env.RESEND_API_KEY) {
    try {
      await env.DB.prepare(
        'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(to, subject, kind, tenantId || null, userId || null, 'skipped', 'RESEND_API_KEY not configured').run();
    } catch (e) {}
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: subject, html: html })
    });
    const ok = res.ok;
    let errText = '';
    if (!ok) errText = await res.text();
    await env.DB.prepare(
      'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(to, subject, kind, tenantId || null, userId || null, ok ? 'sent' : 'failed', ok ? null : errText.slice(0, 500)).run();
    return { ok: ok };
  } catch (e) {
    try {
      await env.DB.prepare(
        'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(to, subject, kind, tenantId || null, userId || null, 'failed', String(e).slice(0, 500)).run();
    } catch (e2) {}
    return { ok: false, error: String(e) };
  }
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.role, u.tenant_id, u.status AS user_status, u.email_verified, ' +
    't.slug AS tenant_slug, t.company_name, t.status AS tenant_status, t.integration_status, s.expires_at ' +
    'FROM sessions s ' +
    'JOIN users u ON u.id = s.user_id ' +
    'JOIN tenants t ON t.id = u.tenant_id ' +
    'WHERE s.token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const confirmPassword = body.confirmPassword || '';
  const companyName = (body.companyName || '').trim();
  const address = (body.address || '').trim();
  const city = (body.city || '').trim();
  const state = (body.state || '').trim();
  const zip = (body.zip || '').trim();
  const companySize = (body.companySize || '').trim();

  if (!fullName || !email || !password || !companyName || !companySize) {
    return json({ ok: false, error: 'Please fill out all required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ ok: false, error: 'Passwords do not match.' }, 400);
  }

  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first();
  if (existingUser) {
    return json({ ok: false, error: 'An account with this email already exists.' }, 409);
  }

  const domain = emailDomain(email);
  const isPersonalDomain = PERSONAL_EMAIL_DOMAINS.has(domain);

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const verificationToken = randomToken();
  const verificationExpires = new Date(Date.now() + VERIFICATION_TTL_SECONDS * 1000).toISOString();

  let tenant = null;
  let isNewTenant = false;
  let userRole = 'admin';
  let userStatus = 'pending_verification';

  if (!isPersonalDomain) {
    tenant = await env.DB.prepare('SELECT * FROM tenants WHERE domain = ?').bind(domain).first();
  }

  if (tenant) {
    userRole = 'user';
    userStatus = 'pending_approval';
  } else {
    isNewTenant = true;
    const recommendedPlan = planForSize(companySize);
    const slug = await uniqueSlug(env, slugify(companyName));
    const insertTenant = await env.DB.prepare(
      "INSERT INTO tenants (slug, company_name, domain, address, city, state, zip, company_size, recommended_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')"
    ).bind(slug, companyName, isPersonalDomain ? null : domain, address, city, state, zip, companySize, recommendedPlan).run();
    const tenantId = insertTenant.meta.last_row_id;
    tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  }

  const insertUser = await env.DB.prepare(
    'INSERT INTO users (tenant_id, email, password_hash, salt, role, status, email_verified, verification_token, verification_expires, full_name) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
  ).bind(tenant.id, email, passwordHash, salt, userRole, userStatus, verificationToken, verificationExpires, fullName).run();
  const userId = insertUser.meta.last_row_id;

  if (isNewTenant) {
    await env.DB.prepare('UPDATE tenants SET admin_user_id = ? WHERE id = ?').bind(userId, tenant.id).run();
  }

  const verifyUrl = SITE_URL + '/api/verify-email?token=' + verificationToken;
  const verifyHtml =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
    '<h2 style="color:#171717;">Verify your email</h2>' +
    '<p>Hi ' + escapeHtml(fullName) + ',</p>' +
    '<p>Thanks for signing up for clAIms' + (isNewTenant ? '' : ' — ' + escapeHtml(tenant.company_name)) + '. Click below to verify your email and continue setup.</p>' +
    '<p style="margin:28px 0;"><a href="' + verifyUrl + '" style="background:#171717;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Verify email</a></p>' +
    '<p style="color:#666;font-size:13px;">This link expires in 24 hours. If you did not request this, you can ignore this email.</p>' +
    '</div>';
  await sendEmail(env, { to: email, subject: 'Verify your email for clAIms', html: verifyHtml, kind: 'verify_email', tenantId: tenant.id, userId: userId });

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New Create Account submission</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Full name</td><td style="padding:4px 8px;">' + escapeHtml(fullName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company</td><td style="padding:4px 8px;">' + escapeHtml(companyName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Address</td><td style="padding:4px 8px;">' + escapeHtml(address) + ', ' + escapeHtml(city) + ', ' + escapeHtml(state) + ' ' + escapeHtml(zip) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company size</td><td style="padding:4px 8px;">' + escapeHtml(companySize) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Recommended plan</td><td style="padding:4px 8px;">' + escapeHtml(tenant.recommended_plan || 'n/a') + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Signup type</td><td style="padding:4px 8px;">' + (isNewTenant ? 'New company (' + escapeHtml(tenant.slug) + ')' : 'Joined existing company: ' + escapeHtml(tenant.company_name) + ' (pending admin approval)') + '</td></tr>' +
    '</table>' +
    '</div>';
  await sendEmail(env, { to: NOTIFY_EMAIL, subject: 'New signup: ' + companyName + ' (' + email + ')', html: notifyHtml, kind: 'signup_notification', tenantId: tenant.id, userId: userId });

  return json({ ok: true, message: 'Check your email to verify your account.', joinedExisting: !isNewTenant });
}

async function handleVerifyEmail(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return redirectTo('/?verify=missing');

  const user = await env.DB.prepare('SELECT * FROM users WHERE verification_token = ?').bind(token).first();
  if (!user) return redirectTo('/?verify=invalid');
  if (user.verification_expires && new Date(user.verification_expires) < new Date()) {
    return redirectTo('/?verify=expired');
  }

  await env.DB.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').bind(user.id).run();

  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(user.tenant_id).first();

  if (tenant && user.role === 'admin' && tenant.admin_user_id === user.id) {
    const plan = tenant.recommended_plan || 'starter';
    const link = STRIPE_LINKS[plan];
    if (!link) {
      await env.DB.prepare("UPDATE tenants SET status = 'verified' WHERE id = ?").bind(tenant.id).run();
      return redirectTo('/?verify=enterprise');
    }
    await env.DB.prepare("UPDATE tenants SET status = 'payment_pending' WHERE id = ?").bind(tenant.id).run();
    const paymentUrl = link + '?prefilled_email=' + encodeURIComponent(user.email) + '&client_reference_id=' + tenant.id;
    return redirectTo(paymentUrl);
  }

  return redirectTo('/?verify=pending-approval');
}

async function handlePendingApprovals(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  const results = await env.DB.prepare(
    "SELECT id, email, full_name, status, created_at FROM users WHERE tenant_id = ? AND status = 'pending_approval'"
  ).bind(admin.tenant_id).all();
  return json({ ok: true, pending: results.results });
}

async function handleApproveUser(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid body' }, 400); }
  const targetId = body.userId;
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(targetId, admin.tenant_id).first();
  if (!target) return json({ ok: false, error: 'User not found' }, 404);
  await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(targetId).run();
  return json({ ok: true });
}

async function handleRejectUser(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid body' }, 400); }
  const targetId = body.userId;
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(targetId, admin.tenant_id).first();
  if (!target) return json({ ok: false, error: 'User not found' }, 404);
  await env.DB.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").bind(targetId).run();
  return json({ ok: true });
}

async function verifyStripeSignature(env, sigHeader, rawBody) {
  if (!env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = {};
  sigHeader.split(',').forEach(function(p) {
    const idx = p.indexOf('=');
    if (idx === -1) return;
    parts[p.slice(0, idx)] = p.slice(idx + 1);
  });
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const signedPayload = timestamp + '.' + rawBody;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expected = toHex(sigBuf);
  return expected === v1;
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') || '';
  const valid = await verifyStripeSignature(env, sigHeader, rawBody);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return new Response('Bad payload', { status: 400 }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tenantId = session.client_reference_id;
    if (tenantId) {
      await env.DB.prepare(
        "UPDATE tenants SET status = 'active', integration_status = 'not_started', stripe_customer_id = ? WHERE id = ?"
      ).bind(session.customer || null, tenantId).run();
      await env.DB.prepare(
        "UPDATE users SET status = 'active' WHERE tenant_id = ? AND role = 'admin'"
      ).bind(tenantId).run();

      const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
      if (tenant) {
        const notifyHtml = '<div style="font-family:sans-serif;"><h2>Payment received</h2><p>' + escapeHtml(tenant.company_name) + ' has completed payment and is now active. Plan: ' + escapeHtml(tenant.selected_plan || tenant.recommended_plan || 'n/a') + '.</p></div>';
        await sendEmail(env, { to: NOTIFY_EMAIL, subject: 'Payment received: ' + tenant.company_name, html: notifyHtml, kind: 'payment_received', tenantId: tenant.id });
      }
    }
  }

  return new Response('ok', { status: 200 });
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return json({ ok: false, error: 'Email and password are required' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first();
  if (!user) {
    return json({ ok: false, error: 'Invalid email or password' }, 401);
  }

  const computedHash = await hashPassword(password, user.salt);
  if (computedHash !== user.password_hash) {
    return json({ ok: false, error: 'Invalid email or password' }, 401);
  }

  if (!user.email_verified) {
    return json({ ok: false, error: 'Please verify your email before logging in. Check your inbox for the verification link.' }, 403);
  }
  if (user.status === 'pending_approval') {
    return json({ ok: false, error: "Your account is pending approval from your company's admin." }, 403);
  }
  if (user.status === 'rejected') {
    return json({ ok: false, error: 'Your access request was declined. Contact your company admin.' }, 403);
  }

  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(user.tenant_id).first();
  if (tenant && user.role === 'admin' && (tenant.status === 'verified' || tenant.status === 'payment_pending')) {
    const plan = tenant.recommended_plan || 'starter';
    const link = STRIPE_LINKS[plan];
    if (link) {
      const paymentUrl = link + '?prefilled_email=' + encodeURIComponent(user.email) + '&client_reference_id=' + tenant.id;
      return json({ ok: false, error: 'Your company account is verified — finish payment to activate it.', redirect: paymentUrl }, 403);
    }
    return json({ ok: false, error: 'Your plan requires a custom quote. Our team will reach out shortly, or contact hndrx@claims-collection.net.' }, 403);
  }
  if (tenant && tenant.status !== 'active' && user.role !== 'admin') {
    return json({ ok: false, error: "Your company's account setup is not finished yet. Please contact your admin." }, 403);
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expiresAt).run();

  const cookie = SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_TTL_SECONDS;
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
  const cookie = SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
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
    return json({ ok: false }, 401);
  }
  return json({
    ok: true,
    email: user.email,
    role: user.role,
    tenant: user.tenant_slug,
    companyName: user.company_name,
    tenantStatus: user.tenant_status,
    integrationStatus: user.integration_status
  });
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
    if (url.pathname === '/api/signup' && request.method === 'POST') {
      return handleSignup(request, env);
    }
    if (url.pathname === '/api/verify-email' && request.method === 'GET') {
      return handleVerifyEmail(request, env);
    }
    if (url.pathname === '/api/pending-approvals' && request.method === 'GET') {
      return handlePendingApprovals(request, env);
    }
    if (url.pathname === '/api/approve-user' && request.method === 'POST') {
      return handleApproveUser(request, env);
    }
    if (url.pathname === '/api/reject-user' && request.method === 'POST') {
      return handleRejectUser(request, env);
    }
    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
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

    return env.ASSETS.fetch(request);
  }
};
