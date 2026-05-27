/**
 * Prefijo del `client_id` emitido por DCR. Permite reconocer en logs
 * que el id pertenece a Tikora.
 */
export const OAUTH_CLIENT_ID_PREFIX = 'tk_oauth_client_';

/**
 * Prefijo de los `client_secret` emitidos por DCR.
 */
export const OAUTH_CLIENT_SECRET_PREFIX = 'tk_oauth_csec_';

/**
 * Prefijo del `code` emitido en el flow Authorization Code. Es opaco
 * para el cliente pero sirve para distinguirlo de un access token en
 * logs sin tener que mirar la tabla.
 */
export const OAUTH_AUTH_CODE_PREFIX = 'tk_oauth_code_';

/**
 * Prefijo de los access tokens OAuth. Se diferencia de las API keys
 * MCP (`tk_mcp_`) para que el guard `McpAuthGuard` enrute por tipo.
 */
export const OAUTH_ACCESS_TOKEN_PREFIX = 'tk_oauth_at_';

/**
 * Prefijo de los refresh tokens OAuth.
 */
export const OAUTH_REFRESH_TOKEN_PREFIX = 'tk_oauth_rt_';

/**
 * TTL del registro de "pending authorization" (entre GET /authorize y
 * la confirmación del usuario en el consent). Si el usuario tarda más
 * de esto, el flow se cae con error.
 */
export const OAUTH_PENDING_AUTH_TTL_SECONDS = 5 * 60;

/**
 * TTL del code una vez autorizado. Conforme a OAuth 2.1: muy corto.
 */
export const OAUTH_AUTH_CODE_TTL_SECONDS = 60;

/**
 * Scope único que pedimos en v1. No tenemos partición de permisos
 * dentro del MCP server — un token tiene acceso a las 4 tools o no
 * tiene acceso.
 */
export const OAUTH_DEFAULT_SCOPE = 'mcp';
