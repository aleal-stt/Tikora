/**
 * Nombre de la cookie httpOnly que contiene el refresh token.
 * El path debe coincidir con el `Path` que se setea en `Set-Cookie`
 * para que el browser solo la envíe a los endpoints de auth.
 */
export const REFRESH_COOKIE_NAME = 'tikora.refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
