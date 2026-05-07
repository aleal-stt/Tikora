import { type ReactElement, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Bloquea rutas autenticadas. Mientras `authenticating` mostramos un
 * placeholder; `unauthenticated` redirige a `/login` preservando la URL
 * intentada en `state.from` para que el login redirija de vuelta.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'idle' || status === 'authenticating') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Cargando…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children as ReactElement;
}
