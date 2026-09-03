/**
 * Guards for admin console restoration + workspace pill responsiveness.
 * Run: node scripts/verify-admin-console.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const adminRoute = fs.readFileSync(path.join(root, 'apps/api/src/routes/admin.ts'), 'utf8');
assert.ok(adminRoute.includes('requireAdmin'), 'admin router must use requireAdmin');
assert.ok(adminRoute.includes('/workspaces'), 'admin workspaces endpoint required');
assert.ok(adminRoute.includes('personalWorkspaces'), 'metrics must include personal workspaces');
assert.ok(adminRoute.includes('teamWorkspaces'), 'metrics must include team workspaces');
assert.ok(!adminRoute.includes('select * from users'), 'must not select * from users (secrets leak)');
assert.ok(adminRoute.includes('password_hash') === false || !/select\s+\*\s+from\s+users/i.test(adminRoute), 'no wildcard users select');
assert.ok(!/select\s+\*\s+from\s+users/i.test(adminRoute), 'no select * from users');

const platformApi = fs.readFileSync(path.join(root, 'apps/api/src/lib/platformAdmin.ts'), 'utf8');
assert.ok(platformApi.includes('aryavgaur'), 'platform admin email configured');
assert.ok(platformApi.includes('isPlatformAdminEmail'), 'isPlatformAdminEmail export');

const platformWeb = fs.readFileSync(path.join(root, 'apps/web/src/lib/platformAdmin.ts'), 'utf8');
assert.ok(platformWeb.includes('aryavgaur'), 'web platform admin email configured');

const adminPage = fs.readFileSync(path.join(root, 'apps/web/src/app/app/admin/page.tsx'), 'utf8');
assert.ok(adminPage.includes("isPlatformAdminEmail"), 'admin page gates on platform admin');
assert.ok(adminPage.includes('adminWorkspaces'), 'admin page loads workspaces');
assert.ok(adminPage.includes('login_history') || adminPage.includes('Login Activity'), 'login activity section');
assert.ok(!adminPage.includes('Aryav Sharma'), 'no hardcoded demo people in admin');
assert.ok(!adminPage.includes('Priyanshu'), 'no hardcoded demo people in admin');

const switcher = fs.readFileSync(path.join(root, 'apps/web/src/components/WorkspaceSwitcher.tsx'), 'utf8');
assert.ok(!switcher.includes("max-w-[148px]"), 'remove tiny max-w that collapsed the pill');
assert.ok(switcher.includes('clamp(') || switcher.includes('min-w'), 'workspace pill needs resilient width');

const nav = fs.readFileSync(path.join(root, 'apps/web/src/components/Nav.tsx'), 'utf8');
assert.ok(nav.includes('min-w-[9.5rem]') || nav.includes('min-w-[10.5rem]'), 'nav must reserve space for workspace pill');

console.log('PASS verify-admin-console');
