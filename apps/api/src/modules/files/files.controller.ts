import { Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { badRequest } from '../../common/errors';
import { Auth, type AuthContext, OwnerOnly } from '../auth/auth.decorators';
import { FilesService, INLINE_MIME } from './files.service';

/**
 * Upload: the raw bytes as the body, the content type as usual, the name in `x-file-name` (URI-encoded).
 * Download: decrypted on the fly for its owner only, never cached by shared caches, never rendered as active content.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  async upload(
    @Auth() a: AuthContext,
    @Req() req: FastifyRequest,
    @Headers('content-type') type: string | undefined,
    @Headers('x-file-name') name: string | undefined,
    @Headers('x-file-purpose') purpose: string | undefined,
  ) {
    const body = req.body;
    if (!(body instanceof Buffer))
      throw badRequest('file_expected', 'Send the file’s bytes as the request body.');
    let decoded = 'file';
    try {
      decoded = decodeURIComponent(name ?? 'file');
    } catch {
      /* keep the default */
    }
    const allowed = ['money', 'library', 'drop', 'voice', 'chat', 'chat-file', 'split'];
    return this.files.put(a.userId, {
      name: decoded,
      mime: (type ?? '').split(';')[0]!.trim().toLowerCase(),
      bytes: new Uint8Array(body),
      purpose: purpose && allowed.includes(purpose) ? purpose : 'drop',
    });
  }

  /** Owner only: does storage (local disk or R2/S3) work end to end right now? */
  @OwnerOnly()
  @Get('health')
  health() {
    return this.files.health();
  }

  @Get(':id')
  async download(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: FastifyReply) {
    const f = await this.files.read(a.userId, id);
    return res
      .header('content-type', INLINE_MIME.test(f.mime) ? f.mime : 'application/octet-stream')
      .header(
        'content-disposition',
        `${INLINE_MIME.test(f.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      )
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=3600')
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'")
      .send(Buffer.from(f.bytes));
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.files.remove(a.userId, id);
    return { ok: true };
  }
}
