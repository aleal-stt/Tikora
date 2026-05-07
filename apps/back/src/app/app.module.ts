import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AreasModule } from '../areas/areas.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Env, validateEnv } from '../config/env.schema';
import { CountersModule } from '../counters/counters.module';
import { HealthModule } from '../health/health.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { SeedModule } from '../seed/seed.module';
import { TenantsModule } from '../tenants/tenants.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['apps/back/.env', '.env'],
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          name: 'default',
          ttl: config.get('THROTTLE_DEFAULT_TTL_SECONDS', { infer: true }) * 1000,
          limit: config.get('THROTTLE_DEFAULT_LIMIT', { infer: true }),
        },
      ],
    }),
    TenantsModule,
    UsersModule,
    AreasModule,
    CountersModule,
    TicketsModule,
    InteractionsModule,
    AuthModule,
    HealthModule,
    SeedModule,
  ],
  providers: [
    // Orden importa: Throttler primero corta abuso antes de gastar CPU
    // verificando JWT. JwtAuthGuard luego permite o rechaza según `@Public()`.
    // RolesGuard corre al final y depende de `request.user` que pobló JwtAuthGuard.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
