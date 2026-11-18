import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/** Encrypted file storage (ADR-0011). Global: Drop and Money attach files; the AI reads dropped ones. */
@Global()
@Module({ providers: [FilesService], controllers: [FilesController], exports: [FilesService] })
export class FilesModule {}
