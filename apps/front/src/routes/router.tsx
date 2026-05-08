import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from '../components/require-auth';
import { RequireRole } from '../components/require-role';
import { AreaDetailPage } from '../features/admin/pages/area-detail-page';
import { AreasPage } from '../features/admin/pages/areas-page';
import { KbPage } from '../features/admin/pages/kb-page';
import { SlasPage } from '../features/admin/pages/slas-page';
import { UsuariosPage } from '../features/admin/pages/usuarios-page';
import { LoginPage } from '../features/auth/pages/login-page';
import { BandejaPage } from '../features/tickets/pages/bandeja-page';
import { MisTicketsPage } from '../features/tickets/pages/mis-tickets-page';
import { NuevoTicketPage } from '../features/tickets/pages/nuevo-ticket-page';
import { TicketDetailPage } from '../features/tickets/pages/ticket-detail-page';
import { AdminLayout } from '../layouts/admin-layout';
import { AppShell } from '../layouts/app-shell';
import { AuthLayout } from '../layouts/auth-layout';
import { HomeRedirect } from '../pages/home-redirect';

/**
 * Configuración centralizada de rutas. Las rutas autenticadas viven bajo
 * `AppShell`; las /admin/* se agrupan en `AdminLayout` (sub-nav lateral)
 * y son visibles para `lider` y `admin` — el back filtra el scope dentro
 * de cada endpoint.
 */
export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/mis-tickets', element: <MisTicketsPage /> },
      { path: '/mis-tickets/nuevo', element: <NuevoTicketPage /> },
      { path: '/tickets/:id', element: <TicketDetailPage /> },
      {
        path: '/bandeja',
        element: (
          <RequireRole roles={['agente', 'lider', 'admin']}>
            <BandejaPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin',
        element: (
          <RequireRole roles={['lider', 'admin']}>
            <AdminLayout />
          </RequireRole>
        ),
        children: [
          { index: true, element: <Navigate to="/admin/usuarios" replace /> },
          { path: 'usuarios', element: <UsuariosPage /> },
          { path: 'areas', element: <AreasPage /> },
          { path: 'areas/:id', element: <AreaDetailPage /> },
          { path: 'kb', element: <KbPage /> },
          { path: 'slas', element: <SlasPage /> },
        ],
      },
      { path: '/perfil', element: <Navigate to="/mis-tickets" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
