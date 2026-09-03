import { Router } from 'express';
import { query } from '@enterprise-ai-os/stores';
import { getApprovalStore } from '@enterprise-ai-os/agent-core';
import { requireAdmin } from '../middleware/auth';
import { AppError, ok, asyncHandler } from '../lib/errors';
import { randomToken, hashToken, revokeAllRefreshTokens } from '../lib/authTokens';
import { mailer } from '../lib/mailer';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

/** Never return password hashes / secrets from admin user payloads. */
const USER_SAFE_COLUMNS = `u.id, u.email, u.display_name, u.role, u.organization_id, u.created_at,
  u.last_login, u.is_verified, u.is_suspended, u.auth_provider, u.active_organization_id`;

adminRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const [
      users,
      verified,
      suspended,
      google,
      emailAuth,
      connections,
      chats,
      approvals,
      audits,
      recentUsers,
      recentLogins,
      activeUsers7d,
      personalOrgs,
      teamOrgs,
      activeMemberships,
      integrationByTool,
    ] = await Promise.all([
      query(`select count(*)::int as c from users`),
      query(`select count(*)::int as c from users where is_verified = true`),
      query(`select count(*)::int as c from users where is_suspended = true`),
      query(`select count(*)::int as c from users where auth_provider = 'google'`),
      query(`select count(*)::int as c from users where auth_provider = 'email'`),
      query(`select count(*)::int as c from oauth_connections where status = 'active'`),
      query(`select count(*)::int as c from conversations`),
      query(`select count(*)::int as c from approvals where status = 'pending'`),
      query(`select count(*)::int as c from audit_logs where created_at > now() - interval '24 hours'`),
      query(`select count(*)::int as c from users where created_at > now() - interval '24 hours'`),
      query(
        `select count(*)::int as c from login_history where success = true and created_at > now() - interval '24 hours'`
      ),
      query(
        `select count(distinct user_id)::int as c from login_history where success = true and created_at > now() - interval '7 days'`
      ),
      query(`select count(*)::int as c from organizations where kind = 'personal'`),
      query(`select count(*)::int as c from organizations where kind = 'team'`),
      query(`select count(*)::int as c from organization_memberships where status = 'active'`),
      query(
        `select tool, count(*)::int as c from oauth_connections where status = 'active' group by tool order by tool`
      ),
    ]);

    const integrationsByTool: Record<string, number> = {};
    for (const row of integrationByTool.rows as { tool: string; c: number }[]) {
      integrationsByTool[row.tool] = row.c;
    }

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
      newUsersLast24h: recentUsers.rows[0].c,
      loginsLast24h: recentLogins.rows[0].c,
      activeUsersLast7d: activeUsers7d.rows[0].c,
      personalWorkspaces: personalOrgs.rows[0].c,
      teamWorkspaces: teamOrgs.rows[0].c,
      activeMemberships: activeMemberships.rows[0].c,
      integrationsByTool,
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
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const offset = (page - 1) * limit;
    const sort = String(req.query.sort ?? 'created_at').toLowerCase();
    const order = String(req.query.order ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const sortCol =
      sort === 'email'
        ? 'u.email'
        : sort === 'last_login'
          ? 'u.last_login'
          : sort === 'display_name'
            ? 'u.display_name'
            : 'u.created_at';

    const params: unknown[] = [];
    const clauses: string[] = [];
    let p = 1;
    if (search) {
      clauses.push(
        `(lower(u.email) like $${p} or lower(coalesce(u.display_name,'')) like $${p})`
      );
      params.push(`%${search.toLowerCase()}%`);
      p += 1;
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

    const countSql = `select count(*)::int as c from users u ${where}`;
    const listSql = `select ${USER_SAFE_COLUMNS},
                      o.name as workspace_name,
                      o.kind as workspace_kind,
                      ao.name as active_workspace_name,
                      ao.kind as active_workspace_kind,
                      (select count(*)::int from organization_memberships m
                        where m.user_id = u.id and m.status = 'active') as membership_count
               from users u
               left join organizations o on o.id = u.organization_id
               left join organizations ao on ao.id = coalesce(u.active_organization_id, u.organization_id)
               ${where}
               order by ${sortCol} ${order} nulls last
               limit $${p++} offset $${p++}`;
    params.push(limit, offset);

    const [countRes, listRes] = await Promise.all([
      query<{ c: number }>(countSql, params.slice(0, search ? 1 : 0)),
      query(listSql, params),
    ]);

    ok(res, {
      users: listRes.rows,
      pagination: {
        page,
        limit,
        total: countRes.rows[0]?.c ?? 0,
        totalPages: Math.max(1, Math.ceil((countRes.rows[0]?.c ?? 0) / limit)),
      },
    });
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
    const user = await query(
      `select ${USER_SAFE_COLUMNS}
       from users u
       where u.id = $1`,
      [req.params.id]
    );
    if (!user.rows[0]) throw new AppError('User not found', 404);

    const [history, connections, audits, memberships] = await Promise.all([
      query(
        `select id, organization_id, ip, device, browser, authentication_method, success, created_at
         from login_history where user_id = $1 order by created_at desc limit 30`,
        [req.params.id]
      ),
      query(
        `select tool, status, updated_at, scope, organization_id
         from oauth_connections where user_id = $1`,
        [req.params.id]
      ),
      query(
        `select event_type, tool, detail, created_at from audit_logs where user_id = $1 order by created_at desc limit 50`,
        [req.params.id]
      ),
      query(
        `select m.organization_id, m.role, m.status, m.created_at as joined_at,
                o.name as workspace_name, o.kind as workspace_kind, o.slug as workspace_slug
         from organization_memberships m
         join organizations o on o.id = m.organization_id
         where m.user_id = $1
         order by case o.kind when 'personal' then 0 else 1 end, lower(o.name)`,
        [req.params.id]
      ),
    ]);

    const tools = ['slack', 'gmail', 'notion', 'jira'] as const;
    const integrationStatus = Object.fromEntries(
      tools.map((tool) => {
        const row = connections.rows.find((c: { tool: string; status: string }) => c.tool === tool);
        return [tool, row?.status === 'active' ? 'connected' : 'not_connected'];
      })
    );

    ok(res, {
      user: user.rows[0],
      memberships: memberships.rows,
      workspaces: memberships.rows.map((m: any) => ({
        id: m.organization_id,
        name: m.workspace_name,
        kind: m.workspace_kind,
        role: m.role,
        status: m.status,
        joinedAt: m.joined_at,
      })),
      loginHistory: history.rows,
      integrations: connections.rows.map((c: any) => ({
        tool: c.tool,
        status: c.status,
        updatedAt: c.updated_at,
        organizationId: c.organization_id,
      })),
      integrationStatus,
      activity: audits.rows,
    });
  })
);

