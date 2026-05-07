import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Interaction as InteractionResponse, InteractionListResponse } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { CreateInteractionDto } from '../dto/create-interaction.dto';
import { ListInteractionsQueryDto } from '../dto/list-interactions.query.dto';
import { InteractionsService } from '../services/interactions.service';

// Las interacciones viven dentro del recurso ticket, por eso comparten el
// path `/tickets/:id/interactions`. El controller usa ese prefix para que
// el contrato HTTP coincida con `tikora-api.md` §7.10.
@Controller('tickets/:ticketId/interactions')
export class InteractionsController {
  constructor(private readonly interactions: InteractionsService) {}

  @Post()
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Body() dto: CreateInteractionDto,
  ): Promise<InteractionResponse> {
    return this.interactions.createForCaller(caller, ticketId, dto);
  }

  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Query() query: ListInteractionsQueryDto,
  ): Promise<InteractionListResponse> {
    return this.interactions.listForTicket(caller, ticketId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
