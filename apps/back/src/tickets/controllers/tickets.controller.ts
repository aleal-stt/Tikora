import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Ticket as TicketResponse, TicketListResponse } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { AssignAgentDto } from '../dto/assign-agent.dto';
import { AssignAreaDto } from '../dto/assign-area.dto';
import { CancelTicketDto } from '../dto/cancel-ticket.dto';
import { ClassifyTicketDto } from '../dto/classify-ticket.dto';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { ListTicketsQueryDto } from '../dto/list-tickets.query.dto';
import { ReopenTicketDto } from '../dto/reopen-ticket.dto';
import { ResolveTicketDto } from '../dto/resolve-ticket.dto';
import { TicketsService } from '../services/tickets.service';

@ApiTags('Tickets')
@ApiBearerAuth('bearer')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // -------- alta y consultas --------

  @Post()
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateTicketDto,
  ): Promise<TicketResponse> {
    return this.tickets.create(caller, dto);
  }

  // `/me` antes de `/:id` para que matchee la ruta correcta.
  @Get('me')
  async listMine(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListTicketsQueryDto,
  ): Promise<TicketListResponse> {
    return this.tickets.listMine(caller, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Roles('agente', 'lider', 'admin')
  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListTicketsQueryDto,
  ): Promise<TicketListResponse> {
    return this.tickets.listForCaller(caller, {
      cursor: query.cursor,
      limit: query.limit,
      estado: query.estado,
      prioridad: query.prioridad,
      areaId: query.areaId,
      assignedToMe: query.assignedToMe,
      requesterId: query.requesterId,
    });
  }

  @Get(':id')
  async getById(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TicketResponse> {
    return this.tickets.getByIdForCaller(caller, id);
  }

  // -------- transiciones --------

  @Roles('agente', 'lider', 'admin')
  @HttpCode(HttpStatus.OK)
  @Patch(':id/take')
  async take(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TicketResponse> {
    return this.tickets.take(caller, id);
  }

  @Roles('agente', 'lider', 'admin')
  @Patch(':id/resolve')
  async resolve(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveTicketDto,
  ): Promise<TicketResponse> {
    return this.tickets.resolve(caller, id, dto);
  }

  @Patch(':id/cancel')
  async cancel(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelTicketDto,
  ): Promise<TicketResponse> {
    return this.tickets.cancel(caller, id, dto);
  }

  @Patch(':id/reopen')
  async reopen(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReopenTicketDto,
  ): Promise<TicketResponse> {
    return this.tickets.reopen(caller, id, dto);
  }

  @Roles('agente', 'lider', 'admin')
  @Patch(':id/assign-agent')
  async assignAgent(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignAgentDto,
  ): Promise<TicketResponse> {
    return this.tickets.assignAgent(caller, id, dto);
  }

  @Roles('lider', 'admin')
  @Patch(':id/assign-area')
  async assignArea(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignAreaDto,
  ): Promise<TicketResponse> {
    return this.tickets.assignArea(caller, id, dto);
  }

  @Roles('lider', 'admin')
  @Patch(':id/classification')
  async classify(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ClassifyTicketDto,
  ): Promise<TicketResponse> {
    return this.tickets.classify(caller, id, dto);
  }
}