adminRouter.get(
  '/workspaces',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const kind = String(req.query.kind ?? '').trim().toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const offset = (page - 1) * limit;

    const params: unknown[] = [];
    const clauses: string[] = [];
    let p = 1;
    if (search) {
      clauses.push(`lower(o.name) like $${p}`);
      params.push(`%${search.toLowerCase()}%`);
      p += 1;
    }
    if (kind === 'personal' || kind === 'team') {
      clauses.push(`o.kind = $${p++}`);
      params.push(kind);
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

    const countRes = await query<{ c: number }>(
      `select count(*)::int as c from organizations o ${where}`,
      params
    );

    const listParams = [...params, limit, offset];
    const { rows } = await query(
      `select o.id, o.name, o.slug, o.kind, o.created_at,
              (select count(*)::int from organization_memberships m
                where m.organization_id = o.id and m.status = 'active') as member_count,
              (select u.email from organization_memberships m
                join users u on u.id = m.user_id
                where m.organization_id = o.id and m.status = 'active' and m.role = 'owner'
                order by m.created_at asc limit 1) as owner_email,
              (select u.display_name from organization_memberships m
                join users u on u.id = m.user_id
                where m.organization_id = o.id and m.status = 'active' and m.role = 'owner'
                order by m.created_at asc limit 1) as owner_name
       from organizations o
       ${where}
       order by o.created_at desc
       limit $${p++} offset $${p++}`,
      listParams
    );

    ok(res, {
      workspaces: rows,
      pagination: {
        page,
        limit,
        total: countRes.rows[0]?.c ?? 0,
        totalPages: Math.max(1, Math.ceil((countRes.rows[0]?.c ?? 0) / limit)),
      },
    });
  })
);

adminRouter.get(
  '/workspaces/:id/members',
  asyncHandler(async (req, res) => {
    const { rows: orgRows } = await query(
      `select id, name, kind, slug, created_at from organizations where id = $1`,
      [req.params.id]
    );
    if (!orgRows[0]) throw new AppError('Workspace not found', 404);

    const { rows: members } = await query(
      `select m.user_id, m.role, m.status, m.created_at as joined_at,
              u.email, u.display_name, u.last_login, u.auth_provider
       from organization_memberships m
       join users u on u.id = m.user_id
       where m.organization_id = $1
       order by
         case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
         lower(coalesce(u.display_name, u.email))`,
      [req.params.id]
    );

    ok(res, { workspace: orgRows[0], members });
  })
);

