import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { InteractionsService } from '../../interactions/services/interactions.service';
import { TicketsService } from '../../tickets/services/tickets.service';
import { registerAgregarMensajeATicketTool } from '../tools/agregar-mensaje-a-ticket.tool';
import { registerCrearTicketTool } from '../tools/crear-ticket.tool';
import { registerListarMisTicketsTool } from '../tools/listar-mis-tickets.tool';
import { registerObtenerTicketTool } from '../tools/obtener-ticket.tool';

const SERVER_NAME = 'tikora-mcp';
const SERVER_VERSION = '0.1.0';

/**
 * Fábrica de instancias de `McpServer`. Operamos en modo stateless: cada
 * request HTTP al transport instancia un server propio, con las tools
 * registradas en closure sobre el `AuthenticatedUser` que el guard resolvió.
 * Esto evita compartir estado entre usuarios y simplifica el ciclo de vida
 * del transport (no hay que mantener sesiones del lado del back).
 */
@Injectable()
export class McpServerService {
  constructor(
    private readonly tickets: TicketsService,
    private readonly interactions: InteractionsService,
  ) {}

  buildServerFor(user: AuthenticatedUser): McpServer {
    const server = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    registerCrearTicketTool(server, user, this.tickets);
    registerListarMisTicketsTool(server, user, this.tickets);
    registerObtenerTicketTool(server, user, this.tickets, this.interactions);
    registerAgregarMensajeATicketTool(server, user, this.tickets, this.interactions);
    return server;
  }
}
