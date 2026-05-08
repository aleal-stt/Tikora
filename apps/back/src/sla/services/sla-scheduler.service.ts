import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { SlaCheckerService } from './sla-checker.service';

const SLA_INTERVAL_NAME = 'sla-checker';

/**
 * Wrapper que arranca el cron de SLA al booteo y delega el trabajo a
 * `SlaCheckerService.tick`. Lo separamos del checker para mantener la
 * lógica pura y testeable sin involucrar `setInterval`.
 *
 * Si el tick anterior todavía está corriendo cuando llega el siguiente,
 * dropeamos ese (flag `running`) — preferible saltar un tick que
 * acumular ticks paralelos compitiendo por la DB.
 */
@Injectable()
export class SlaSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SlaSchedulerService.name);
  private running = false;

  constructor(
    private readonly checker: SlaCheckerService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = this.config.get('SLA_CRON_INTERVAL_MS', { infer: true });
    const handle = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.registry.addInterval(SLA_INTERVAL_NAME, handle);
    this.logger.log(`Cron SLA registrado cada ${intervalMs} ms.`);
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', SLA_INTERVAL_NAME)) {
      this.registry.deleteInterval(SLA_INTERVAL_NAME);
    }
  }

  /**
   * Pública para que un endpoint admin (futuro) o tests integrados
   * puedan disparar un tick manual sin esperar al intervalo.
   */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.debug('Tick previo aún corriendo, salto este intervalo.');
      return;
    }
    this.running = true;
    try {
      await this.checker.tick();
    } catch (err) {
      this.logger.error(`Tick SLA falló: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
