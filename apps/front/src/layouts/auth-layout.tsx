import { Outlet } from 'react-router-dom';

/** Layout del `/login`: sin sidebar ni header, formulario centrado. */
export function AuthLayout() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-blue-600 to-sky-500 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <h1 className="text-3xl font-bold">Tikora</h1>
          <p className="mt-1 text-sm opacity-90">Plataforma de tickets internos</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
