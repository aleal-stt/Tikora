import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(@InjectConnection() private readonly mongo: Connection) {}

  @Get()
  async check() {
    const mongoOk = this.mongo.readyState === 1;
    return {
      status: mongoOk ? 'ok' : 'degraded',
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      checks: {
        mongo: mongoOk ? 'ok' : 'down',
      },
    };
  }
}
