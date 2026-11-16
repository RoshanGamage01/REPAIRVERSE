import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { UserRole } from '@repairverse/shared';
import { api } from './api';
import { FullPageSpinner } from '../ui';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  technicianVerified: boolean;
  memberships: { organizationId: string; role: string; name: string }[];
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: User | null }>('/auth/me'), staleTime: 60_000 });
  const value: AuthCtx = {
    user: q.data?.user ?? null,
    loading: q.isLoading,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    logout: async () => {
      await api.post('/auth/logout');
      qc.clear();
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const isStaff = (u: User | null) => !!u && (u.role === 'admin' || u.role === 'moderator');
export const isPro = (u: User | null) => !!u && (u.role === 'technician' || u.role === 'admin');
