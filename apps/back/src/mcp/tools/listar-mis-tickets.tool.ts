import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import {
  listarMisTicketsInputSchema,
  listarMisTicketsOutputSchema,
  type ListarMisTicketsOutput,
  type TicketResumen,
} from '@tikora/core';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import type { TicketsService } from '../../tickets/services/tickets.service';
import { toolError } from './tool-helpers';

// Pedimos al servicio más de lo que vamos a devolver para que el filtro
// por estado (in-memory) tenga material. El cap duro del back es 100
// (MAX_PAGE_SIZE); pedirle eso evita paginar para una v1 de muestreo.
const SERVICE_FETCH_LIMIT = 100;

type ListarMisTicketsArgs = z.infer<typeof listarMisTicketsInputSchema>;

export function buildListarMisTicketsHandler(user: AuthenticatedUser, tickets: TicketsService) {
  return async (args: ListarMisTicketsArgs): Promise<CallToolResult> => {
    try {
      const page = await tickets.listMine(user, { limit: SERVICE_FETCH_LIMIT });
      const filtered = args.estado
        ? page.items.filter((t) => t.estado === args.estado)
        : page.items;
      const items: TicketResumen[] = filtered.slice(0, args.limite).map((t) => ({
        ticketId: t.id,
        shortCode: t.shortCode,
        asunto: t.asunto,
        estado: t.estado,
        prioridad: t.prioridad,
        createdAt: t.createdAt,
      }));
      const structured: ListarMisTicketsOutput = { tickets: items };
      const summary =
        items.length === 0
          ? args.estado
            ? `No tenés tickets en estado ${args.estado}.`
            : 'No tenés tickets todavía.'
          : `Encontré ${items.length} ticket${items.length === 1 ? '' : 's'}:\n` +
            items.map((t) => `- ${t.shortCode} [${t.estado}] ${t.asunto}`).join('\n');
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: structured,
      };
    } catch (err) {
      return toolError('No pude listar tus tickets', err);
    }
  };
}

export function registerListarMisTicketsTool(
  server: McpServer,
  user: AuthenticatedUser,
  tickets: TicketsService,
): void {
  server.registerTool(
    'listar_mis_tickets',
    {
      title: 'Listar mis tickets',
      description:
        'Devuelve los tickets del usuario actual ordenados del más reciente al más antiguo. ' +
        'Opcionalmente filtra por estado (recibido, escalado, en_progreso, sugerida, cerrado, etc.). ' +
        'Limite máximo: 20 resultados.',
      inputSchema: listarMisTicketsInputSchema.shape,
      outputSchema: listarMisTicketsOutputSchema.shape,
    },
    buildListarMisTicketsHandler(user, tickets),
  );
}
