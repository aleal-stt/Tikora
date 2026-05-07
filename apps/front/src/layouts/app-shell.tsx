import {
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon,
  InboxIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useMutation } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { logout } from '../features/auth/api/auth-api';
import { cn } from '../lib/utils';
import { useAuthStore } from '../stores/auth.store';

/**
 * Layout principal autenticado. Header con marca/perfil/logout +
 * sidebar de navegación contextual al rol. Cuando llegue SSE en otro
 * sprint, este componente abre la conexión global.
 */
export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const hasRole = useAuthStore((s) => s.hasRole);
  const navigate = useNavigate();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => navigate('/login', { replace: true }),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
        <Link
          to="/"
          className="text-xl font-bold tracking-tight text-slate-900 hover:text-blue-700"
        >
          Tikora
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-900">{user?.fullName}</div>
            <div className="text-xs text-slate-500">
              {user?.email} · {user?.role}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            Salir
          </Button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-3">
          <nav className="flex flex-col gap-1">
            <SidebarLink to="/mis-tickets" icon={InboxIcon}>
              Mis tickets
            </SidebarLink>
            {hasRole('agente', 'lider', 'admin') && (
              <SidebarLink to="/bandeja" icon={InboxIcon}>
                Bandeja
              </SidebarLink>
            )}
            {hasRole('admin') && (
              <>
                <div className="mt-3 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Administración
                </div>
                <SidebarLink to="/admin/usuarios" icon={UserGroupIcon}>
                  Usuarios
                </SidebarLink>
              </>
            )}
            <div className="mt-3">
              <SidebarLink to="/perfil" icon={Cog6ToothIcon}>
                Mi perfil
              </SidebarLink>
            </div>
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

interface SidebarLinkProps {
  to: string;
  icon: typeof InboxIcon;
  children: React.ReactNode;
}

function SidebarLink({ to, icon: Icon, children }: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100',
        )
      }
    >
      <Icon className="h-5 w-5" />
      {children}
    </NavLink>
  );
}
