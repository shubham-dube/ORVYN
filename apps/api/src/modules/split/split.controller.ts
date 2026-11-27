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
import { ExpenseInput, NewSplitGroup, SettlementInput, SplitMemberInput } from '@orvyn/contracts';
import { z } from 'zod';
import { notFound, tooMany } from '../../common/errors';
import { RateLimiter } from '../../common/redis.module';
import { Client, type ClientInfo } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, Public, RequireEntitlement } from '../auth/auth.decorators';
import { SplitService } from './split.service';

const id = new ParseUUIDPipe();

/** Split (spec 0011 part B). Every call checks that you are in the group. */
@Controller('split/groups')
@RequireEntitlement('split')
export class SplitController {
  constructor(private readonly split: SplitService) {}

  /** A page of your groups (?cursor=&limit=), with your totals over all of them. */
  @Get()
  list(@Auth() a: AuthContext, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.split.list(a.userId, {
      cursor: cursor?.slice(0, 100),
      limit: Number.isInteger(n) && n > 0 ? n : undefined,
    });
  }

  /** The group, for everyone: who made it only. */
  @Delete(':id')
  remove(@Auth() a: AuthContext, @Param('id', id) gid: string) {
    return this.split.remove(a.userId, gid);
  }

  @Get('people')
  people(@Auth() a: AuthContext) {
    return this.split.people(a.userId);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body(new ZodPipe(NewSplitGroup)) b: NewSplitGroup) {
    return this.split.create(a.userId, b);
  }

  @Get(':id')
  view(@Auth() a: AuthContext, @Param('id', id) gid: string) {
    return this.split.view(a.userId, gid);
  }

  @Put(':id/name')
  rename(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(60) }))) b: { name: string },
  ) {
    return this.split.rename(a.userId, gid, b.name);
  }

  @Put(':id/archived')
  archive(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Body(new ZodPipe(z.object({ archived: z.boolean() }))) b: { archived: boolean },
  ) {
    return this.split.archive(a.userId, gid, b.archived);
  }

  @Post(':id/members')
  addMember(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Body(new ZodPipe(SplitMemberInput)) b: SplitMemberInput,
  ) {
    return this.split.addMember(a.userId, gid, b);
  }

  @Put(':id/members/:memberId')
  editMember(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Param('memberId', id) mid: string,
    @Body(
      new ZodPipe(
        z.object({
          name: z.string().trim().min(1).max(40).optional(),
          phone: z.string().trim().max(20).optional(),
          upi: z.string().trim().max(80).optional(),
        }),
      ),
    )
    b: { name?: string; phone?: string; upi?: string },
  ) {
    return this.split.editMember(a.userId, gid, mid, b);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Auth() a: AuthContext, @Param('id', id) gid: string, @Param('memberId', id) mid: string) {
    return this.split.removeMember(a.userId, gid, mid);
  }

  @Post(':id/expenses')
  addExpense(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Body(new ZodPipe(ExpenseInput)) b: ExpenseInput,
  ) {
    return this.split.addExpense(a.userId, gid, b);
  }

  @Put(':id/expenses/:expenseId')
  editExpense(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Param('expenseId', id) eid: string,
    @Body(new ZodPipe(ExpenseInput)) b: ExpenseInput,
  ) {
    return this.split.editExpense(a.userId, gid, eid, b);
  }

  @Delete(':id/expenses/:expenseId')
  deleteExpense(@Auth() a: AuthContext, @Param('id', id) gid: string, @Param('expenseId', id) eid: string) {
    return this.split.deleteExpense(a.userId, gid, eid);
  }

  @Post(':id/settlements')
  settle(
    @Auth() a: AuthContext,
    @Param('id', id) gid: string,
    @Body(new ZodPipe(SettlementInput)) b: SettlementInput,
  ) {
    return this.split.settle(a.userId, gid, b);
  }

  @Delete(':id/settlements/:settlementId')
  unsettle(@Auth() a: AuthContext, @Param('id', id) gid: string, @Param('settlementId', id) sid: string) {
    return this.split.unsettle(a.userId, gid, sid);
  }

  @Post(':id/members/:memberId/remind')
  @HttpCode(200)
  remind(@Auth() a: AuthContext, @Param('id', id) gid: string, @Param('memberId', id) mid: string) {
    return this.split.remind(a.userId, gid, mid);
  }

  @Post(':id/members/:memberId/link')
  @HttpCode(200)
  link(@Auth() a: AuthContext, @Param('id', id) gid: string, @Param('memberId', id) mid: string) {
    return this.split.createLink(a.userId, gid, mid);
  }

  @Delete(':id/members/:memberId/link')
  unlink(@Auth() a: AuthContext, @Param('id', id) gid: string, @Param('memberId', id) mid: string) {
    return this.split.revokeLinks(a.userId, gid, mid);
  }

  @Get(':id/summary')
  summary(@Auth() a: AuthContext, @Param('id', id) gid: string) {
    return this.split.summary(a.userId, gid);
  }
}

/** A guest's read-only page (ADR-0015). */
@Controller('split-links')
export class SplitLinkController {
  constructor(
    private readonly split: SplitService,
    private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Get(':token')
  async page(@Param('token') token: string, @Client() c: ClientInfo) {
    if (!(await this.limiter.hit(`split-link:${c.ip}`, 60, 600))) throw tooMany();
    const p = await this.split.guestPage(token);
    if (!p) throw notFound('link_gone', 'This link has expired or was turned off.');
    return p;
  }
}
