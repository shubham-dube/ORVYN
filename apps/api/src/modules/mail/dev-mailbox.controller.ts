import { Controller, Get, Query } from '@nestjs/common';
import { notFound } from '../../common/errors';
import { Public } from '../auth/auth.decorators';
import { MailService } from './mail.service';

/** Lets local development and e2e tests read sign-in codes. Never registered in production. */
@Controller('dev/mailbox')
export class DevMailboxController {
  constructor(private readonly mail: MailService) {}

  @Public()
  @Get()
  latest(@Query('email') email: string) {
    const m = this.mail.latestTo(String(email ?? '').toLowerCase());
    if (!m) throw notFound('no_mail', 'No mail for that address');
    return { subject: m.subject, text: m.text, at: m.at.toISOString() };
  }
}
