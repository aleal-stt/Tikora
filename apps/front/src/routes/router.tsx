import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from '../components/require-auth';
import { RequireRole } from '../components/require-role';
import { LoginPage } from '../features/auth/pages/login-page';
import { BandejaPage } from '../features/tickets/pages/bandeja-page';
import { MisTicketsPage } from '../features/tickets/pages/mis-tickets-page';
import { NuevoTicketPage } from '../features/tickets/pages/nuevo-ticket-page';
import { TicketDetailPage } from '../features/tickets/pages/ticket-detail-page';
import { AppShell } from '../layouts/app-shell';
import { AuthLayout } from '../layouts/auth-layout';
import { UsuariosPage } from '../pages/admin/usuarios/usuarios-page';
import { HomeRedirect } from '../pages/home-redirect';

/**
 * Configuración centralizada de rutas. Cada nueva pantalla se registra
 * acá. Las rutas autenticadas viven bajo `AppShell`; las restringidas
 * por rol se envuelven con `<RequireRole>`.
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
        path: '/admin/usuarios',
        element: (
          <RequireRole roles={['admin']}>
            <UsuariosPage />
          </RequireRole>
        ),
      },
      // `/perfil` queda como redirect a `/mis-tickets` mientras no haya página propia.
      { path: '/perfil', element: <Navigate to="/mis-tickets" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
