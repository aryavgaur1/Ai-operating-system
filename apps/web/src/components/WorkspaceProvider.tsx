'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  type WorkspaceContextDto,
  type WorkspaceListItem,
} from '@/lib/api';

type WorkspaceState = {
  workspaces: WorkspaceListItem[];
  current: WorkspaceContextDto | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  activate: (organizationId: string) => Promise<void>;
  createTeam: (name: string) => Promise<WorkspaceListItem>;
};

const WorkspaceCtx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [current, setCurrent] = useState<WorkspaceContextDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [listRes, meRes] = await Promise.all([api.listWorkspaces(), api.me()]);
      setWorkspaces(listRes.workspaces || []);
      const fromMe = meRes.workspace;
      if (fromMe) {
        setCurrent({
          organizationId: fromMe.id,
          name: fromMe.name,
          slug: fromMe.slug,
          kind: fromMe.kind,
          role: fromMe.role,
          status: fromMe.status,
          isPersonalHome: fromMe.isPersonalHome,
        });
      } else {
        const cur = await api.currentWorkspace();
        setCurrent(cur.workspace);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activate = useCallback(
    async (organizationId: string) => {
      setError(null);
      const data = await api.activateWorkspace(organizationId);
      setCurrent(data.workspace);
      await refresh();
    },
    [refresh]
  );

  const createTeam = useCallback(
    async (name: string) => {
      setError(null);
      const { workspace } = await api.createTeamWorkspace(name);
      await refresh();
      return workspace;
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ workspaces, current, loading, error, refresh, activate, createTeam }),
    [workspaces, current, loading, error, refresh, activate, createTeam]
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspaces(): WorkspaceState {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) {
    throw new Error('useWorkspaces must be used within WorkspaceProvider');
  }
  return ctx;
}
