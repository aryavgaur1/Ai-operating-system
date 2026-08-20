'use client';

import { usePathname } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { WorkspaceRail } from '@/components/WorkspaceRail';
import { AmbientBackground } from '@/components/AmbientBackground';
import { AuthGuard } from '@/components/AuthGuard';
import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import { JarvisProvider } from '@/components/JarvisProvider';
import {
  isAppPath,
  isAuthPath,
  isInvitePath,
  isMarketingPath,
  isOnboardingPath,
} from '@/lib/routes';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingPath(pathname) && !isInvitePath(pathname);
  const invite = isInvitePath(pathname);
  const auth = isAuthPath(pathname) || isOnboardingPath(pathname);
  const app = isAppPath(pathname) && !isOnboardingPath(pathname);

  if (marketing) {
    return <>{children}</>;
  }

  if (invite) {
    return (
      <>
        <AmbientBackground />
        <AuthGuard>
          <main className="min-h-screen">{children}</main>
        </AuthGuard>
      </>
    );
  }

  const appChrome = (
    <>
      {app && <Nav />}
      {app && <WorkspaceRail />}
      <main
        className={
          auth || !app
            ? 'min-h-screen'
            : 'app-main mx-auto max-w-7xl px-3 pb-24 pt-4 sm:px-6 sm:pb-16 sm:pt-8 xl:pl-28'
        }
      >
        {children}
      </main>
    </>
  );

  return (
    <>
      <AmbientBackground />
      <AuthGuard>
        {app ? (
          <WorkspaceProvider>
            <JarvisProvider>{appChrome}</JarvisProvider>
          </WorkspaceProvider>
        ) : (
          appChrome
        )}
      </AuthGuard>
    </>
  );
}
