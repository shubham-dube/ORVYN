import { Body, Controller, Get, HttpCode, Module, Post, Put } from '@nestjs/common';
import {
  FillDraftRequest,
  FillMapRequest,
  FillProfile,
  FillStructureRequest,
  PageReadRequest,
} from '@orvyn/contracts';
import { Seal } from '../../common/seal';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { FillService } from './fill.service';

@Controller('fill')
@RequireEntitlement('fill')
export class FillController {
  constructor(private readonly fill: FillService) {}

  @Get('profile')
  profile(@Auth() a: AuthContext) {
    return this.fill.profile(a.userId);
  }

  @Put('profile')
  save(@Auth() a: AuthContext, @Body(new ZodPipe(FillProfile)) b: FillProfile) {
    return this.fill.save(a.userId, b);
  }

  /** Reads pasted text into facts; nothing is saved here: the person checks them first. */
  @Post('structure')
  @HttpCode(200)
  structure(@Auth() a: AuthContext, @Body(new ZodPipe(FillStructureRequest)) b: { text: string }) {
    return this.fill.structure(a.userId, b.text);
  }

  @Post('map')
  @HttpCode(200)
  map(@Auth() a: AuthContext, @Body(new ZodPipe(FillMapRequest)) b: FillMapRequest) {
    return this.fill.map(a.userId, b);
  }

  @Post('draft')
  @HttpCode(200)
  draft(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(FillDraftRequest)) b: { question: string; page: string; maxChars: number },
  ) {
    return this.fill.draft(a.userId, b);
  }
}

@Controller('page')
@RequireEntitlement('assistant')
export class PageController {
  constructor(private readonly fill: FillService) {}

  @Post('read')
  @HttpCode(200)
  read(@Auth() a: AuthContext, @Body(new ZodPipe(PageReadRequest)) b: PageReadRequest) {
    return this.fill.read(a.userId, b);
  }
}

/** Owns fill_profiles. Also reads a page for the extension's page brain (nothing is stored). */
@Module({ providers: [FillService, Seal], controllers: [FillController, PageController] })
export class FillModule {}
