import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors';
import { AiBadAnswer, AiOff, AiPaused, ModelHttpError } from './ai.service';

/** A model problem said plainly, for routes that answer with the model's words. */
export async function plainAi<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AiPaused)
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ai_paused',
        'AI is paused until tomorrow (daily limit).',
      );
    if (e instanceof AiOff)
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'ai_off', 'AI is not set up on this server.');
    if (e instanceof AiBadAnswer)
      throw new AppError(HttpStatus.BAD_GATEWAY, 'ai_unclear', 'The AI gave no usable answer. Try again.');
    if (e instanceof ModelHttpError || (e instanceof Error && e.name === 'TimeoutError'))
      throw new AppError(HttpStatus.BAD_GATEWAY, 'ai_failed', 'The AI could not be reached. Try again.');
    throw e;
  }
}
