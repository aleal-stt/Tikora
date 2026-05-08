import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  KbDocument as KbDocumentResponse,
  KbDocumentListItem,
  KbDocumentListResponse,
} from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { CreateKbDocumentDto } from '../dto/create-kb-document.dto';
import { ListKbDocumentsQueryDto } from '../dto/list-kb-documents.query.dto';
import { UpdateKbDocumentDto } from '../dto/update-kb-document.dto';
import { KbService } from '../services/kb.service';

/**
 * Endpoints de la base de conocimiento. Path base: `/kb-documents`.
 *
 * Todos los endpoints requieren rol `lider` o `admin`. La fineza adicional
 * (LID solo ve/edita áreas que lidera, ADM ve todo, scope global solo
 * ADM, rollback solo ADM) la maneja `KbService` — el `@Roles` actúa de
 * primer filtro pero no es la única defensa.
 *
 * Match con `tikora-api.md` §9.
 */
@Roles('lider', 'admin')
@Controller('kb-documents')
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListKbDocumentsQueryDto,
  ): Promise<KbDocumentListResponse> {
    return this.kb.listForCaller(caller, {
      cursor: query.cursor,
      limit: query.limit,
      scope: query.scope,
      areaId: query.areaId,
    });
  }

  @Get(':id')
  async getById(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<KbDocumentResponse> {
    return this.kb.getByIdForCaller(caller, id);
  }

  @Post()
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateKbDocumentDto,
  ): Promise<KbDocumentResponse> {
    return this.kb.create(caller, dto);
  }

  @Put(':id')
  async update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateKbDocumentDto,
  ): Promise<KbDocumentResponse> {
    return this.kb.update(caller, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async softDelete(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.kb.softDelete(caller, id);
  }

  @Get(':id/versions')
  async listVersions(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ items: KbDocumentListItem[] }> {
    const items = await this.kb.listVersionsForCaller(caller, id);
    return { items };
  }

  @Roles('admin')
  @Post(':id/versions/:n/activate')
  async activateVersion(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Param('n', ParseIntPipe) version: number,
  ): Promise<KbDocumentResponse> {
    return this.kb.activateVersion(caller, id, version);
  }
}
