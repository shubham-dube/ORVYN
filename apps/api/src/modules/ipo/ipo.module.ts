import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { IpoFeed, IpoGuruFeed, NoFeed } from './feed';
import { IpoController, PartnerLinkController } from './ipo.controller';
import { IpoService } from './ipo.service';
import { PoolService } from './pool.service';

/** The IPO desk and the IPO Pool (spec 0010). Owns every ipo_* table. */
@Module({
  providers: [
    IpoService,
    PoolService,
    {
      provide: IpoFeed,
      inject: [ENV],
      useFactory: (env: Env) => (env.IPO_FEED === 'ipoguru' ? new IpoGuruFeed(env) : new NoFeed()),
    },
  ],
  controllers: [IpoController, PartnerLinkController],
  exports: [IpoService],
})
export class IpoModule {}
