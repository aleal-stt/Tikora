import type { Role } from '@tikora/core';
import { type ReactElement, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';

interface RequireRoleProps {
  roles: Role[];
  children: ReactNode;
}

/**
 * Restringe una ruta autenticada a un subset de roles. Si el usuario no
 * tiene el rol necesario, lo redirigimos a `/` (que recolecciona según rol).
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role || !roles.includes(role)) {
    return <Navigate to="/" replace />;
  }
  return children as ReactElement;
}
