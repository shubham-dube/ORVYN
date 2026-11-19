import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { ConnectionsService } from './connections.service';

const QUEUE = 'connections';

/** Every 15 minutes, look for new work in GitHub and ClickUp and ping the person (spec 0008 B). */
@Injectable()
export class ConnectionsWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('connections');
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly c: ConnectionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.PROCESS_ROLE === 'api') return;
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue(QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
    });
    this.worker = new Worker(QUEUE, () => this.c.watch(), { connection, concurrency: 1 });
    this.worker.on('failed', (_j, err) => this.log.warn(`watch failed: ${err.message}`));
    await this.queue
      .upsertJobScheduler('connections-watch', { every: 15 * 60_000 }, { name: 'watch', data: {} })
      .catch((e: Error) => this.log.warn(`scheduler: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
