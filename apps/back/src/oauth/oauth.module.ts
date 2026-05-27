import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { OauthConsentController } from './controllers/oauth-consent.controller';
import { OAuthAccessToken, OAuthAccessTokenSchema } from './schemas/oauth-access-token.schema';
import { OAuthAuthCode, OAuthAuthCodeSchema } from './schemas/oauth-auth-code.schema';
import { OAuthClient, OAuthClientSchema } from './schemas/oauth-client.schema';
import { OAuthRefreshToken, OAuthRefreshTokenSchema } from './schemas/oauth-refresh-token.schema';
import { OAuthClientsService } from './services/oauth-clients.service';
import { TikoraOAuthProvider } from './services/tikora-oauth-provider.service';

/**
 * Módulo OAuth: implementa el flow Authorization Code + PKCE + DCR del
 * MCP spec (Anthropic claude.ai). Los handlers `/authorize`, `/token`,
 * `/register`, `/revoke` y los `/.well-known/*` los monta `mcpAuthRouter`
 * del SDK directamente como middleware Express en `main.ts` —
 * este módulo solo expone:
 *
 *  - Los services consumidos por ese router (`TikoraOAuthProvider`,
 *    `OAuthClientsService`).
 *  - La pantalla de consent (`OauthConsentController`, ruta
 *    `/oauth/consent`, fuera del global prefix).
 *
 * Reusa `UsersModule` y `TenantsModule` para validar credenciales en la
 * pantalla de consent sin acoplarnos al `AuthService` (que tiene side
 * effects de emitir JWTs propios y manejar refresh cookies).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OAuthClient.name, schema: OAuthClientSchema },
      { name: OAuthAuthCode.name, schema: OAuthAuthCodeSchema },
      { name: OAuthAccessToken.name, schema: OAuthAccessTokenSchema },
      { name: OAuthRefreshToken.name, schema: OAuthRefreshTokenSchema },
    ]),
    UsersModule,
    TenantsModule,
  ],
  controllers: [OauthConsentController],
  providers: [OAuthClientsService, TikoraOAuthProvider],
  exports: [TikoraOAuthProvider, OAuthClientsService],
})
export class OAuthModule {}
