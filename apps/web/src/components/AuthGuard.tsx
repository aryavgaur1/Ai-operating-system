'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getAccessToken, setAccessToken, setRefreshToken, api } from '@/lib/api';
import {
  APP_HOME,
  APP_ROUTES,
  isAuthPath,
  isOnboardingPath,
  isPublicPath,
  isSafeNextPath,
  LOGIN,
} from '@/lib/routes';

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const params = new URLSearchParams(window.location.search);
      const tokenFromUrl = params.get('token');
      const refreshFromUrl = params.get('refresh');
      if (tokenFromUrl) {
        setAccessToken(tokenFromUrl);
        params.delete('token');
      }
      if (refreshFromUrl) {
        setRefreshToken(refreshFromUrl);
        params.delete('refresh');
      }
      if (tokenFromUrl || refreshFromUrl) {
        const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
        window.history.replaceState({}, '', clean);
      }

      const verify = params.get('verify');
      if (verify) {
        api.verifyEmail(verify).catch(() => undefined);
      }

      const isPublic = isPublicPath(pathname);
      const isOnboarding = isOnboardingPath(pathname);
      const token = getAccessToken();
      const hasAuthAction = Boolean(params.get('reset') || params.get('verify'));
      const isMarketing = isPublic && !isAuthPath(pathname);

      // Google OAuth lands on /app/dashboard?token=... — never bounce that away.
      if (!token && !isPublic) {
        const next = pathname && pathname !== LOGIN ? `?next=${encodeURIComponent(pathname)}` : '';
        router.replace(`${LOGIN}${next}`);
        return;
      }
      if (token && isAuthPath(pathname) && !hasAuthAction) {
        const next = params.get('next');
        router.replace(isSafeNextPath(next) ? next! : APP_HOME);
        return;
      }

      if (!DEMO_MODE && token && !isPublic && !isOnboarding) {
        try {
          const me = await api.me();
          if (cancelled) return;
          const done = Boolean(me.profile?.preferences?.onboardingCompleted);
          if (!done && me.user.role !== 'super_admin') {
            // Preserve OAuth callback query (?connected=slack) when bouncing into onboarding.
            const qs = params.toString();
            router.replace(`${APP_ROUTES.onboarding}${qs ? `?${qs}` : ''}`);
            return;
          }
        } catch {
          // Keep session; stale tokens are handled by API 401 + refresh.
        }
      }

      if (cancelled) return;
      if (token && isMarketing) {
        setReady(true);
        return;
      }
      setReady(true);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!ready && !isPublicPath(pathname)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Checking session…
      </div>
    );
  }

  return <>{children}</>;
}
