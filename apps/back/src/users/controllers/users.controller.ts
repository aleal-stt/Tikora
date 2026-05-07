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
import type { User as UserResponse, UserListResponse } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { ListUsersQueryDto } from '../dto/list-users.query.dto';
import { UpdateMeDto } from '../dto/update-me.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UsersService } from '../services/users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // -------- endpoints `/me` van antes que `/:id` para evitar el match --------

  @Get('me')
  async me(@CurrentUser() caller: AuthenticatedUser): Promise<UserResponse> {
    return this.users.getByIdForCaller(caller, caller.userId);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResponse> {
    return this.users.updateProfile(caller, dto.fullName);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('me/password')
  async changePassword(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.updatePassword(caller, dto.currentPassword, dto.newPassword);
  }

  // -------- endpoints administrativos --------

  @Roles('lider', 'admin')
  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<UserListResponse> {
    return this.users.listForCaller(caller, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Roles('lider', 'admin')
  @Get(':id')
  async getById(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserResponse> {
    return this.users.getByIdForCaller(caller, id);
  }

  @Roles('lider', 'admin')
  @Post()
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponse> {
    return this.users.createForCaller(caller, dto);
  }

  @Roles('lider', 'admin')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.users.updateForCaller(caller, id, dto);
  }

  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async softDelete(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.users.softDeleteForCaller(caller, id);
  }
}
