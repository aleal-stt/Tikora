import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  obtenerTicketInputSchema,
  obtenerTicketOutputSchema,
  type EventoHistorial,
  type ObtenerTicketOutput,
  type UltimaRespuestaAgente,
} from '@tikora/core';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import type { InteractionsService } from '../../interactions/services/interactions.service';
import type { TicketsService } from '../../tickets/services/tickets.service';
import { toolError } from './tool-helpers';

// Historial limitado a los últimos N eventos para no inflar el contexto que
// Claude tiene que digerir. 10 cubre tickets típicos sin ser overwhelming.
const HISTORY_LIMIT = 10;

type ObtenerTicketArgs = { ticketId: string };

export function buildObtenerTicketHandler(
  user: AuthenticatedUser,
  tickets: TicketsService,
  interactions: InteractionsService,
) {
  return async (args: ObtenerTicketArgs): Promise<CallToolResult> => {
    try {
      const ticket = await tickets.getByRefForCaller(user, args.ticketId);
      const list = await interactions.listForTicket(user, ticket.id, {
        limit: HISTORY_LIMIT,
      });

      // listForTicket devuelve ASC; tomamos los últimos N eventos.
      const recientes = list.items.slice(-HISTORY_LIMIT);
      const historial: EventoHistorial[] = recientes.map((i) => ({
        tipo: i.type === 'sistema' ? 'cambio_estado' : 'mensaje',
        contenido: i.content,
        fecha: i.createdAt,
      }));

      // Para el empleado, "respuesta del agente" incluye tanto la respuesta
      // de un agente humano (`type='agente'`) como la auto-respuesta de la IA
      // (`type='ia'`). El nombre se distingue para que el user sepa quién le
      // respondió, sin acoplar la tool a UsersService.
      const ultimaAgente = [...list.items]
        .reverse()
        .find((i) => i.type === 'agente' || i.type === 'ia');
      const ultimaRespuestaAgente: UltimaRespuestaAgente | null = ultimaAgente
        ? {
            contenido: ultimaAgente.content,
            agenteNombre: ultimaAgente.type === 'ia' ? 'Asistente IA' : 'Agente',
            enviadaEn: ultimaAgente.createdAt,
          }
        : null;

      const structured: ObtenerTicketOutput = {
        ticket: {
          ticketId: ticket.id,
          shortCode: ticket.shortCode,
          asunto: ticket.asunto,
          cuerpo: ticket.cuerpo,
          estado: ticket.estado,
          prioridad: ticket.prioridad,
          areaId: ticket.areaId,
          createdAt: ticket.createdAt,
        },
        ultimaRespuestaAgente,
        historial,
      };

      const lines: string[] = [
        `${structured.ticket.shortCode} — ${structured.ticket.asunto}`,
        `Estado: ${structured.ticket.estado}`,
      ];
      if (ultimaRespuestaAgente) {
        lines.push(
          `\nÚltima respuesta de ${ultimaRespuestaAgente.agenteNombre}:`,
          ultimaRespuestaAgente.contenido,
        );
      } else {
        lines.push('\nTodavía no hay respuesta del agente.');
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: structured,
      };
    } catch (err) {
      return toolError('No pude obtener el ticket', err);
    }
  };
}

export function registerObtenerTicketTool(
  server: McpServer,
  user: AuthenticatedUser,
  tickets: TicketsService,
  interactions: InteractionsService,
): void {
  server.registerTool(
    'obtener_ticket',
    {
      title: 'Obtener detalle de un ticket',
      description:
        'Devuelve el detalle completo de un ticket del usuario: datos, ' +
        'última respuesta del agente (si la hay) e historial reciente de ' +
        'interacciones. Acepta como `ticketId` tanto el ObjectId largo como ' +
        'el código corto tipo "TIK-12" que aparece en `listar_mis_tickets`. ' +
        'Falla si el ticket no existe o no pertenece al usuario.',
      inputSchema: obtenerTicketInputSchema.shape,
      outputSchema: obtenerTicketOutputSchema.shape,
    },
    buildObtenerTicketHandler(user, tickets, interactions),
  );
}
