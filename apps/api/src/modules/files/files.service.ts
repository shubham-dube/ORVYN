import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import sodium from 'libsodium-wrappers';
import { AppError, badRequest, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { files } from './files.schema';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * What can be kept: the files people actually have — photos, PDFs, text and data, voice notes and other audio, short
 * videos, Office/OpenDocument files, archives. Anything else is refused (executables and web pages among them).
 */
export const ALLOWED_MIME =
  /^(image\/(png|jpeg|webp|gif|heic|heif|avif|bmp|tiff)|application\/(pdf|json|zip|x-zip-compressed|gzip|x-7z-compressed|rtf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.oasis\.opendocument\.[a-z.]+)|text\/(plain|csv|markdown|calendar|vcard|x-vcard|tab-separated-values)|audio\/(webm|ogg|mpeg|mp4|aac|wav|x-wav|x-m4a|m4a|amr|3gpp|flac)|video\/(mp4|webm|quicktime|3gpp))$/;

/** Shown in the page (`inline`); everything else is downloaded, never rendered as active content. */
export const INLINE_MIME =
  /^(image\/(png|jpeg|webp|gif|avif|bmp)|application\/pdf|text\/(plain|csv|markdown)|audio\/.+|video\/.+)$/;

const BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
  amr: 'audio/amr',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  zip: 'application/zip',
  doc: 'application/msword',
  rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

/** The type to store: what the client said, or (when it said nothing useful) what the file name says. */
export function normaliseMime(declared: string, name: string): string {
  const m = declared.split(';')[0]!.trim().toLowerCase();
  if (m && m !== 'application/octet-stream') return m === 'audio/x-m4a' ? 'audio/mp4' : m;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || 'application/octet-stream';
}

/** A storage failure: the person sees "storage unavailable"; the store's own words go to the logs and health check. */
export class StorageError extends AppError {
  constructor(readonly detail: string) {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      'storage_unavailable',
      'Files can’t be stored right now. Please try again in a minute.',
    );
    this.message = detail;
  }
}
const CHUNK = 64 * 1024;

interface Store {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

class LocalStore implements Store {
  constructor(private readonly root: string) {}
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error('bad key');
    return p;
  }
  async put(key: string, bytes: Uint8Array) {
    await mkdir(dirname(this.path(key)), { recursive: true });
    await writeFile(this.path(key), bytes);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3Store implements Store {
  private readonly s3: S3Client;
  constructor(private readonly env: Env) {
    this.s3 = new S3Client({
      region: 'auto',
      // R2: path-style works for every bucket name; the account endpoint without the bucket
      endpoint: env.S3_ENDPOINT.replace(/\/+$/, '').replace(new RegExp(`/${env.S3_BUCKET}$`), ''),
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }
  async put(key: string, bytes: Uint8Array) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: bytes }));
  }
  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    return new Uint8Array(await r.Body!.transformToByteArray());
  }
  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }
}

export interface FileView {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

/**
 * Files encrypted at rest with their own keys (ADR-0011): libsodium secretstream for the bytes, the data key sealed
 * with FILES_MASTER_KEY. Every read is owner-scoped; nothing is ever public.
 */
@Injectable()
export class FilesService {
  private readonly store: Store;
  private readonly log = new Logger('files');
  private master: Uint8Array | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.store = env.FILES_STORE === 's3' ? new S3Store(env) : new LocalStore(env.FILES_DIR);
  }

