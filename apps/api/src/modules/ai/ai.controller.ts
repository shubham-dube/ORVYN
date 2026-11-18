import { Controller, Get } from '@nestjs/common';
import { Auth, type AuthContext } from '../auth/auth.decorators';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Whether AI work is running or paused for today (shown next to waiting items). */
  @Get('status')
  status(@Auth() a: AuthContext) {
    return this.ai.status(a.userId);
  }
}
