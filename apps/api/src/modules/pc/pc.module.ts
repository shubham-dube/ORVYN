import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { PcDone, PcSuggestion, PcWant } from '@orvyn/contracts';
import { ZodPipe } from '../../common/zod.pipe';
import { AiService } from '../ai/ai.service';
import { plainAi } from '../ai/plain';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { NotifyService } from '../notify/notify.service';

/**
 * Around the terminal (spec 0021 #12, #13). Nothing here can reach a terminal: a suggestion is only text, and what ran
 * or what it printed never comes to the server (ADR-0019).
 */
@Controller('pc')
@RequireEntitlement('pc')
export class PcController {
  constructor(
    private readonly ai: AiService,
    private readonly notify: NotifyService,
  ) {}

  @Post('done')
  @HttpCode(200)
  async done(@Auth() a: AuthContext, @Body(new ZodPipe(PcDone)) b: PcDone): Promise<{ ok: true }> {
    await this.notify.send({
      userId: a.userId,
      module: 'pc',
      kind: 'done',
      type: 'pc.done',
      title: `Finished on ${b.pc}`,
      body: 'What you were waiting for in the terminal has ended.',
      url: '/pc',
      dedupeKey: `pc:done:${b.id}`,
      ref: `pc:${a.deviceId}`,
      actions: [],
      priority: 'normal',
    });
    return { ok: true };
  }

  @Post('suggest')
  @HttpCode(200)
  suggest(@Auth() a: AuthContext, @Body(new ZodPipe(PcWant)) b: PcWant): Promise<PcSuggestion> {
    return plainAi(() =>
      this.ai.complete({
        ownerId: a.userId,
        task: 'pc.suggest',
        system: `Turn a wish into one command line for ${b.shell} on Windows. Answer {"command","why","careful"}. command is a
single line, ready to run as a normal user, with no placeholders when it can be avoided. why says in at most 20 plain
words what it does. careful is true when it deletes, overwrites, installs, stops, uploads, downloads and runs, or changes
settings. If no command does it, leave command empty and say why.`,
        data: [{ type: 'text', text: b.want }],
        schema: PcSuggestion,
        maxTokens: 500,
        cache: false,
      }),
    );
  }
}

@Module({ controllers: [PcController] })
export class PcModule {}
