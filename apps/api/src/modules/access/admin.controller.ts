import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CreateInviteRequest, SetDisabledRequest, SetEntitlementsRequest } from '@orvyn/contracts';
import { Client, type ClientInfo } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { Auth, type AuthContext, OwnerOnly } from '../auth/auth.decorators';
import { AccessService } from './access.service';

/** The owner's admin console API: people, their features, invites, audit log. */
@OwnerOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  users() {
    return this.access.listUsers();
  }

  @Put('users/:id/entitlements')
  async setEntitlements(
    @Auth() a: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(SetEntitlementsRequest)) body: { entitlements: string[] },
    @Client() client: ClientInfo,
  ) {
    return { entitlements: await this.access.setEntitlements(a.userId, id, body.entitlements, client) };
  }

  @Put('users/:id/disabled')
  async setDisabled(
    @Auth() a: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(SetDisabledRequest)) body: { disabled: boolean },
    @Client() client: ClientInfo,
  ) {
    await this.access.setDisabled(a.userId, id, body.disabled, client);
    return { ok: true };
  }

  @Get('invites')
  invites() {
    return this.access.listInvites();
  }

  @Post('invites')
  createInvite(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(CreateInviteRequest)) body: CreateInviteRequest,
    @Client() client: ClientInfo,
  ) {
    return this.access.createInvite(a.userId, body, client);
  }

  @Delete('invites/:id')
  async revokeInvite(@Auth() a: AuthContext, @Param('id') id: string, @Client() client: ClientInfo) {
    await this.access.revokeInvite(a.userId, id, client);
    return { ok: true };
  }

  @Get('audit')
  auditLog(@Query('limit') limit?: string) {
    return this.audit.recent(Math.min(Number(limit) || 200, 1000));
  }
}
