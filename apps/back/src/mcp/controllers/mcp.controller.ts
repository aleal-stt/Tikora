import { All, Controller, HttpStatus, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { Env } from '../../config/env.schema';
import { McpAuthGuard } from '../guards/mcp-auth.guard';
import { McpServerService } from '../services/mcp-server.service';

/**
 * Endpoint MCP. Stateless: por cada request creamos un par `transport`
 * + `server`, los conectamos, atendemos la request y los cerramos al
 * terminar la respuesta. La auth la resuelve `McpAuthGuard` mediante
 * la API key del header — `@Public()` evita que el `JwtAuthGuard`
 * global le pegue antes (las API keys MCP no son JWT).
 */
@Controller('mcp')
@Public()
@UseGuards(McpAuthGuard)
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpServerFactory: McpServerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @All()
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (!this.config.get('MCP_ENABLED', { infer: true })) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'MCP_DISABLED',
        'El servidor MCP está deshabilitado en esta instancia.',
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = this.mcpServerFactory.buildServerFor(user);

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(
        `Error procesando request MCP userId=${user.userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'MCP_INTERNAL_ERROR',
          message: 'Error interno procesando la request MCP.',
          details: [],
        });
      }
    }
  }
}
