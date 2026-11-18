import { type ReminderWay, waysOf } from '@orvyn/contracts';
import { type SendInput } from './notify.service';

/** Hard notifications and alarms come back every 5 minutes, up to 6 times, until acknowledged (D22). */
export const HARD_REPEAT = { everyMin: 5, times: 6 } as const;

/**
 * What a reminder's chosen ways mean for the notification pipeline (D22): urgent ignores quiet hours and mute and
 * repeats; an alarm is urgent and rings; email and WhatsApp are copies; with only email/WhatsApp chosen nothing is
 * pushed to devices (it still sits in the inbox).
 */
export function deliveryFor(
  ways: readonly ReminderWay[] | undefined,
  repeat = true,
): Pick<SendInput, 'priority' | 'alarm' | 'via' | 'repeat'> {
  const w = new Set(waysOf(ways));
  const hard = w.has('urgent') || w.has('alarm');
  return {
    priority: hard ? 'urgent' : undefined,
    alarm: w.has('alarm') || undefined,
    via: {
      push: w.has('push') || hard,
      email: w.has('email'),
      whatsapp: w.has('whatsapp'),
    },
    repeat: hard && repeat ? { ...HARD_REPEAT } : undefined,
  };
}
