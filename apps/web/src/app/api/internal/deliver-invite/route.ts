import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  'https://nexora-api.up.railway.app'
).replace(/\/$/, '');

const WEB_APP_URL = (
  process.env.NEXT_PUBLIC_WEB_APP_URL ||
  process.env.WEB_APP_URL ||
  'https://ai-lilac-phi.vercel.app'
).replace(/\/$/, '');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInviteHtml(opts: {
  workspaceName: string;
  inviterName: string;
  role: string;
  invitedEmail: string;
  expiresAt: string;
  acceptUrl: string;
}): string {
  const workspace = escapeHtml(opts.workspaceName);
  const inviter = escapeHtml(opts.inviterName);
  const role = escapeHtml(opts.role);
  const invitedEmail = escapeHtml(opts.invitedEmail);
  const expires = escapeHtml(opts.expiresAt);
  const acceptUrl = escapeHtml(opts.acceptUrl);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;background:#070b12;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#070b12;padding:40px 16px;color:#e5e7eb;">
    <div style="max-width:520px;margin:0 auto;background:#0f172a;border-radius:20px;padding:36px 32px;border:1px solid #1e293b;">
      <div style="font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#60a5fa;margin-bottom:18px;font-weight:600;">Nexora OS</div>
      <h1 style="font-size:22px;margin:0 0 18px;color:#ffffff;">You've been invited to join ${workspace}</h1>
      <p style="font-size:16px;color:#e2e8f0;margin:0 0 8px;">You've been invited to join:</p>
      <p style="font-size:20px;font-weight:650;color:#ffffff;margin:0 0 20px;">${workspace}</p>
      <table style="width:100%;font-size:14px;color:#cbd5e1;margin:0 0 20px;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#94a3b8;width:110px;">Invited by</td><td style="padding:6px 0;"><strong>${inviter}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Role</td><td style="padding:6px 0;"><strong>${role}</strong></td></tr>
      </table>
      <p>You've been invited to collaborate with your team in Nexora OS.</p>
      <p style="margin:28px 0 8px;"><a href="${acceptUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">ACCESS WORKSPACE</a></p>
      <p style="font-size:13px;color:#94a3b8;margin-top:20px;">Access Workspace:<br/><span style="word-break:break-all;">${acceptUrl}</span></p>
      <p style="font-size:13px;color:#94a3b8;margin-top:16px;">This invitation is intended for:<br/><strong style="color:#e2e8f0;">${invitedEmail}</strong></p>
      <p style="font-size:12px;color:#64748b;margin-top:16px;">This invitation expires on ${expires}.</p>
      <p style="font-size:12px;color:#64748b;margin-top:12px;">If you did not expect this invitation, you can ignore this email.</p>
    </div>
  </div>
</body></html>`;
}

/** POST-only internal relay — reject other methods explicitly. */
export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

/**
 * Deliver a workspace invitation email via Resend (HTTPS).
 * Body: { token: string } — raw invite token.
 * Verifies the invitation against the Railway API before sending.
 * Security: no shared secret — only delivers for tokens that preview as pending
 * on the Railway API (token acts as capability). Rate/abuse limited by token secrecy.
 */
export async function POST(req: NextRequest) {
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  if (!resendKey) {
    return NextResponse.json({ ok: false, error: 'resend_not_configured' }, { status: 503 });
  }

  let token = '';
  try {
    const body = await req.json();
    token = String(body?.token || '').trim();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
  }

  const previewRes = await fetch(`${API_URL}/invitations/${encodeURIComponent(token)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!previewRes.ok) {
    return NextResponse.json({ ok: false, error: 'invitation_not_found' }, { status: 404 });
  }
  const previewJson = await previewRes.json();
  const inv = previewJson?.data?.invitation || previewJson?.invitation || previewJson?.data;
  if (!inv || inv.status !== 'pending') {
    return NextResponse.json({ ok: false, error: 'invitation_not_pending' }, { status: 409 });
  }

  const to = String(inv.email || '').trim();
  const workspaceName = String(inv.organizationName || inv.workspaceName || 'a workspace');
  const inviterName = String(inv.invitedByDisplayName || inv.invitedByEmail || 'A teammate');
  const role = String(inv.role || 'member');
  const expiresAt = inv.expiresAt ? new Date(inv.expiresAt).toUTCString() : 'soon';
  const acceptUrl = `${WEB_APP_URL}/invite/${encodeURIComponent(token)}`;
  const subject = `Nexora OS — You've been invited to join ${workspaceName}`;
  const html = buildInviteHtml({
    workspaceName,
    inviterName,
    role,
    invitedEmail: to,
    expiresAt,
    acceptUrl,
  });
  const from = (process.env.EMAIL_FROM || 'Nexora OS <onboarding@resend.dev>').trim();

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const sendText = await sendRes.text();
  if (!sendRes.ok) {
    let parsed: { name?: string; message?: string; statusCode?: number } | null = null;
    try {
      parsed = JSON.parse(sendText);
    } catch {
      // ignore
    }
    const message = String(parsed?.message || sendText.slice(0, 200));
    const lower = message.toLowerCase();
    const domainBlocked =
      lower.includes('verify a domain') ||
      lower.includes('only send testing emails') ||
      lower.includes('domain is not verified') ||
      lower.includes('from address is not verified');
    return NextResponse.json(
      {
        ok: false,
        error: domainBlocked ? 'resend_domain_unverified' : 'resend_failed',
        errorCode: domainBlocked ? 'resend_domain_unverified' : String(parsed?.name || 'resend_failed'),
        detail: message.slice(0, 240),
        hint: domainBlocked
          ? 'Resend is in test mode (onboarding@resend.dev only reaches the Resend account owner). Verify a domain at resend.com/domains, then set EMAIL_FROM to an address on that domain on the API and Vercel.'
          : undefined,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, delivered: true, mode: 'resend_relay' });
}