  private async key(): Promise<Uint8Array> {
    if (this.master) return this.master;
    await sodium.ready;
    const k = this.env.FILES_MASTER_KEY
      ? sodium.from_base64(this.env.FILES_MASTER_KEY, sodium.base64_variants.ORIGINAL)
      : sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, 'orvyn-dev-files-master-key');
    if (k.length !== sodium.crypto_secretbox_KEYBYTES)
      throw new Error('FILES_MASTER_KEY must be 32 bytes (base64)');
    this.master = k;
    return k;
  }

  /** The stored form: header + chunks, each authenticated; the last chunk is marked final. */
  static encrypt(plain: Uint8Array, dataKey: Uint8Array): Uint8Array {
    const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dataKey);
    const parts: Uint8Array[] = [header];
    for (let i = 0; i < plain.length || i === 0; i += CHUNK) {
      const last = i + CHUNK >= plain.length;
      parts.push(
        sodium.crypto_secretstream_xchacha20poly1305_push(
          state,
          plain.subarray(i, i + CHUNK),
          null,
          last
            ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
        ),
      );
      if (last) break;
    }
    return Buffer.concat(parts);
  }

  static decrypt(sealed: Uint8Array, dataKey: Uint8Array): Uint8Array {
    const H = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
    const A = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(sealed.subarray(0, H), dataKey);
    const out: Uint8Array[] = [];
    let i = H;
    for (;;) {
      const chunk = sealed.subarray(i, i + CHUNK + A);
      const r = sodium.crypto_secretstream_xchacha20poly1305_pull(state, chunk, null);
      if (!r) throw new Error('file failed authentication');
      out.push(r.message);
      i += chunk.length;
      if (r.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) break;
      if (i >= sealed.length) throw new Error('file truncated');
    }
    return Buffer.concat(out);
  }

  async put(
    ownerId: string,
    o: { name: string; mime: string; bytes: Uint8Array; purpose?: string },
  ): Promise<FileView> {
    if (!o.bytes.length) throw badRequest('empty_file', 'The file is empty.');
    if (o.bytes.length > MAX_FILE_BYTES) throw badRequest('file_too_big', 'Files can be up to 25 MB.');
    o = { ...o, mime: normaliseMime(o.mime, o.name) };
    if (!ALLOWED_MIME.test(o.mime))
      throw badRequest(
        'file_type',
        'That kind of file can’t be kept. Photos, PDFs, documents, spreadsheets, audio, video and ZIP files can.',
      );
    await sodium.ready;
    const dataKey = sodium.crypto_secretstream_xchacha20poly1305_keygen();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const wrapped = `v1.${sodium.to_base64(nonce)}.${sodium.to_base64(sodium.crypto_secretbox_easy(dataKey, nonce, await this.key()))}`;
    const id = randomUUID();
    const objectKey = `${ownerId}/${id}`;
    await this.guard('put', () => this.store.put(objectKey, FilesService.encrypt(o.bytes, dataKey)));
    const name = o.name.replace(/[\\/\0]/g, '_').slice(0, 200) || 'file';
    const [row] = await this.db
      .insert(files)
      .values({
        id,
        ownerId,
        name,
        mime: o.mime,
        size: o.bytes.length,
        sha256: createHash('sha256').update(o.bytes).digest('hex'),
        wrappedKey: wrapped,
        objectKey,
        purpose: o.purpose ?? 'drop',
      })
      .returning();
    return { id: row!.id, name, mime: o.mime, size: o.bytes.length, createdAt: row!.createdAt.toISOString() };
  }

  async meta(ownerId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.ownerId, ownerId), isNull(files.deletedAt)));
    if (!row) throw notFound('file_not_found', 'That file isn’t here.');
    return row;
  }

  async read(ownerId: string, id: string): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
    const row = await this.meta(ownerId, id);
    await sodium.ready;
    const [, n, b] = row.wrappedKey.split('.');
    const dataKey = sodium.crypto_secretbox_open_easy(
      sodium.from_base64(b!),
      sodium.from_base64(n!),
      await this.key(),
    );
    return {
      name: row.name,
      mime: row.mime,
      bytes: FilesService.decrypt(await this.guard('get', () => this.store.get(row.objectKey)), dataKey),
    };
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const row = await this.meta(ownerId, id);
    await this.guard('remove', () => this.store.remove(row.objectKey)).catch(() => undefined); // gone is gone
    await this.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, row.id));
  }

  private async guard<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = e as Error & { Code?: string; $metadata?: { httpStatusCode?: number } };
      const detail = [err.name, err.Code, err.$metadata?.httpStatusCode, err.message]
        .filter(Boolean)
        .join(' · ');
      this.log.error(`storage ${op} failed (${this.env.FILES_STORE}): ${detail}`);
      throw new StorageError(detail);
    }
  }

  /**
   * Owner's check that storage works end to end: write, read back and delete a small object, with the store's own
   * error when it doesn't (wrong endpoint, key, bucket or permission).
   */
  async health(): Promise<{
    store: string;
    ok: boolean;
    ms: number;
    error?: string;
    bucket?: string;
    endpoint?: string;
  }> {
    const t = Date.now();
    const key = `_health/${randomUUID()}`;
    const where =
      this.env.FILES_STORE === 's3'
        ? {
            bucket: this.env.S3_BUCKET || '(not set)',
            endpoint: this.env.S3_ENDPOINT.replace(/^https?:\/\//, '') || '(not set)',
          }
        : {};
    try {
      const probe = new TextEncoder().encode(`orvyn ${t}`);
      await this.guard('put', () => this.store.put(key, probe));
      const back = await this.guard('get', () => this.store.get(key));
      await this.guard('remove', () => this.store.remove(key));
      if (Buffer.compare(Buffer.from(back), Buffer.from(probe)) !== 0)
        throw new Error('read back something else');
      return { store: this.env.FILES_STORE, ok: true, ms: Date.now() - t, ...where };
    } catch (e) {
      const detail = e instanceof StorageError ? e.detail : (e as Error).message;
      return { store: this.env.FILES_STORE, ok: false, ms: Date.now() - t, error: detail, ...where };
    }
  }

  /** For tests: where a file's encrypted bytes live (local store only). */
  localPath(objectKey: string): string {
    return join(this.env.FILES_DIR, objectKey);
  }
}
