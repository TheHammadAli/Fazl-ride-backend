import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SafetyService } from './safety.service.js';

const TICK_MS = 30_000;
const DEFAULT_REALERT_SECONDS = 120;

// An SOS nobody took within SAFETY_REALERT_SECONDS (2 min) rings the safety
// team's phones once more. SAFETY_SWEEPER=off turns it off (tests).
@Injectable()
export class SafetySweeperService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SafetySweeperService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly enabled: boolean;
  readonly realertSeconds: number;

  constructor(
    private readonly safety: SafetyService,
    config: ConfigService,
  ) {
    this.enabled = config.get('SAFETY_SWEEPER') !== 'off';
    const seconds = Number(config.get('SAFETY_REALERT_SECONDS'));
    this.realertSeconds =
      Number.isFinite(seconds) && seconds > 0
        ? seconds
        : DEFAULT_REALERT_SECONDS;
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.safety.realertWaiting(this.realertSeconds);
      if (sent) this.logger.warn(`Re-alerted the safety team for ${sent} SOS`);
    } catch (error) {
      this.logger.warn(`SOS re-alert failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
