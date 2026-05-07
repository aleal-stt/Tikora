import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults de TanStack Query según `tikora-frontend.md` §4.3.
 * `staleTime`: 30s — la mayoría de listados toleran un poco de cache.
 * `refetchOnWindowFocus` activo: usuarios que vuelven a la pestaña ven
 * datos frescos sin acción manual.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
