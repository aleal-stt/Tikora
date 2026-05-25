import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  crearTicketInputSchema,
  crearTicketOutputSchema,
  type CrearTicketOutput,
} from '@tikora/core';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import type { TicketsService } from '../../tickets/services/tickets.service';
import { toolError } from './tool-helpers';

/**
 * Registra la tool `crear_ticket` con el contexto del caller en closure.
 * Delega a `TicketsService.create` para que el ticket entre al mismo
 * pipeline de clasificación IA que los creados desde la UI.
 */
type CrearTicketArgs = { asunto: string; cuerpo: string };

export function buildCrearTicketHandler(user: AuthenticatedUser, tickets: TicketsService) {
  return async (args: CrearTicketArgs): Promise<CallToolResult> => {
    try {
      const ticket = await tickets.create(user, {
        asunto: args.asunto,
        cuerpo: args.cuerpo,
      });
      const structured: CrearTicketOutput = {
        ticketId: ticket.id,
        shortCode: ticket.shortCode,
        estado: ticket.estado,
        mensaje: `Ticket ${ticket.shortCode} creado correctamente. Estado actual: ${ticket.estado}.`,
      };
      return {
        content: [{ type: 'text', text: structured.mensaje }],
        structuredContent: structured,
      };
    } catch (err) {
      return toolError('No pude crear el ticket', err);
    }
  };
}

export function registerCrearTicketTool(
  server: McpServer,
  user: AuthenticatedUser,
  tickets: TicketsService,
): void {
  server.registerTool(
    'crear_ticket',
    {
      title: 'Crear un ticket nuevo',
      description:
        'Crea un ticket de soporte en Tikora a nombre del usuario actual. ' +
        'El ticket entra al pipeline de clasificación automática y, según la ' +
        'configuración, recibe una respuesta sugerida o el escalamiento a un ' +
        'agente humano. Devuelve el id corto del ticket para que el usuario ' +
        'pueda consultarlo después con obtener_ticket.',
      inputSchema: crearTicketInputSchema.shape,
      outputSchema: crearTicketOutputSchema.shape,
    },
    buildCrearTicketHandler(user, tickets),
  );
}
