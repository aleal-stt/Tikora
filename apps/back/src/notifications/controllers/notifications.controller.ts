import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  Notification as NotificationResponse,
  NotificationListResponse,
  UnreadCountResponse,
} from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto';
import { NotificationsService } from '../services/notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponse> {
    return this.notifications.listForCaller(caller, {
      cursor: query.cursor,
      limit: query.limit,
      read: query.read,
      type: query.type,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() caller: AuthenticatedUser): Promise<UnreadCountResponse> {
    return { count: await this.notifications.unreadCount(caller) };
  }

  // `/read-all` antes de `/:id/read` para que matchee correctamente.
  @HttpCode(HttpStatus.OK)
  @Patch('read-all')
  async markAllRead(@CurrentUser() caller: AuthenticatedUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(caller);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/read')
  async markRead(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(caller, id);
  }
}
