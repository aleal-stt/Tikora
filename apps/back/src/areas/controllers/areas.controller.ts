import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  Area as AreaResponse,
  AreaListResponseFull,
  AreaListResponsePublic,
  User as UserResponse,
} from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { AreaMemberRefDto } from '../dto/area-member-ref.dto';
import { CreateAreaDto } from '../dto/create-area.dto';
import { ListAreasQueryDto } from '../dto/list-areas.query.dto';
import { UpdateAreaDto } from '../dto/update-area.dto';
import { UpdateSlasDto } from '../dto/update-slas.dto';
import { AreasService } from '../services/areas.service';

@Controller('areas')
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  // -------- listado / detalle --------

  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListAreasQueryDto,
  ): Promise<AreaListResponseFull | AreaListResponsePublic> {
    return this.areas.listForCaller(caller, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Roles('lider', 'admin')
  @Get(':id')
  async getById(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AreaResponse> {
    return this.areas.getByIdForCaller(caller, id);
  }

  // -------- mutaciones del área --------

  @Roles('admin')
  @Post()
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateAreaDto,
  ): Promise<AreaResponse> {
    return this.areas.create(caller, dto);
  }

  @Roles('admin')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAreaDto,
  ): Promise<AreaResponse> {
    return this.areas.update(caller, id, dto);
  }

  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async softDelete(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.areas.softDelete(caller, id);
  }

  // -------- miembros --------

  @Roles('lider', 'admin')
  @Get(':id/agents')
  async listAgents(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserResponse[]> {
    return this.areas.listAgents(caller, id);
  }

  @Roles('lider', 'admin')
  @Post(':id/agents')
  async addAgent(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AreaMemberRefDto,
  ): Promise<AreaResponse> {
    return this.areas.addAgent(caller, id, dto.userId);
  }

  @Roles('lider', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/agents/:userId')
  async removeAgent(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.areas.removeAgent(caller, id, userId);
  }

  @Roles('admin')
  @Post(':id/leaders')
  async addLeader(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AreaMemberRefDto,
  ): Promise<AreaResponse> {
    return this.areas.addLeader(caller, id, dto.userId);
  }

  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/leaders/:userId')
  async removeLeader(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.areas.removeLeader(caller, id, userId);
  }

  // -------- SLAs --------

  @Roles('lider', 'admin')
  @Patch(':id/slas')
  async updateSlas(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSlasDto,
  ): Promise<AreaResponse> {
    return this.areas.updateSlas(caller, id, dto.slas);
  }

  // `GET /areas/:id/metrics` lo sirve `MetricsController` (en su propio
  // módulo) para evitar el ciclo `AreasModule ↔ MetricsModule`.
}
