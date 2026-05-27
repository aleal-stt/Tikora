import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InteractionsModule } from '../interactions/interactions.module';
import { OAuthModule } from '../oauth/oauth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { McpController } from './controllers/mcp.controller';
import { MeMcpKeysController } from './controllers/me-mcp-keys.controller';
import { McpApiKey, McpApiKeySchema } from './schemas/mcp-key.schema';
import { McpAuthService } from './services/mcp-auth.service';
import { McpKeyService } from './services/mcp-key.service';
import { McpServerService } from './services/mcp-server.service';

/**
 * Módulo MCP: expone `POST /mcp` (controller) con auth por API key o
 * por access token OAuth (claude.ai). Reusa TicketsService e
 * InteractionsService de los módulos existentes — las tools delegan a
 * esos services para entrar al mismo pipeline IA y a las mismas reglas
 * de permisos que la UI.
 *
 * UsersModule exporta `MongooseModule` con el modelo `User`, que
 * McpAuthService y el path OAuth del guard usan para validar que el
 * usuario detrás del token sigue activo.
 *
 * OAuthModule provee `TikoraOAuthProvider` que el guard consume para
 * resolver tokens emitidos vía el flow OAuth.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: McpApiKey.name, schema: McpApiKeySchema }]),
    TicketsModule,
    InteractionsModule,
    UsersModule,
    OAuthModule,
  ],
  controllers: [McpController, MeMcpKeysController],
  providers: [McpKeyService, McpAuthService, McpServerService],
  exports: [McpKeyService],
})
export class McpModule {}
