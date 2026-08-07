import { Router } from 'express';
import { query } from '@enterprise-ai-os/stores';
import { getApprovalStore } from '@enterprise-ai-os/agent-core';
import { requireAdmin } from '../middleware/auth';
import { AppError, ok, asyncHandler } from '../lib/errors';
import { randomToken, hashToken, revokeAllRefreshTokens } from '../lib/authTokens';
import { mailer } from '../lib/mailer';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const [users, verified, suspended, google, emailAuth, connections, chats, approvals, audits] =
      await Promise.all([
        query(`select count(*)::int as c from users`),
        query(`select count(*)::int as c from users where is_verified = true`),
        query(`select count(*)::int as c from users where is_suspended = true`),
        query(`select count(*)::int as c from users where auth_provider = 'google'`),
        query(`select count(*)::int as c from users where auth_provider = 'email'`),
        query(`select count(*)::int as c from oauth_connections where status = 'active'`),
        query(`select count(*)::int as c from conversations`),
        query(`select count(*)::int as c from approvals where status = 'pending'`),
        query(`select count(*)::int as c from audit_logs where created_at > now() - interval '24 hours'`),
      ]);

    ok(res, {
      totalUsers: users.rows[0].c,
      verifiedUsers: verified.rows[0].c,
      suspendedUsers: suspended.rows[0].c,
      googleSignups: google.rows[0].c,
      emailSignups: emailAuth.rows[0].c,
      connectedIntegrations: connections.rows[0].c,
      conversations: chats.rows[0].c,
      pendingApprovals: approvals.rows[0].c,
      activityLast24h: audits.rows[0].c,
      revenuePlaceholder: 0,
      systemHealth: {
        api: true,
        database: true,
        storage: true,
      },
    });
  })
);

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const params: unknown[] = [];
    let sql = `select u.id, u.email, u.display_name, u.role, u.organization_id, u.created_at, u.last_login,
                      u.is_verified, u.is_suspended, u.auth_provider, o.name as workspace_name
               from users u
               left join organizations o on o.id = u.organization_id`;
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      sql += ` where lower(u.email) like $1 or lower(coalesce(u.display_name,'')) like $1`;
    }
    sql += ` order by u.created_at desc limit 200`;
    const { rows } = await query(sql, params);
    ok(res, { users: rows });
  })
);

adminRouter.post(
  '/users/:id/suspend',
  asyncHandler(async (req, res) => {
    const targetId = req.params.id;
    if (req.user!.id === targetId) throw new AppError('Cannot suspend yourself', 400);
    const suspended = Boolean(req.body?.suspended);
    const result = await query(`update users set is_suspended = $1 where id = $2 returning id`, [
      suspended,
      targetId,
    ]);
    if (!result.rowCount) throw new AppError('User not found', 404);
    ok(res, { userId: targetId, isSuspended: suspended });
  })
);

adminRouter.post(
  '/users/:id/verify',
  asyncHandler(async (req, res) => {
    const result = await query(`update users set is_verified = true where id = $1 returning email`, [
      req.params.id,
    ]);
    if (!result.rowCount) throw new AppError('User not found', 404);
    ok(res, null, 'User verified');
  })
);

adminRouter.post(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const role = String(req.body?.role ?? '');
    const allowed = ['super_admin', 'admin', 'owner', 'member', 'viewer'];
    if (!allowed.includes(role)) throw new AppError('Invalid role', 422);
    if (req.user!.id === req.params.id) throw new AppError('Cannot change your own role here', 400);
    const result = await query(`update users set role = $1 where id = $2 returning id`, [role, req.params.id]);
    if (!result.rowCount) throw new AppError('User not found', 404);
    ok(res, { userId: req.params.id, role });
  })
);

adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const user = await query<{ id: string; email: string }>(`select id, email from users where id = $1`, [
      req.params.id,
    ]);
    if (!user.rows[0]) throw new AppError('User not found', 404);

    // Prefer secure reset-link flow (same as forgot-password)
    await query(`update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null`, [
      user.rows[0].id,
    ]);
    const raw = randomToken();
    await query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '1 hour')`,
      [user.rows[0].id, hashToken(raw)]
    );
    await mailer.sendPasswordReset(user.rows[0].email, raw);
    await revokeAllRefreshTokens(user.rows[0].id);
    ok(res, null, 'Password reset email sent');
  })
);

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (req.user!.id === req.params.id) throw new AppError('Cannot delete yourself', 400);
    const result = await query(`delete from users where id = $1`, [req.params.id]);
    if (!result.rowCount) throw new AppError('User not found', 404);
    ok(res, null, 'User deleted');
  })
);

adminRouter.get(
  '/users/:id/detail',
  asyncHandler(async (req, res) => {
    const user = await query(`select * from users where id = $1`, [req.params.id]);
    if (!user.rows[0]) throw new AppError('User not found', 404);
    const [history, connections, audits] = await Promise.all([
      query(`select * from login_history where user_id = $1 order by created_at desc limit 30`, [req.params.id]),
      query(`select tool, status, updated_at, scope from oauth_connections where user_id = $1`, [req.params.id]),
      query(
        `select event_type, tool, detail, created_at from audit_logs where user_id = $1 order by created_at desc limit 50`,
        [req.params.id]
      ),
    ]);
    ok(res, {
      user: user.rows[0],
      loginHistory: history.rows,
      integrations: connections.rows,
      activity: audits.rows,
    });
  })
);

adminRouter.get(
  '/integrations',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `select oc.id, oc.tool, oc.status, oc.updated_at, oc.expires_at, oc.scope,
              u.email, u.display_name, o.name as workspace_name
       from oauth_connections oc
       left join users u on u.id = oc.user_id
       left join organizations o on o.id = oc.organization_id
       order by oc.updated_at desc
       limit 200`
    );
    ok(res, { connections: rows });
  })
);

adminRouter.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const status = req.query.status as any;
    const store = getApprovalStore() as { listAll?: (status?: string) => Promise<unknown>; list: (org: string, status?: string) => Promise<unknown> };
    const approvals = store.listAll ? await store.listAll(status) : await store.list('', status);
    ok(res, { approvals });
  })
);

adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `select id, organization_id, user_id, event_type, tool, detail, created_at
       from audit_logs order by created_at desc limit 200`
    );
    ok(res, { events: rows });
  })
);