adminRouter.get(
  '/integrations',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `select oc.id, oc.tool, oc.status, oc.updated_at, oc.expires_at, oc.scope,
              u.email, u.display_name, o.name as workspace_name, o.kind as workspace_kind
       from oauth_connections oc
       left join users u on u.id = oc.user_id
       left join organizations o on o.id = oc.organization_id
       order by oc.updated_at desc
       limit 200`
    );
    // Status only — never tokens
    ok(res, {
      connections: rows.map((r: any) => ({
        id: r.id,
        tool: r.tool,
        status: r.status,
        updated_at: r.updated_at,
        expires_at: r.expires_at,
        scope: r.scope,
        email: r.email,
        display_name: r.display_name,
        workspace_name: r.workspace_name,
        workspace_kind: r.workspace_kind,
      })),
    });
  })
);

adminRouter.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const status = req.query.status as any;
    const store = getApprovalStore() as {
      listAll?: (status?: string) => Promise<unknown>;
      list: (org: string, status?: string) => Promise<unknown>;
    };
    const approvals = store.listAll ? await store.listAll(status) : await store.list('', status);
    ok(res, { approvals });
  })
);

adminRouter.get(
  '/auth/login-activity',
  asyncHandler(async (req, res) => {
    const period = String(req.query.period ?? '7d');
    const userId = String(req.query.user ?? '').trim();
    const method = String(req.query.method ?? '').trim().toLowerCase();
    const workspaceId = String(req.query.workspace ?? '').trim();
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const order = String(req.query.order ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const params: unknown[] = [];
    const clauses: string[] = ['lh.success = true'];
    let p = 1;

    if (period === 'today') {
      clauses.push(`lh.created_at >= date_trunc('day', now())`);
    } else if (period === '30d') {
      clauses.push(`lh.created_at >= now() - interval '30 days'`);
    } else if (period !== 'all') {
      clauses.push(`lh.created_at >= now() - interval '7 days'`);
    }

    if (userId) {
      clauses.push(`lh.user_id = $${p++}::uuid`);
      params.push(userId);
    }
    if (method === 'google' || method === 'password' || method === 'email') {
      clauses.push(`coalesce(lh.authentication_method, 'password') = $${p++}`);
      params.push(method);
    }
    if (workspaceId) {
      clauses.push(`lh.organization_id = $${p++}::uuid`);
      params.push(workspaceId);
    }
    if (search) {
      clauses.push(
        `(lower(u.email) like $${p} or lower(coalesce(u.display_name,'')) like $${p} or lower(coalesce(o.name,'')) like $${p})`
      );
      params.push(`%${search}%`);
      p += 1;
    }

    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

    const [events, stats] = await Promise.all([
      query(
        `select lh.id, lh.user_id, lh.organization_id, lh.ip, lh.device, lh.browser,
                lh.authentication_method, lh.success, lh.created_at,
                u.email, u.display_name, u.auth_provider,
                o.name as workspace_name, o.kind as workspace_kind
         from login_history lh
         join users u on u.id = lh.user_id
         left join organizations o on o.id = lh.organization_id
         ${where}
         order by lh.created_at ${order}
         limit 250`,
        params
      ),
      query(
        `select
           count(*) filter (where lh.success = true and lh.created_at >= date_trunc('day', now()))::int as logins_today,
           count(distinct lh.organization_id) filter (where lh.success = true and lh.created_at >= now() - interval '7 days')::int as active_workspaces_7d,
           count(distinct lh.user_id) filter (where lh.success = true and lh.created_at >= now() - interval '7 days')::int as active_members_7d
         from login_history lh
         join users u on u.id = lh.user_id
         left join organizations o on o.id = lh.organization_id
         ${where}`,
        params
      ),
    ]);

    ok(res, {
      events: events.rows,
      stats: stats.rows[0] ?? {
        logins_today: 0,
        active_workspaces_7d: 0,
        active_members_7d: 0,
      },
    });
  })
);

adminRouter.get(
  '/audit',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `select a.id, a.organization_id, a.user_id, a.event_type, a.tool, a.detail, a.created_at,
              u.email, u.display_name, o.name as workspace_name, o.kind as workspace_kind
       from audit_logs a
       left join users u on u.id = a.user_id
       left join organizations o on o.id = a.organization_id
       order by a.created_at desc
       limit 200`
    );
    ok(res, { events: rows });
  })
);
