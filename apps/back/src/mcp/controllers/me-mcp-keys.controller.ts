import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CreateMcpKeyResponse, McpKeyListResponse } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { CreateMcpKeyDto } from '../dto/create-mcp-key.dto';
import { McpKeyService } from '../services/mcp-key.service';

/**
 * Gestión de keys MCP del usuario autenticado. Autenticado con JWT (no
 * con la propia key MCP — eso sería bootstrap circular). Cualquier rol
 * puede tener sus propias keys.
 */
@ApiTags('MCP Keys')
@ApiBearerAuth('bearer')
@Controller('me/mcp-keys')
export class MeMcpKeysController {
  constructor(private readonly keys: McpKeyService) {}

  @Get()
  async list(@CurrentUser() caller: AuthenticatedUser): Promise<McpKeyListResponse> {
    const items = await this.keys.listForUser(caller);
    return { items };
  }

  /**
   * Genera una key nueva. El `secret` viaja UNA SOLA VEZ en esta respuesta.
   * El cliente debe mostrarlo al usuario y advertirle que se guarde — en
   * consultas posteriores solo está disponible el `prefix` para identificarla.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateMcpKeyDto,
  ): Promise<CreateMcpKeyResponse> {
    return this.keys.generate(caller, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentUser() caller: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.keys.revoke(caller, id);
  }
}
