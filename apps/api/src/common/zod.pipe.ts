import { type PipeTransform } from '@nestjs/common';
import { type ZodTypeAny, type z } from 'zod';
import { badRequest } from './errors';

/** Validates a request part against a contracts schema (validation happens at the edge). */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      const first = r.error.issues[0];
      throw badRequest(
        'invalid_request',
        first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request',
      );
    }
    return r.data;
  }
}
