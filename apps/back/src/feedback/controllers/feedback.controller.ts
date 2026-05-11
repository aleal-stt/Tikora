import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ClassificationFeedback as ClassificationFeedbackDto } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { CreateClassificationFeedbackDto } from '../dto/create-classification-feedback.dto';
import { FeedbackService } from '../services/feedback.service';

/**
 * `tikora-api.md` §14. Endpoints de feedback de clasificación. POST hace
 * upsert (idempotente sobre el par tenant/ticket).
 */
@ApiTags('Feedback')
@ApiBearerAuth('bearer')
@Controller('tickets/:ticketId/classification-feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Roles('agente', 'lider', 'admin')
  @HttpCode(HttpStatus.OK)
  @Post()
  async upsert(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Body() dto: CreateClassificationFeedbackDto,
  ): Promise<ClassificationFeedbackDto> {
    return this.feedback.upsertForTicket(caller, ticketId, dto);
  }

  @Roles('agente', 'lider', 'admin')
  @Get()
  async get(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
  ): Promise<ClassificationFeedbackDto> {
    const fb = await this.feedback.getForTicket(caller, ticketId);
    if (!fb) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        code: 'FEEDBACK_NOT_FOUND',
        message: 'Este ticket no tiene feedback de clasificación todavía.',
        details: [],
      });
    }
    return fb;
  }
}
