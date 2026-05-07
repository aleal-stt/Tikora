import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { bootstrapSession } from '../features/auth/api/auth-api';
import { queryClient } from '../lib/query-client';
import { router } from '../routes/router';

export function App() {
  // Bootstrap de sesión al montar: intenta `/auth/refresh` y rellena el
  // store. Si falla, queda `unauthenticated` y el router lleva a `/login`.
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}

export default App;
