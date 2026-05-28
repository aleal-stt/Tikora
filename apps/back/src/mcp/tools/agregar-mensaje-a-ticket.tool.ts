import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  agregarMensajeATicketInputSchema,
  agregarMensajeATicketOutputSchema,
  type AgregarMensajeATicketOutput,
} from '@tikora/core';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import type { InteractionsService } from '../../interactions/services/interactions.service';
import type { TicketsService } from '../../tickets/services/tickets.service';
import { toolError } from './tool-helpers';

// Estados en los que no aceptamos append (el ticket está terminado).
const ESTADOS_CERRADOS = new Set(['cerrado', 'cancelado']);

type AgregarMensajeATicketArgs = { ticketId: string; texto: string };

export function buildAgregarMensajeATicketHandler(
  user: AuthenticatedUser,
  tickets: TicketsService,
  interactions: InteractionsService,
) {
  return async (args: AgregarMensajeATicketArgs): Promise<CallToolResult> => {
    try {
      const ticket = await tickets.getByRefForCaller(user, args.ticketId);
      if (ESTADOS_CERRADOS.has(ticket.estado)) {
        return toolError(
          `No se puede agregar mensajes al ticket ${ticket.shortCode}: está ${ticket.estado}.`,
        );
      }
      await interactions.createForCaller(user, ticket.id, {
        type: 'usuario',
        content: args.texto,
      });
      const structured: AgregarMensajeATicketOutput = {
        ok: true,
        mensaje: `Mensaje agregado al ticket ${ticket.shortCode}.`,
      };
      return {
        content: [{ type: 'text', text: structured.mensaje }],
        structuredContent: structured,
      };
    } catch (err) {
      return toolError('No pude agregar el mensaje al ticket', err);
    }
  };
}

export function registerAgregarMensajeATicketTool(
  server: McpServer,
  user: AuthenticatedUser,
  tickets: TicketsService,
  interactions: InteractionsService,
): void {
  server.registerTool(
    'agregar_mensaje_a_ticket',
    {
      title: 'Agregar un mensaje a un ticket existente',
      description:
        'Adjunta un mensaje del usuario al timeline del ticket indicado. ' +
        'Acepta como `ticketId` tanto el ObjectId largo como el código corto ' +
        'tipo "TIK-12" que aparece en `listar_mis_tickets`. Falla si el ' +
        'ticket no pertenece al usuario o si está cerrado/cancelado. No ' +
        'reabre el ticket ni re-clasifica: si se necesita revivirlo, el ' +
        'agente debe hacerlo desde la UI.',
      inputSchema: agregarMensajeATicketInputSchema.shape,
      outputSchema: agregarMensajeATicketOutputSchema.shape,
    },
    buildAgregarMensajeATicketHandler(user, tickets, interactions),
  );
}
