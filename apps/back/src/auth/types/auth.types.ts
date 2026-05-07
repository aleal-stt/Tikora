import type { Role } from '@tikora/core';

/** Claims firmados en el access token. */
export interface JwtAccessPayload {
  sub: string;
  tenantId: string;
  role: Role;
  areaIds: string[];
}

/** Claims firmados en el refresh token. `jti` ata el JWT a un documento de la colección `refresh_tokens`. */
export interface JwtRefreshPayload {
  sub: string;
  tenantId: string;
  jti: string;
}

/** Forma del `request.user` que populan los guards después de validar el access token. */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: Role;
  areaIds: string[];
}
