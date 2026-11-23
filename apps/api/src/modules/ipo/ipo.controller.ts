import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApplicationUpdate,
  IpoSettings,
  LedgerEntryInput,
  IpoDecisionBody,
  type IpoDecision,
  ManualFigures,
  NewIssue,
  NewRound,
  PartnerAction,
  PartnerFields,
  SourceFields,
} from '@orvyn/contracts';
import { z } from 'zod';
import { notFound, tooMany } from '../../common/errors';
import { RateLimiter } from '../../common/redis.module';
import { Client, type ClientInfo } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, Public, RequireEntitlement } from '../auth/auth.decorators';
import { IpoService } from './ipo.service';
import { PoolService } from './pool.service';

const id = new ParseUUIDPipe();

/** The IPO desk (spec 0010 part A). */
@Controller('ipo')
@RequireEntitlement('ipo')
export class IpoController {
  constructor(
    private readonly ipo: IpoService,
    private readonly pool: PoolService,
  ) {}

  @Get('issues')
  list(@Auth() a: AuthContext, @Query('when') when?: string, @Query('type') type?: string) {
    return this.ipo.list(
      a.userId,
      when === 'closed' || when === 'listed' ? when : 'current',
      type === 'mainboard' || type === 'sme' || type === 'all' ? type : undefined,
    );
  }

  /** I'll apply · Skip · Applied · Allotted · Not allotted (spec 0016 A5); null takes it back. */
  @Put('issues/:id/decision')
  decide(
    @Auth() a: AuthContext,
    @Param('id', id) issueId: string,
    @Body(new ZodPipe(IpoDecisionBody)) b: { decision: IpoDecision | null },
  ) {
    return this.ipo.decide(a.userId, issueId, b.decision);
  }

  @Get('issues/:id')
  detail(@Auth() a: AuthContext, @Param('id', id) issueId: string) {
    return this.ipo.detail(a.userId, issueId);
  }

  @Post('issues')
  add(@Body(new ZodPipe(NewIssue)) b: NewIssue) {
    return this.ipo.addIssue(b);
  }

  @Put('issues/:id/figures')
  figures(@Param('id', id) issueId: string, @Body(new ZodPipe(ManualFigures)) b: ManualFigures) {
    return this.ipo.setFigures(issueId, b);
  }

  @Delete('issues/:id/figures')
  async clear(@Param('id', id) issueId: string) {
    await this.ipo.clearFigures(issueId);
    return { ok: true };
  }

  @Put('issues/:id/star')
  async star(
    @Auth() a: AuthContext,
    @Param('id', id) issueId: string,
    @Body(new ZodPipe(z.object({ on: z.boolean() }))) b: { on: boolean },
  ) {
    await this.ipo.star(a.userId, issueId, b.on);
    return { ok: true };
  }

  @Get('open')
  open(@Auth() a: AuthContext) {
    return this.ipo.open(a.userId);
  }

  @Get('settings')
  settings(@Auth() a: AuthContext) {
    return this.ipo.settings(a.userId);
  }

  @Put('settings')
  save(@Auth() a: AuthContext, @Body(new ZodPipe(IpoSettings)) b: IpoSettings) {
    return this.ipo.saveSettings(a.userId, b);
  }

  // ------------------------------------------------------------------ the Pool (part B)

  @Get('pool/summary')
  summary(@Auth() a: AuthContext) {
    return this.pool.summary(a.userId);
  }

  @Get('pool/partners')
  partners(@Auth() a: AuthContext) {
    return this.pool.partners(a.userId);
  }

  @Post('pool/partners')
  addPartner(@Auth() a: AuthContext, @Body(new ZodPipe(PartnerFields)) b: PartnerFields) {
    return this.pool.savePartner(a.userId, null, b);
  }

  @Put('pool/partners/:id')
  editPartner(
    @Auth() a: AuthContext,
    @Param('id', id) pid: string,
    @Body(new ZodPipe(PartnerFields)) b: PartnerFields,
  ) {
    return this.pool.savePartner(a.userId, pid, b);
  }

  @Post('pool/partners/:id/link')
  @HttpCode(200)
  link(@Auth() a: AuthContext, @Param('id', id) pid: string) {
    return this.pool.createLink(a.userId, pid);
  }

