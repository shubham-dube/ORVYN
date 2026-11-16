import { HttpException, HttpStatus } from '@nestjs/common';

/** Errors carry a stable machine code for clients plus a human message. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ error: { code, message } }, status);
  }
}

export const badRequest = (code: string, message: string) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message);
export const unauthorized = (code = 'unauthorized', message = 'Please sign in again.') =>
  new AppError(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (code = 'forbidden', message = 'You do not have access to this.') =>
  new AppError(HttpStatus.FORBIDDEN, code, message);
export const notFound = (code = 'not_found', message = 'Not found.') =>
  new AppError(HttpStatus.NOT_FOUND, code, message);
export const tooMany = (message = 'Too many attempts. Please wait a few minutes.') =>
  new AppError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', message);
