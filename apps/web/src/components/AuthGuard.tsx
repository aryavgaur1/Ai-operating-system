'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getAccessToken, setAccessToken, api } from '@/lib/api';
import {
  APP_HOME,
  APP_ROUTES,
  isAuthPath,
  isOnboardingPath,
  isPublicPath,
  LOGIN,
} from '@/lib/routes';

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (tokenFromUrl) {
      setAccessToken(tokenFromUrl);
      params.delete('token');
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

    async function run() {
      if (!token && !isPublic) {
        const next = pathname && pathname !== LOGIN ? `?next=${encodeURIComponent(pathname)}` : '';
        router.replace(`${LOGIN}${next}`);
        return;
      }
      if (token && isAuthPath(pathname) && !hasAuthAction) {
        const next = params.get('next');
        router.replace(next && next.startsWith('/app') ? next : APP_HOME);
        return;
      }
      // Demo / investor mode: skip forced onboarding
      if (!DEMO_MODE && token && !isPublic && !isOnboarding) {
        try {
          const me = await api.me();
          const done = Boolean(me.profile?.preferences?.onboardingCompleted);
          if (!done && me.user.role !== 'super_admin') {
            router.replace(APP_ROUTES.onboarding);
            return;
          }
        } catch {
          // ignore
        }
      }
      // Logged-in users may stay on marketing pages
      if (token && isMarketing) {
        setReady(true);
        return;
      }
      setReady(true);
    }

    run();
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