  @Delete('pool/partners/:id/link')
  async unlink(@Auth() a: AuthContext, @Param('id', id) pid: string) {
    await this.pool.revokeLinks(a.userId, pid);
    return { ok: true };
  }

  @Get('pool/sources')
  sources(@Auth() a: AuthContext) {
    return this.pool.sources(a.userId);
  }

  @Post('pool/sources')
  addSource(@Auth() a: AuthContext, @Body(new ZodPipe(SourceFields)) b: SourceFields) {
    return this.pool.saveSource(a.userId, null, b);
  }

  @Put('pool/sources/:id')
  editSource(
    @Auth() a: AuthContext,
    @Param('id', id) sid: string,
    @Body(new ZodPipe(SourceFields)) b: SourceFields,
  ) {
    return this.pool.saveSource(a.userId, sid, b);
  }

  @Get('pool/ledger')
  ledger(
    @Auth() a: AuthContext,
    @Query('partnerId') partnerId?: string,
    @Query('sourceId') sourceId?: string,
    @Query('roundId') roundId?: string,
  ) {
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    return this.pool.ledger(a.userId, {
      partnerId: uuid(partnerId),
      sourceId: uuid(sourceId),
      roundId: uuid(roundId),
    });
  }

  @Post('pool/ledger')
  record(@Auth() a: AuthContext, @Body(new ZodPipe(LedgerEntryInput)) b: LedgerEntryInput) {
    return this.pool.record(a.userId, b);
  }

  @Delete('pool/ledger/:id')
  async unrecord(@Auth() a: AuthContext, @Param('id', id) eid: string) {
    if (!(await this.pool.unrecord(a.userId, eid))) throw notFound();
    return { ok: true };
  }

  @Get('pool/rounds')
  rounds(@Auth() a: AuthContext) {
    return this.pool.rounds(a.userId);
  }

  @Post('pool/rounds')
  createRound(@Auth() a: AuthContext, @Body(new ZodPipe(NewRound)) b: NewRound) {
    return this.pool.createRound(a.userId, b);
  }

  @Get('pool/rounds/:id')
  round(@Auth() a: AuthContext, @Param('id', id) rid: string) {
    return this.pool.roundView(a.userId, rid);
  }

  @Put('pool/applications/:id')
  update(
    @Auth() a: AuthContext,
    @Param('id', id) aid: string,
    @Body(new ZodPipe(ApplicationUpdate)) b: ApplicationUpdate,
  ) {
    return this.pool.updateApplication(a.userId, aid, b);
  }

  @Post('pool/applications/:id/settle')
  @HttpCode(200)
  settle(
    @Auth() a: AuthContext,
    @Param('id', id) aid: string,
    @Body(
      new ZodPipe(
        z.object({
          returned: z.number().min(0).max(100_000_000).default(0),
          method: z.string().max(30).default('UPI'),
          sourceId: z.string().uuid().nullable().default(null),
        }),
      ),
    )
    b: { returned: number; method: string; sourceId: string | null },
  ) {
    return this.pool.settle(a.userId, aid, b);
  }
}

/** A partner's private page (ADR-0013): no account, one partner's own items, rate-limited. */
@Controller('pool-links')
export class PartnerLinkController {
  constructor(
    private readonly pool: PoolService,
    private readonly limiter: RateLimiter,
  ) {}

  private async guard(c: ClientInfo) {
    if (!(await this.limiter.hit(`pool-link:${c.ip}`, 60, 600))) throw tooMany();
  }

  @Public()
  @Get(':token')
  async page(@Param('token') token: string, @Client() c: ClientInfo) {
    await this.guard(c);
    const p = await this.pool.partnerPage(token);
    if (!p) throw notFound('link_gone', 'This link has expired or was turned off. Ask for a new one.');
    return p;
  }

  @Public()
  @Post(':token/applications/:id')
  @HttpCode(200)
  async act(
    @Param('token') token: string,
    @Param('id', id) aid: string,
    @Body(new ZodPipe(PartnerAction)) b: PartnerAction,
    @Client() c: ClientInfo,
  ) {
    await this.guard(c);
    const p = await this.pool.partnerAct(token, aid, b);
    if (!p) throw notFound('link_gone', 'This link has expired or was turned off. Ask for a new one.');
    return p;
  }
}
