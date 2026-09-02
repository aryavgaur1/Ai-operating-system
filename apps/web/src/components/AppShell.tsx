'use client';

import { usePathname } from 'next/navigation';
import { AppBackground } from '@/components/work/AppBackground';
import { AmbientBackground } from '@/components/AmbientBackground';
import { AuthGuard } from '@/components/AuthGuard';
import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import { WorkOsShell } from '@/components/work-os/WorkOsShell';
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

  const appChrome = app ? <WorkOsShell>{children}</WorkOsShell> : <main className="min-h-screen">{children}</main>;

  return (
    <>
      {app ? <AppBackground /> : <AmbientBackground />}
      <AuthGuard>{app ? <WorkspaceProvider>{appChrome}</WorkspaceProvider> : appChrome}</AuthGuard>
    </>
  );
}
