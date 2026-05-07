import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './auth.store';

const buildUser = () => ({
  id: 'u_1',
  email: 'agente@empresa.com',
  fullName: 'Juan Pérez',
  role: 'agente' as const,
  areaIds: ['a_1', 'a_2'],
});

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
  });

  it('setSession marca el status como authenticated', () => {
    useAuthStore.getState().setSession({
      accessToken: 'jwt.token.xxx',
      user: buildUser(),
    });
    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('jwt.token.xxx');
    expect(state.user?.email).toBe('agente@empresa.com');
  });

  it('hasRole acepta uno o varios roles', () => {
    useAuthStore.getState().setSession({
      accessToken: 'x',
      user: buildUser(),
    });
    const { hasRole } = useAuthStore.getState();
    expect(hasRole('agente')).toBe(true);
    expect(hasRole('admin', 'lider', 'agente')).toBe(true);
    expect(hasRole('admin')).toBe(false);
  });

  it('isInArea verifica membership por areaId', () => {
    useAuthStore.getState().setSession({
      accessToken: 'x',
      user: buildUser(),
    });
    const { isInArea } = useAuthStore.getState();
    expect(isInArea('a_1')).toBe(true);
    expect(isInArea('a_3')).toBe(false);
  });

  it('reset deja el store unauthenticated y sin token', () => {
    useAuthStore.getState().setSession({
      accessToken: 'x',
      user: buildUser(),
    });
    useAuthStore.getState().reset();
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.status).toBe('unauthenticated');
  });

  it('hasRole sin user retorna false', () => {
    expect(useAuthStore.getState().hasRole('admin')).toBe(false);
  });
});
