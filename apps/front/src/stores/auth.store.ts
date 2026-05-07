import type { Role, UserPublic } from '@tikora/core';
import { create } from 'zustand';

interface AuthState {
  /** Access token en memoria — se pierde al recargar (el refresh la repuebla). */
  accessToken: string | null;
  user: UserPublic | null;
  status: 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';

  setSession: (args: { accessToken: string; user: UserPublic }) => void;
  setAccessToken: (token: string) => void;
  setStatus: (status: AuthState['status']) => void;
  reset: () => void;
  hasRole: (...roles: Role[]) => boolean;
  isInArea: (areaId: string) => boolean;
}

/**
 * Auth store del cliente. Cumple `tikora-frontend.md` §4.6:
 *   - El access token NO se persiste (in-memory).
 *   - El refresh token vive en cookie httpOnly que el browser maneja.
 *   - Al recargar, `authBootstrap` llama `/refresh` para repoblar el store.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  status: 'idle',

  setSession: ({ accessToken, user }) => set({ accessToken, user, status: 'authenticated' }),

  setAccessToken: (token) => set({ accessToken: token }),

  setStatus: (status) => set({ status }),

  reset: () => set({ accessToken: null, user: null, status: 'unauthenticated' }),

  hasRole: (...roles) => {
    const role = get().user?.role;
    if (!role) return false;
    return roles.includes(role);
  },

  isInArea: (areaId) => get().user?.areaIds.includes(areaId) ?? false,
}));
