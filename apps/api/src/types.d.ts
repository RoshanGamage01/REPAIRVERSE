import type { UserRole, OrgRole, ApiScope } from '@repairverse/shared';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  technicianVerified: boolean;
  memberships: { organizationId: string; role: OrgRole; name: string }[];
}

export interface ApiClientCtx {
  id: string;
  name: string;
  ownerUserId: string;
  scopes: ApiScope[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiClient?: ApiClientCtx;
      requestId?: string;
    }
  }
}
export {};
