import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from '../components/require-auth';
import { RequireRole } from '../components/require-role';
import { LoginPage } from '../features/auth/pages/login-page';
import { AppShell } from '../layouts/app-shell';
import { AuthLayout } from '../layouts/auth-layout';
import { UsuariosPage } from '../pages/admin/usuarios/usuarios-page';
import { BandejaPage } from '../pages/bandeja/bandeja-page';
import { HomeRedirect } from '../pages/home-redirect';
import { MisTicketsPage } from '../pages/mis-tickets/mis-tickets-page';

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
