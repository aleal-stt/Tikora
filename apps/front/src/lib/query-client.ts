import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults de TanStack Query.
 *
 * `staleTime: 0` + `refetchOnMount: 'always'`: cada vez que un componente
 * monta, dispara fetch. Antes usábamos 30s y los usuarios reportaban ver
 * cache viejo al volver a la bandeja sin recargar la página. Para una
 * app interna con dataset chico el costo de network es despreciable y la
 * UX gana mucho — los datos se ven frescos siempre.
 *
 * `gcTime: 5min` mantiene los datos en memoria mientras no haya observers,
 * así una navegación fuera y vuelta no remonta vacío (la query usa el
 * cache mientras refetchea en background).
 *
 * `refetchOnWindowFocus`: el usuario que vuelve a la pestaña ve datos
 * frescos sin acción manual.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
