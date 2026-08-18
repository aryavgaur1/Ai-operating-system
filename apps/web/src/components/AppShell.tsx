'use client';

import { usePathname } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { WorkspaceRail } from '@/components/WorkspaceRail';
import { AmbientBackground } from '@/components/AmbientBackground';
import { AuthGuard } from '@/components/AuthGuard';
import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import { isAppPath, isAuthPath, isMarketingPath, isOnboardingPath } from '@/lib/routes';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingPath(pathname);
  const auth = isAuthPath(pathname) || isOnboardingPath(pathname);
  const app = isAppPath(pathname) && !isOnboardingPath(pathname);

  if (marketing) {
    return <>{children}</>;
  }

  const appChrome = (
    <>
      {app && <Nav />}
      {app && <WorkspaceRail />}
      <main className={auth || !app ? 'min-h-screen' : 'mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 xl:pl-28'}>
        {children}
      </main>
    </>
  );

  return (
    <>
      <AmbientBackground />
      <AuthGuard>
        {app ? <WorkspaceProvider>{appChrome}</WorkspaceProvider> : appChrome}
      </AuthGuard>
    </>
  );
}
