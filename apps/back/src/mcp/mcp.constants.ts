/**
 * Prefijo de identificación de las API keys MCP. Sirve para distinguirlas
 * de otros tokens en logs y para rechazos rápidos en la validación.
 */
export const MCP_KEY_PREFIX = 'tk_mcp_';

/**
 * Largo del cuerpo aleatorio (post-prefijo) en chars base62.
 * 24 chars × log2(62) ≈ 143 bits de entropía — equivalente a UUIDv4 con margen.
 */
export const MCP_SECRET_BODY_LENGTH = 24;

/**
 * Largo del fragmento visible (`prefix`) que se persiste en claro: el prefijo
 * fijo más los primeros 5 chars del cuerpo. Sirve para acotar la búsqueda
 * de candidatos al validar la key sin comparar el hash contra toda la tabla.
 */
export const MCP_KEY_VISIBLE_PREFIX_LENGTH = MCP_KEY_PREFIX.length + 5;

/**
 * Largo total del secreto completo: prefijo + cuerpo aleatorio.
 */
export const MCP_KEY_TOTAL_LENGTH = MCP_KEY_PREFIX.length + MCP_SECRET_BODY_LENGTH;
