import { ArgumentsHost, Catch, HttpException, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { type Env } from '../config/env';

/** Where unexpected errors go. Tests swap in a recorder. */
export interface ErrorReporter {
  capture(error: unknown, context: { method?: string; route?: string }): void;
}

export const noReporter: ErrorReporter = { capture: () => undefined };

/**
 * GlitchTip (Sentry protocol) for unexpected server errors only. Nothing personal leaves the server: no request
 * bodies, headers, cookies, query strings, user identity or breadcrumbs — just the error, its stack and the route
 * template. Vault data is ciphertext anyway (ADR-0004); this keeps everything else out too.
 */
export function initErrorReporting(env: Env): ErrorReporter {
  if (!env.SENTRY_DSN) return noReporter;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend: scrubEvent,
  });
  return {
    capture: (error, ctx) =>
      Sentry.withScope((scope) => {
        if (ctx.route) scope.setTag('route', `${ctx.method ?? ''} ${ctx.route}`.trim());
        Sentry.captureException(error);
      }),
  };
}

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  if (event.contexts) delete event.contexts.trace;
  return event;
}

/** Reports 5xx and non-HTTP errors, then lets Nest answer as usual. Expected 4xx are never reported. */
@Catch()
export class ReportingFilter extends BaseExceptionFilter {
  constructor(
    adapter: HttpServer,
    private readonly reporter: ErrorReporter,
  ) {
    super(adapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500 && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<{ method?: string; routeOptions?: { url?: string } }>();
      this.reporter.capture(exception, { method: req.method, route: req.routeOptions?.url });
    }
    super.catch(exception, host);
  }
}
