import { Controller, Get, Query } from '@nestjs/common';
import { notFound } from '../../common/errors';
import { Public } from '../auth/auth.decorators';
import { MailService } from './mail.service';

const CODE = /\b\d{6}\b/;

/** Lets local development and e2e tests read sign-in codes. Never registered in production. */
@Controller('dev/mailbox')
export class DevMailboxController {
  constructor(private readonly mail: MailService) {}

  @Public()
  @Get()
  latest(@Query('email') email: string, @Query('any') any?: string) {
    // the newest sign-in code by default (a "new sign-in" email may have landed after it); ?any=1 for any mail
    const m = this.mail.latestTo(String(email ?? '').toLowerCase(), any === '1' ? undefined : CODE);
    if (!m) throw notFound('no_mail', 'No mail for that address');
    return { subject: m.subject, text: m.text, at: m.at.toISOString() };
  }
}
