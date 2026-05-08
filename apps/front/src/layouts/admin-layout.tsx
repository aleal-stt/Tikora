import {
  AdjustmentsHorizontalIcon,
  BookOpenIcon,
  BuildingOffice2Icon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/utils';

interface AdminNavItem {
  to: string;
  label: string;
  icon: typeof UsersIcon;
}

const NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin/usuarios', label: 'Usuarios', icon: UsersIcon },
  { to: '/admin/areas', label: 'Áreas', icon: BuildingOffice2Icon },
  { to: '/admin/kb', label: 'Base de conocimiento', icon: BookOpenIcon },
  { to: '/admin/slas', label: 'SLAs', icon: AdjustmentsHorizontalIcon },
];

/**
 * Sub-layout para rutas /admin/*. Se monta dentro de AppShell, así que el
 * sidebar principal sigue visible. Acá agregamos un sub-nav lateral con
 * las secciones admin (Usuarios / Áreas / SLAs / ...).
 */
export function AdminLayout() {
  return (
    <div className="flex h-full gap-6">
      <aside className="w-48 shrink-0">
        <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Administración
        </div>
        <nav className="mt-2 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <AdminNavLink key={item.to} {...item} />
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

function AdminNavLink({ to, label, icon: Icon }: AdminNavItem) {
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
      {label}
    </NavLink>
  );
}
