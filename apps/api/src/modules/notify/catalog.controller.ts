import { Controller, Get } from '@nestjs/common';
import { NOTIFY_CATALOG, NOTIFY_MODULES } from '@orvyn/contracts';

/** Every kind of notification, for the apps that can't import the catalog (Android) — spec 0019. */
@Controller('notifications/catalog')
export class NotifyCatalogController {
  @Get()
  catalog() {
    return { types: NOTIFY_CATALOG, modules: NOTIFY_MODULES };
  }
}
