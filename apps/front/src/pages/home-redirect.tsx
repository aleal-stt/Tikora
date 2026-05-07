import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';

/**
 * `/` redirige al inicio canónico de cada rol según `tikora-frontend.md` §5.2.
 * - empleado → `/mis-tickets`
 * - agente/lider → `/bandeja`
 * - admin → `/admin/usuarios` (en Sprint 1; en sprints siguientes apuntará a `/admin/metricas`)
 */
export function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'admin') return <Navigate to="/admin/usuarios" replace />;
  if (role === 'agente' || role === 'lider') return <Navigate to="/bandeja" replace />;
  return <Navigate to="/mis-tickets" replace />;
}
