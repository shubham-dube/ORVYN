import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GoogleVerifier } from './google.service';
import { LinkService } from './link.service';
import { PasskeysService } from './passkeys.service';
import { TokensService } from './tokens.service';

@Global()
@Module({
  providers: [
    TokensService,
    AuthService,
    PasskeysService,
    LinkService,
    GoogleVerifier,
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  controllers: [AuthController],
  exports: [AuthGuard, AuthService, TokensService],
})
export class AuthModule {}
