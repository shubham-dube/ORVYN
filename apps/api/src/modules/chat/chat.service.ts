import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  CarryChatMessages,
  ChatAttachment,
  ChatMessageView,
  ChatReplyPreview,
  ChatShareRef,
  ConversationView,
  NewConversation,
  RegisterChatDevice,
  SendChatMessage,
  SendMessage,
} from '@orvyn/contracts';
import { BadChatData, decryptFile, openMessageWithKey } from '@orvyn/vault-crypto';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  notExists,
  sql,
} from 'drizzle-orm';
import sodium from 'libsodium-wrappers';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { newId } from '../../db/ids';
import { AccessService } from '../access/access.service';
import { devices as authDevices, users } from '../auth/auth.schema';
import { FilesService } from '../files/files.service';
import type { NotifyAction } from '../notify/notify.service';
import { NotifyService } from '../notify/notify.service';
import type { PresenceChanged } from '../realtime/realtime.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  chatConversations,
  chatDevices,
  chatHidden,
  chatKeys,
  chatMembers,
  chatMessages,
  chatReactions,
} from './chat.schema';

const MAX_MEMBERS = 50;
/** how many unread lines a push shows (D-0015-3) */
const PUSH_LINES = 4;
const REF = 'chat:';

/** What a v2 message holds, sealed at rest as one object (ADR-0016). */
interface Body {
  text: string;
  attachments: ChatAttachment[];
  share: ChatShareRef | null;
}
type Row = typeof chatMessages.$inferSelect;

/** "📷 Photo", "📎 rent.pdf" — a message's attachment in a line of text. */
export function attachmentLabel(a: ChatAttachment[]): string | null {
  if (!a.length) return null;
  const photos = a.filter((x) => x.mime.startsWith('image/')).length;
  if (photos === a.length) return photos === 1 ? '📷 Photo' : `📷 ${photos} photos`;
  if (a.length === 1 && a[0]!.mime.startsWith('audio/')) return '🎤 Voice message';
  if (a.length === 1 && a[0]!.mime.startsWith('video/')) return '🎬 Video';
  return a.length === 1 ? `📎 ${a[0]!.name}` : `📎 ${a.length} files`;
}

/**
 * Chat (spec 0011 part A, spec 0015 C). Conversations, members and messages. New messages are kept here, encrypted
 * at rest (ADR-0016), so every device has the whole history and pushes can say what was written. Old end-to-end
 * messages (ADR-0014) are still served to the devices they were sealed for, and carried over when one of them hands
 * the key back.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger('chat');
  private sealKey?: Uint8Array;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------------ at rest (ADR-0016)

  private async key(): Promise<Uint8Array> {
    if (this.sealKey) return this.sealKey;
    await sodium.ready;
    const master = this.env.FILES_MASTER_KEY
      ? sodium.from_base64(this.env.FILES_MASTER_KEY, sodium.base64_variants.ORIGINAL)
      : sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, 'orvyn-dev-files-master-key');
    this.sealKey = sodium.crypto_generichash(
      sodium.crypto_secretbox_KEYBYTES,
      'orvyn-chat-at-rest-v1',
      master,
    );
    return this.sealKey;
  }

  private async seal(b: Body): Promise<string> {
    const k = await this.key();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const box = sodium.crypto_secretbox_easy(JSON.stringify(b), nonce, k);
    return `v1.${sodium.to_base64(nonce)}.${sodium.to_base64(box)}`;
  }

  private async open(sealed: string | null): Promise<Body> {
    if (!sealed) return { text: '', attachments: [], share: null };
    const k = await this.key();
    const [, n, b] = sealed.split('.');
    const plain = sodium.crypto_secretbox_open_easy(sodium.from_base64(b!), sodium.from_base64(n!), k);
    return JSON.parse(sodium.to_string(plain)) as Body;
  }

  // ------------------------------------------------------------------ devices and keys (old sealed messages)

  async registerDevice(ownerId: string, deviceId: string, k: RegisterChatDevice) {
    const [existing] = await this.db.select().from(chatDevices).where(eq(chatDevices.deviceId, deviceId));
    if (existing && existing.ownerId !== ownerId) throw forbidden();
    await this.db
      .insert(chatDevices)
      .values({ deviceId, ownerId, ...k })
      .onConflictDoUpdate({ target: chatDevices.deviceId, set: { ...k, updatedAt: new Date() } });
    return { ok: true, changed: !!existing && existing.boxPublic !== k.boxPublic };
  }

  /** Active devices (not signed out) of the given people, with their public keys. */
  async keys(ownerId: string, userIds: string[]) {
    const mine = new Set(await this.contacts(ownerId));
    const ids = [...new Set([...userIds.filter((u) => mine.has(u) || u === ownerId)])];
    if (!ids.length) return [];
    const rows = await this.db
      .select({
        userId: chatDevices.ownerId,
        deviceId: chatDevices.deviceId,
        boxPublic: chatDevices.boxPublic,
        signPublic: chatDevices.signPublic,
        revokedAt: authDevices.revokedAt,
      })
      .from(chatDevices)
      .leftJoin(authDevices, eq(authDevices.id, chatDevices.deviceId))
      .where(inArray(chatDevices.ownerId, ids));
    return rows.map((r) => ({ ...r, active: !r.revokedAt, revokedAt: undefined }));
  }

  /** People you share a conversation with, or could start one with (everyone with Chat). */
  private async contacts(ownerId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(ne(users.id, ownerId), eq(users.disabled, false)));
    const ps = await Promise.all(rows.map((r) => this.access.principal(r.id)));
    return rows.filter((_, i) => ps[i]?.entitlements.has('chat')).map((r) => r.id);
  }

  async people(ownerId: string) {
    const ids = await this.contacts(ownerId);
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
    const p = await this.realtime.presence(ids);
    return rows.map((r) => ({ ...r, ...(p.get(r.id) ?? { online: false, lastSeenAt: null }) }));
  }

  // ------------------------------------------------------------------ conversations

  private async myConversationIds(ownerId: string) {
    return (
      await this.db
        .select({ id: chatMembers.conversationId })
        .from(chatMembers)
        .where(and(eq(chatMembers.ownerId, ownerId), isNull(chatMembers.leftAt)))
    ).map((r) => r.id);
  }

  /** The member row, or 404 for anyone not in it (rule 5). */
  private async member(ownerId: string, conversationId: string) {
    const [m] = await this.db
      .select()
      .from(chatMembers)
      .where(
        and(
          eq(chatMembers.conversationId, conversationId),
          eq(chatMembers.ownerId, ownerId),
          isNull(chatMembers.leftAt),
        ),
      );
    if (!m) throw notFound();
    return m;
  }

  private async memberIds(conversationId: string) {
    return (
      await this.db
        .select({ id: chatMembers.ownerId })
        .from(chatMembers)
        .where(and(eq(chatMembers.conversationId, conversationId), isNull(chatMembers.leftAt)))
    ).map((r) => r.id);
  }

  private async tell(conversationId: string, msg: Parameters<RealtimeService['toUser']>[1], except?: string) {
    for (const id of await this.memberIds(conversationId))
      if (id !== except) await this.realtime.toUser(id, msg);
  }

  async create(ownerId: string, b: NewConversation, o: { splitGroupId?: string } = {}) {
    const allowed = new Set(await this.contacts(ownerId));
    const others = [...new Set(b.memberIds)].filter((id) => id !== ownerId);
    if (others.some((id) => !allowed.has(id)))
      throw badRequest('not_on_chat', 'Someone there doesn’t have Chat.');
    if (b.kind === 'direct' && others.length !== 1)
      throw badRequest('one_person', 'A direct chat is with one person.');
    if (others.length + 1 > MAX_MEMBERS) throw badRequest('too_many', `Up to ${MAX_MEMBERS} people.`);
    if (b.kind === 'direct') {
      const pairKey = [ownerId, others[0]!].sort().join(':');
      const [old] = await this.db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.pairKey, pairKey));
      if (old) {
        await this.db
          .update(chatMembers)
          .set({ leftAt: null })
          .where(and(eq(chatMembers.conversationId, old.id), eq(chatMembers.ownerId, ownerId)));
        return this.view(ownerId, old.id);
      }
      const [c] = await this.db.insert(chatConversations).values({ kind: 'direct', pairKey }).returning();
      await this.db
        .insert(chatMembers)
        .values([ownerId, others[0]!].map((id) => ({ conversationId: c!.id, ownerId: id })));
      return this.view(ownerId, c!.id);
    }
    const [c] = await this.db
      .insert(chatConversations)
      .values({
        kind: 'group',
        title: b.title || 'Group',
        adminId: ownerId,
        splitGroupId: o.splitGroupId ?? null,
      })
      .returning();
    await this.db
      .insert(chatMembers)
      .values([ownerId, ...others].map((id) => ({ conversationId: c!.id, ownerId: id })));
    await this.system(c!.id, ownerId, `${await this.nameOf(ownerId)} made the group “${c!.title}”`);
    return this.view(ownerId, c!.id);
  }

  private async nameOf(id: string) {
    const [u] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, id));
    return u?.name || u?.email.split('@')[0] || 'Someone';
  }

  /** A plain line from ORVYN itself. */
  async system(conversationId: string, actorId: string, text: string) {
    const id = newId();
    await this.db
      .insert(chatMessages)
      .values({ id, conversationId, senderId: actorId, kind: 'system', text, v: 2 });
    await this.db
      .update(chatConversations)
      .set({ lastAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    await this.broadcast(conversationId, id);
  }

  /** A short line for lists, quotes and pushes. */
  private async preview(m: Row): Promise<{ text: string; attachment: string | null; deleted: boolean }> {
    if (m.deletedAt) return { text: '', attachment: null, deleted: true };
    if (m.kind === 'system') return { text: m.text ?? '', attachment: null, deleted: false };
    if (m.v === 1) return { text: '🔒 Message', attachment: null, deleted: false };
    const b = await this.open(m.body);
    return {
      text: b.text || (b.share ? `${b.share.title}` : ''),
      attachment: attachmentLabel(b.attachments),
      deleted: false,
    };
  }

  /** Not hidden by this person ("delete for me"). */
  private notHidden(ownerId: string) {
    return notExists(
      this.db
        .select({ x: chatHidden.messageId })
        .from(chatHidden)
        .where(and(eq(chatHidden.messageId, chatMessages.id), eq(chatHidden.ownerId, ownerId))),
    );
  }

  async view(ownerId: string, conversationId: string): Promise<ConversationView> {
    await this.member(ownerId, conversationId);
    const [v] = await this.conversationViews(ownerId, [conversationId]);
    if (!v) throw notFound();
    return v;
  }

  /**
   * Many conversations at once, in a fixed number of queries (not a few per chat): the database is a round trip away,
   * so the list costs the same with 3 chats or 60.
   */
  private async conversationViews(ownerId: string, ids: string[]): Promise<ConversationView[]> {
    if (!ids.length) return [];
    const mine = and(
      eq(chatMembers.conversationId, chatMessages.conversationId),
      eq(chatMembers.ownerId, ownerId),
    );
    const [mes, convs, members, unread, lasts] = await Promise.all([
      this.db
        .select()
        .from(chatMembers)
        .where(
          and(
            inArray(chatMembers.conversationId, ids),
            eq(chatMembers.ownerId, ownerId),
            isNull(chatMembers.leftAt),
          ),
        ),
      this.db.select().from(chatConversations).where(inArray(chatConversations.id, ids)),
      this.db
        .select({
          conversationId: chatMembers.conversationId,
          id: users.id,
          name: users.name,
          email: users.email,
          lastReadAt: chatMembers.lastReadAt,
          lastDeliveredAt: chatMembers.lastDeliveredAt,
        })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.ownerId))
        .where(and(inArray(chatMembers.conversationId, ids), isNull(chatMembers.leftAt))),
      this.db
        .select({ id: chatMessages.conversationId, n: sql<string>`count(*)` })
        .from(chatMessages)
        .innerJoin(chatMembers, mine)
        .where(
          and(
            inArray(chatMessages.conversationId, ids),
            ne(chatMessages.senderId, ownerId),
            eq(chatMessages.kind, 'msg'),
            isNull(chatMessages.deletedAt),
            sql`${chatMessages.createdAt} > greatest(coalesce(${chatMembers.lastReadAt}, '-infinity'::timestamptz), ${chatMembers.joinedAt} - interval '1 second')`,
            this.notHidden(ownerId),
          ),
        )
        .groupBy(chatMessages.conversationId),
      this.db
        .selectDistinctOn([chatMessages.conversationId], getTableColumns(chatMessages))
        .from(chatMessages)
        .innerJoin(chatMembers, mine)
        .where(
          and(
            inArray(chatMessages.conversationId, ids),
            sql`${chatMessages.createdAt} > ${chatMembers.joinedAt} - interval '1 second'`,
            this.notHidden(ownerId),
          ),
        )
        .orderBy(chatMessages.conversationId, desc(chatMessages.createdAt)),
    ]);
    const pinIds = convs.map((c) => c.pinnedMessageId).filter((x): x is string => !!x);
    const others = [...new Set(members.map((m) => m.id).filter((id) => id !== ownerId))];
    const [pins, presence] = await Promise.all([
      pinIds.length ? this.db.select().from(chatMessages).where(inArray(chatMessages.id, pinIds)) : [],
      this.realtime.presence(others),
    ]);
    const meOf = new Map(mes.map((m) => [m.conversationId, m]));
    const out: ConversationView[] = [];
    for (const c of convs) {
      const me = meOf.get(c.id);
      if (!me) continue;
      const here = members.filter((m) => m.conversationId === c.id);
      const other = here.find((m) => m.id !== ownerId);
      const last = lasts.find((l) => l.conversationId === c.id);
      const p = c.pinnedMessageId ? pins.find((x) => x.id === c.pinnedMessageId && !x.deletedAt) : undefined;
      const pv = p ? await this.preview(p) : null;
      out.push({
        id: c.id,
        kind: c.kind,
        title: c.kind === 'direct' ? other?.name || other?.email.split('@')[0] || 'Chat' : c.title,
        adminId: c.adminId,
        members: here.map(({ conversationId: _, ...m }) => ({
          ...m,
          lastReadAt: m.lastReadAt?.toISOString() ?? null,
          lastDeliveredAt: m.lastDeliveredAt?.toISOString() ?? null,
          ...(presence.get(m.id) ?? { online: m.id === ownerId, lastSeenAt: null }),
        })),
        muted: me.muted,
        pinned: me.pinned,
        unread: Number(unread.find((u) => u.id === c.id)?.n ?? 0),
        lastAt: c.lastAt?.toISOString() ?? null,
        splitGroupId: c.splitGroupId,
        last: last
          ? {
              id: last.id,
              senderId: last.senderId,
              kind: last.kind,
              ...(await this.preview(last)),
              at: last.createdAt.toISOString(),
            }
          : null,
        pinnedMessage:
          p && pv ? { id: p.id, senderId: p.senderId, text: pv.text, attachment: pv.attachment } : null,
      });
    }
    return out;
  }

  /** My conversations, pinned first, then newest. Fetching them means my app has them: ✓✓ delivered. */
  async list(ownerId: string): Promise<ConversationView[]> {
    const out = await this.conversationViews(ownerId, await this.myConversationIds(ownerId));
    void this.deliveredAll(ownerId, out).catch((e: Error) => this.log.debug(`delivered: ${e.message}`));
    return out.sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''),
    );
  }

  private async admin(ownerId: string, conversationId: string) {
    await this.member(ownerId, conversationId);
    const [c] = await this.db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId));
    if (c!.kind !== 'group' || c!.adminId !== ownerId)
      throw forbidden('not_admin', 'Only the group’s admin can do that.');
    return c!;
  }

  async addMembers(ownerId: string, conversationId: string, ids: string[]) {
    await this.admin(ownerId, conversationId);
    const allowed = new Set(await this.contacts(ownerId));
    const now = await this.memberIds(conversationId);
    const add = [...new Set(ids)].filter((id) => allowed.has(id) && !now.includes(id));
    if (now.length + add.length > MAX_MEMBERS) throw badRequest('too_many', `Up to ${MAX_MEMBERS} people.`);
    for (const id of add) {
      await this.db
        .insert(chatMembers)
        .values({ conversationId, ownerId: id })
        .onConflictDoUpdate({
          target: [chatMembers.conversationId, chatMembers.ownerId],
          set: { leftAt: null },
        });
      await this.system(
        conversationId,
        ownerId,
        `${await this.nameOf(ownerId)} added ${await this.nameOf(id)}`,
      );
    }
    return this.view(ownerId, conversationId);
  }

  async removeMember(ownerId: string, conversationId: string, userId: string) {
    if (userId !== ownerId) await this.admin(ownerId, conversationId);
    else await this.member(ownerId, conversationId);
    await this.system(
      conversationId,
      ownerId,
      userId === ownerId
        ? `${await this.nameOf(ownerId)} left`
        : `${await this.nameOf(ownerId)} removed ${await this.nameOf(userId)}`,
    );
    await this.db
      .update(chatMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, userId)));
    await this.realtime.toUser(userId, { type: 'chat.changed', conversationId });
    return { ok: true };
  }

  async rename(ownerId: string, conversationId: string, title: string) {
    await this.admin(ownerId, conversationId);
    await this.db.update(chatConversations).set({ title }).where(eq(chatConversations.id, conversationId));
    await this.system(conversationId, ownerId, `${await this.nameOf(ownerId)} named the group “${title}”`);
    await this.tell(conversationId, { type: 'chat.changed', conversationId });
    return this.view(ownerId, conversationId);
  }

  async mute(ownerId: string, conversationId: string, muted: boolean) {
    await this.member(ownerId, conversationId);
    await this.db
      .update(chatMembers)
      .set({ muted })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, ownerId)));
    return { ok: true };
  }

  /** Pin a chat to the top of my list. */
  async pinConversation(ownerId: string, conversationId: string, pinned: boolean) {
    await this.member(ownerId, conversationId);
    await this.db
      .update(chatMembers)
      .set({ pinned })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, ownerId)));
    await this.realtime.toUser(ownerId, { type: 'chat.changed', conversationId });
    return { ok: true };
  }

  async read(ownerId: string, conversationId: string) {
    await this.member(ownerId, conversationId);
    const at = new Date();
    await this.db
      .update(chatMembers)
      .set({ lastReadAt: at, lastDeliveredAt: at })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, ownerId)));
    await this.notify.dismissByKey(ownerId, `${REF}${conversationId}`);
    await this.tell(conversationId, {
      type: 'chat.read',
      conversationId,
      userId: ownerId,
      at: at.toISOString(),
    });
    return { ok: true };
  }

  /** My app has everything up to now (✓✓ delivered). Others hear about it only when there was something new. */
  async delivered(ownerId: string, conversationId: string) {
    const me = await this.member(ownerId, conversationId);
    const [c] = await this.db
      .select({ lastAt: chatConversations.lastAt })
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId));
    if (!c?.lastAt || (me.lastDeliveredAt && me.lastDeliveredAt >= c.lastAt)) return { ok: true };
    const at = new Date();
    await this.db
      .update(chatMembers)
      .set({ lastDeliveredAt: at })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, ownerId)));
    await this.tell(
      conversationId,
      { type: 'chat.delivered', conversationId, userId: ownerId, at: at.toISOString() },
      ownerId,
    );
    return { ok: true };
  }

  /** The list was fetched: every chat with something newer than my ✓✓ gets it, in one update. */
  private async deliveredAll(ownerId: string, list: ConversationView[]) {
    const due = list.filter((c) => {
      const me = c.members.find((m) => m.id === ownerId);
      return c.lastAt && (!me?.lastDeliveredAt || me.lastDeliveredAt < c.lastAt);
    });
    if (!due.length) return;
    const at = new Date();
    await this.db
      .update(chatMembers)
      .set({ lastDeliveredAt: at })
      .where(
        and(
          eq(chatMembers.ownerId, ownerId),
          inArray(
            chatMembers.conversationId,
            due.map((c) => c.id),
          ),
        ),
      );
    for (const c of due)
      for (const m of c.members)
        if (m.id !== ownerId)
          await this.realtime.toUser(m.id, {
            type: 'chat.delivered',
            conversationId: c.id,
            userId: ownerId,
            at: at.toISOString(),
          });
  }

  async typing(ownerId: string, conversationId: string) {
    await this.member(ownerId, conversationId);
    await this.tell(conversationId, { type: 'chat.typing', conversationId, userId: ownerId }, ownerId);
    return { ok: true };
  }

  /** Someone came online or left: tell everyone who shares a chat with them. */
  @OnEvent('presence.changed', { async: true })
  async onPresence(p: PresenceChanged) {
    try {
      const convs = await this.myConversationIds(p.userId);
      if (!convs.length) return;
      const people = await this.db
        .selectDistinct({ id: chatMembers.ownerId })
        .from(chatMembers)
        .where(
          and(
            inArray(chatMembers.conversationId, convs),
            isNull(chatMembers.leftAt),
            ne(chatMembers.ownerId, p.userId),
          ),
        );
      for (const x of people)
        await this.realtime.toUser(x.id, {
          type: 'chat.presence',
          userId: p.userId,
          online: p.online,
          lastSeenAt: p.lastSeenAt,
        });
    } catch (e) {
      this.log.debug(`presence fan-out: ${String(e)}`);
    }
  }

  // ------------------------------------------------------------------ message views

  /** Messages as every member sees them: words, photos, the quoted message, reactions. */
  private async views(rows: { m: Row; sealed: string | null }[]): Promise<ChatMessageView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.m.id);
    const reacts = await this.db
      .select()
      .from(chatReactions)
      .where(inArray(chatReactions.messageId, ids))
      .orderBy(asc(chatReactions.createdAt));
    const byMsg = new Map<string, { emoji: string; by: string[] }[]>();
    for (const r of reacts) {
      const list = byMsg.get(r.messageId) ?? [];
      const g = list.find((x) => x.emoji === r.emoji);
      if (g) g.by.push(r.ownerId);
      else list.push({ emoji: r.emoji, by: [r.ownerId] });
      byMsg.set(r.messageId, list);
    }
    const replyIds = [...new Set(rows.map((r) => r.m.replyToId).filter((x): x is string => !!x))];
    const replies = new Map<string, ChatReplyPreview>();
    if (replyIds.length)
      for (const q of await this.db.select().from(chatMessages).where(inArray(chatMessages.id, replyIds)))
        replies.set(q.id, { id: q.id, senderId: q.senderId, ...(await this.preview(q)) });
    const out: ChatMessageView[] = [];
    for (const { m, sealed } of rows) {
      const gone = !!m.deletedAt;
      const b = m.v === 2 && m.kind === 'msg' && !gone ? await this.open(m.body) : null;
      out.push({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        kind: m.kind,
        v: m.v === 1 && m.kind === 'msg' ? 1 : 2,
        text: m.kind === 'system' ? m.text : (b?.text ?? null),
        attachments: b?.attachments ?? [],
        share: b?.share ?? null,
        replyTo: m.replyToId && !gone ? (replies.get(m.replyToId) ?? null) : null,
        reactions: gone ? [] : (byMsg.get(m.id) ?? []),
        forwarded: m.forwarded,
        editedAt: m.editedAt?.toISOString() ?? null,
        deletedAt: m.deletedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        senderDeviceId: m.v === 1 ? m.senderDeviceId : null,
        ciphertext: m.v === 1 && !gone ? m.ciphertext : null,
        nonce: m.v === 1 && !gone ? m.nonce : null,
        signature: m.v === 1 && !gone ? m.signature : null,
        sealedForMe: m.v === 1 && !gone ? sealed : null,
        files: gone ? [] : m.files,
      });
    }
    return out;
  }

  private async row(messageId: string) {
    const [m] = await this.db.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    if (!m) throw notFound();
    return m;
  }

  /** Send the message itself to every member's open apps (a v1 message differs per device: just say it changed). */
  private async broadcast(conversationId: string, messageId: string) {
    const m = await this.row(messageId);
    const [view] = m.v === 2 || m.kind === 'system' ? await this.views([{ m, sealed: null }]) : [undefined];
    await this.tell(conversationId, { type: 'chat.message', conversationId, messageId, message: view });
  }

  /** A page of messages, newest first. Old sealed ones come with only this device's key. */
  async messages(
    ownerId: string,
    deviceId: string,
    conversationId: string,
    o: { before?: string; limit: number },
  ) {
    const me = await this.member(ownerId, conversationId);
    let before: Date | null = null;
    if (o.before) {
      const [b] = await this.db
        .select({ at: chatMessages.createdAt })
        .from(chatMessages)
        .where(eq(chatMessages.id, o.before));
      before = b?.at ?? null;
    }
    const rows = await this.db
      .select({ m: chatMessages, sealed: chatKeys.sealed })
      .from(chatMessages)
      .leftJoin(chatKeys, and(eq(chatKeys.messageId, chatMessages.id), eq(chatKeys.deviceId, deviceId)))
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          // you see what was said while you were in it
          gt(chatMessages.createdAt, new Date(me.joinedAt.getTime() - 1000)),
          ...(before ? [lt(chatMessages.createdAt, before)] : []),
          this.notHidden(ownerId),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(o.limit);
    if (!o.before) await this.delivered(ownerId, conversationId).catch(() => undefined);
    return this.views(rows);
  }

  /** Messages in this chat whose words (or file names) match. */
  async search(ownerId: string, conversationId: string, q: string) {
    const me = await this.member(ownerId, conversationId);
    const words = q.trim().toLowerCase();
    if (words.length < 2) return [];
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          eq(chatMessages.kind, 'msg'),
          eq(chatMessages.v, 2),
          isNull(chatMessages.deletedAt),
          gt(chatMessages.createdAt, new Date(me.joinedAt.getTime() - 1000)),
          this.notHidden(ownerId),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(3000);
    const hits: Row[] = [];
    for (const m of rows) {
      const b = await this.open(m.body);
      const hay = [b.text, ...b.attachments.map((a) => a.name), b.share?.title ?? ''].join(' ').toLowerCase();
      if (hay.includes(words)) hits.push(m);
      if (hits.length >= 50) break;
    }
    return this.views(hits.map((m) => ({ m, sealed: null })));
  }

  // ------------------------------------------------------------------ sending

  /** An old app's end-to-end message (ADR-0014): kept working until every app is updated. */
  async sendSealed(ownerId: string, deviceId: string, conversationId: string, m: SendMessage) {
    await this.member(ownerId, conversationId);
    const [dev] = await this.db.select().from(chatDevices).where(eq(chatDevices.deviceId, deviceId));
    if (!dev || dev.ownerId !== ownerId)
      throw badRequest('no_device_keys', 'Set up this device for Chat first.');
    const members = await this.memberIds(conversationId);
    const known = await this.db
      .select({ deviceId: chatDevices.deviceId, ownerId: chatDevices.ownerId })
      .from(chatDevices)
      .where(
        inArray(
          chatDevices.deviceId,
          m.keys.map((k) => k.deviceId),
        ),
      );
    const ok = new Map(known.map((k) => [k.deviceId, k.ownerId]));
    if (m.keys.some((k) => !members.includes(ok.get(k.deviceId) ?? '')))
      throw badRequest('bad_recipient', 'A key is for a device outside this conversation.');
    for (const f of m.files) await this.files.meta(ownerId, f);
    const [exists] = await this.db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.id, m.id));
    if (exists) return { id: m.id };
    await this.db.insert(chatMessages).values({
      id: m.id,
      conversationId,
      senderId: ownerId,
      senderDeviceId: deviceId,
      v: 1,
      ciphertext: m.ciphertext,
      nonce: m.nonce,
      signature: m.signature,
      files: m.files,
    });
    await this.db
      .insert(chatKeys)
      .values(m.keys.map((k) => ({ messageId: m.id, deviceId: k.deviceId, sealed: k.sealed })));
    await this.sent(ownerId, conversationId, m.id);
    return { id: m.id };
  }

  /** A message (spec 0015): kept here, encrypted at rest; arrives everywhere at once; pings with what was said. */
  async send(ownerId: string, deviceId: string, conversationId: string, b: SendChatMessage) {
    await this.member(ownerId, conversationId);
    const [exists] = await this.db.select().from(chatMessages).where(eq(chatMessages.id, b.id));
    if (exists) {
      // a retry of the same message
      if (exists.senderId !== ownerId || exists.conversationId !== conversationId)
        throw badRequest('id_taken', 'That message id is already used.');
      return (await this.views([{ m: exists, sealed: null }]))[0]!;
    }
    let body: Body;
    let filesOwnerId: string | null = null;
    let forwarded = false;
    if (b.forwardOf) {
      const src = await this.row(b.forwardOf);
      await this.member(ownerId, src.conversationId);
      if (src.kind !== 'msg' || src.v !== 2 || src.deletedAt)
        throw badRequest('cant_forward', 'That message can’t be forwarded.');
      body = await this.open(src.body);
      filesOwnerId = src.filesOwnerId ?? src.senderId;
      forwarded = true;
    } else {
      const attachments: ChatAttachment[] = [];
      for (const a of b.attachments) {
        const f = await this.files.meta(ownerId, a.fileId); // only your own uploads
        attachments.push({ ...a, name: f.name, mime: f.mime, size: f.size });
      }
      body = { text: b.text.trim(), attachments, share: b.share ?? null };
    }
    let replyToId: string | null = null;
    if (b.replyTo) {
      const [q] = await this.db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(and(eq(chatMessages.id, b.replyTo), eq(chatMessages.conversationId, conversationId)));
      replyToId = q?.id ?? null;
    }
    await this.db.insert(chatMessages).values({
      id: b.id,
      conversationId,
      senderId: ownerId,
      senderDeviceId: deviceId,
      v: 2,
      body: await this.seal(body),
      replyToId,
      forwarded,
      filesOwnerId,
      files: body.attachments.map((a) => a.fileId),
    });
    await this.sent(ownerId, conversationId, b.id);
    return (await this.views([{ m: await this.row(b.id), sealed: null }]))[0]!;
  }

  /** After a message is stored: newest in the list, read by its sender, everywhere at once, a ping for the others. */
  private async sent(ownerId: string, conversationId: string, messageId: string) {
    const now = new Date();
    await this.db
      .update(chatConversations)
      .set({ lastAt: now })
      .where(eq(chatConversations.id, conversationId));
    await this.db
      .update(chatMembers)
      .set({ lastReadAt: now, lastDeliveredAt: now })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, ownerId)));
    await this.broadcast(conversationId, messageId);
    await this.ping(conversationId, ownerId);
  }

  /** A push for everyone else: who wrote and what (the last few unread lines), with Reply and Mark as read. */
  private async ping(conversationId: string, senderId: string) {
    const [c] = await this.db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId));
    const rows = await this.db
      .select()
      .from(chatMembers)
      .where(
        and(
          eq(chatMembers.conversationId, conversationId),
          isNull(chatMembers.leftAt),
          ne(chatMembers.ownerId, senderId),
        ),
      );
    const names = new Map<string, string>();
    const name = async (id: string) => {
      if (!names.has(id)) names.set(id, await this.nameOf(id));
      return names.get(id)!;
    };
    for (const r of rows) {
      if (r.muted) continue;
      const since = r.lastReadAt && r.lastReadAt > r.joinedAt ? r.lastReadAt : r.joinedAt;
      const unread = await this.db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            eq(chatMessages.kind, 'msg'),
            ne(chatMessages.senderId, r.ownerId),
            isNull(chatMessages.deletedAt),
            gt(chatMessages.createdAt, since),
          ),
        )
        .orderBy(desc(chatMessages.createdAt))
        .limit(PUSH_LINES);
      if (!unread.length) continue;
      const lines: string[] = [];
      for (const m of unread.reverse()) {
        const p = await this.preview(m);
        const words = [p.attachment, p.text].filter(Boolean).join(' ') || 'Message';
        lines.push(c!.kind === 'group' ? `${await name(m.senderId)}: ${words}` : words);
      }
      await this.notify.send({
        userId: r.ownerId,
        module: 'chat',
        kind: 'message',
        type: 'chat.message',
        title: c!.kind === 'group' ? c!.title : await name(senderId),
        body: lines.join('\n'),
        url: `/chat/${conversationId}`,
        dedupeKey: `${REF}${conversationId}`,
        ref: `${REF}${conversationId}`,
        priority: 'high',
        actions: [
          { id: 'reply', label: 'Reply', reply: { placeholder: 'Message' } },
          { id: 'read', label: 'Mark as read' },
        ],
      });
    }
  }

  /** Reply or Mark as read, pressed on a chat notification anywhere (spec 0015 C). */
  @OnEvent('notify.action', { async: true, promisify: true })
  async onAction(e: NotifyAction): Promise<void> {
    if (e.notification.module !== 'chat' || !e.notification.ref?.startsWith(REF)) return;
    const conversationId = e.notification.ref.slice(REF.length);
    if (e.actionId === 'reply' && e.text) {
      await this.send(e.ownerId, e.deviceId, conversationId, {
        id: newId(),
        text: e.text,
        attachments: [],
      });
    }
    if (e.actionId === 'reply' || e.actionId === 'read') await this.read(e.ownerId, conversationId);
  }

  // ------------------------------------------------------------------ changing messages

  async edit(ownerId: string, messageId: string, text: string) {
    const m = await this.row(messageId);
    await this.member(ownerId, m.conversationId);
    if (m.senderId !== ownerId || m.kind !== 'msg' || m.v !== 2 || m.deletedAt)
      throw forbidden('not_yours', 'You can edit only your own messages.');
    const b = await this.open(m.body);
    await this.db
      .update(chatMessages)
      .set({ body: await this.seal({ ...b, text }), editedAt: new Date() })
      .where(eq(chatMessages.id, messageId));
    await this.broadcast(m.conversationId, messageId);
    return (await this.views([{ m: await this.row(messageId), sealed: null }]))[0]!;
  }

  /** One reaction per person (D-0015-4); null takes mine away. */
  async react(ownerId: string, messageId: string, emoji: string | null) {
    const m = await this.row(messageId);
    await this.member(ownerId, m.conversationId);
    if (m.kind !== 'msg' || m.deletedAt)
      throw badRequest('cant_react', 'That message can’t take a reaction.');
    if (emoji)
      await this.db
        .insert(chatReactions)
        .values({ messageId, ownerId, emoji })
        .onConflictDoUpdate({
          target: [chatReactions.messageId, chatReactions.ownerId],
          set: { emoji, createdAt: new Date() },
        });
    else
      await this.db
        .delete(chatReactions)
        .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.ownerId, ownerId)));
    await this.broadcast(m.conversationId, messageId);
    return { ok: true };
  }

  /** Delete for everyone: the words, photos and reactions are gone from the server. */
  async remove(ownerId: string, messageId: string) {
    const m = await this.row(messageId);
    await this.member(ownerId, m.conversationId);
    if (m.senderId !== ownerId || m.kind !== 'msg')
      throw forbidden('not_yours', 'You can delete only your own messages.');
    await this.db
      .update(chatMessages)
      .set({ deletedAt: new Date(), ciphertext: null, nonce: null, signature: null, body: null, files: [] })
      .where(eq(chatMessages.id, messageId));
    await this.db.delete(chatKeys).where(eq(chatKeys.messageId, messageId));
    await this.db.delete(chatReactions).where(eq(chatReactions.messageId, messageId));
    await this.db
      .update(chatConversations)
      .set({ pinnedMessageId: null })
      .where(eq(chatConversations.pinnedMessageId, messageId));
    // a file goes only when no forwarded copy still shows it
    for (const f of m.files) {
      const [still] = await this.db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(isNull(chatMessages.deletedAt), sql`${chatMessages.files} @> ${JSON.stringify([f])}::jsonb`),
        )
        .limit(1);
      if (!still) await this.files.remove(m.filesOwnerId ?? ownerId, f).catch(() => undefined);
    }
    await this.broadcast(m.conversationId, messageId);
    return { ok: true };
  }

  /** Delete for me: gone from my devices only. */
  async hide(ownerId: string, messageId: string) {
    const m = await this.row(messageId);
    await this.member(ownerId, m.conversationId);
    await this.db.insert(chatHidden).values({ messageId, ownerId }).onConflictDoNothing();
    await this.realtime.toUser(ownerId, { type: 'chat.hidden', conversationId: m.conversationId, messageId });
    return { ok: true };
  }

  /** Pin one message to the top of the chat (null unpins). */
  async pinMessage(ownerId: string, conversationId: string, messageId: string | null) {
    await this.member(ownerId, conversationId);
    if (messageId) {
      const m = await this.row(messageId);
      if (m.conversationId !== conversationId || m.kind !== 'msg' || m.deletedAt) throw notFound();
    }
    await this.db
      .update(chatConversations)
      .set({ pinnedMessageId: messageId })
      .where(eq(chatConversations.id, conversationId));
    await this.system(
      conversationId,
      ownerId,
      `${await this.nameOf(ownerId)} ${messageId ? 'pinned' : 'unpinned'} a message`,
    );
    await this.tell(conversationId, { type: 'chat.changed', conversationId });
    return this.view(ownerId, conversationId);
  }

  // ------------------------------------------------------------------ carrying old chats over (ADR-0016)

  /**
   * A device that can still read old sealed messages hands over their keys. Each is checked against the sender
   * device's signature, then stored like any other message; photos and files are re-stored as ordinary files.
   */
  async carry(ownerId: string, conversationId: string, b: CarryChatMessages) {
    await this.member(ownerId, conversationId);
    const keyOf = new Map(b.items.map((i) => [i.id, i.key]));
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          inArray(chatMessages.id, [...keyOf.keys()]),
          eq(chatMessages.v, 1),
          eq(chatMessages.kind, 'msg'),
          isNull(chatMessages.deletedAt),
        ),
      )
      .orderBy(asc(chatMessages.createdAt));
    await sodium.ready;
    let carried = 0;
    let refused = 0;
    for (const m of rows) {
      const [dev] = m.senderDeviceId
        ? await this.db.select().from(chatDevices).where(eq(chatDevices.deviceId, m.senderDeviceId))
        : [];
      if (!dev || dev.ownerId !== m.senderId || !m.ciphertext || !m.nonce || !m.signature) {
        refused++;
        continue;
      }
      type Old =
        | { t: 'text'; text: string; replyTo?: string | null }
        | { t: 'react'; target: string; emoji: string | null }
        | { t: 'edit'; target: string; text: string }
        | {
            t: 'file';
            fileId: string;
            key: string;
            nonce: string;
            name: string;
            mime: string;
            caption?: string;
          }
        | { t: 'share'; ref: ChatShareRef };
      let p: Old;
      try {
        const key = sodium.from_base64(keyOf.get(m.id)!, sodium.base64_variants.URLSAFE_NO_PADDING);
        p = await openMessageWithKey<Old>(
          {
            conversationId,
            id: m.id,
            senderDeviceId: m.senderDeviceId!,
            ciphertext: m.ciphertext,
            nonce: m.nonce,
            signature: m.signature,
          },
          key,
          dev.signPublic,
        );
      } catch (e) {
        if (!(e instanceof BadChatData)) this.log.warn(`carry: ${String(e)}`);
        refused++;
        continue;
      }
      const drop = async () => {
        await this.db.delete(chatKeys).where(eq(chatKeys.messageId, m.id));
        await this.db.delete(chatMessages).where(eq(chatMessages.id, m.id));
      };
      if (p.t === 'react') {
        if (p.emoji)
          await this.db
            .insert(chatReactions)
            .values({ messageId: p.target, ownerId: m.senderId, emoji: p.emoji, createdAt: m.createdAt })
            .onConflictDoUpdate({
              target: [chatReactions.messageId, chatReactions.ownerId],
              set: { emoji: p.emoji, createdAt: m.createdAt },
            });
        else
          await this.db
            .delete(chatReactions)
            .where(and(eq(chatReactions.messageId, p.target), eq(chatReactions.ownerId, m.senderId)));
        await drop();
        carried++;
        continue;
      }
      if (p.t === 'edit') {
        const [t] = await this.db.select().from(chatMessages).where(eq(chatMessages.id, p.target));
        if (!t || t.v !== 2) continue; // its message isn't carried yet: next time
        if (t.senderId === m.senderId && !t.deletedAt) {
          const tb = await this.open(t.body);
          await this.db
            .update(chatMessages)
            .set({ body: await this.seal({ ...tb, text: p.text }), editedAt: m.createdAt })
            .where(eq(chatMessages.id, t.id));
        }
        await drop();
        carried++;
        continue;
      }
      let body: Body = { text: '', attachments: [], share: null };
      let replyToId: string | null = null;
      let files: string[] = [];
      if (p.t === 'text') {
        body.text = p.text;
        replyToId = p.replyTo ?? null;
      } else if (p.t === 'share') {
        body.share = p.ref;
      } else if (p.t === 'file') {
        body.text = p.caption ?? '';
        try {
          const sealed = await this.files.read(m.senderId, p.fileId);
          const plain = await decryptFile(sealed.bytes, p.key, p.nonce);
          const f = await this.files.put(m.senderId, {
            name: p.name,
            mime: p.mime,
            bytes: plain,
            purpose: 'chat-file',
          });
          body.attachments = [{ fileId: f.id, name: f.name, mime: f.mime, size: f.size }];
          files = [f.id];
          await this.files.remove(m.senderId, p.fileId).catch(() => undefined);
        } catch {
          body = {
            ...body,
            text: [body.text, `📎 ${p.name} (couldn’t be brought over)`].filter(Boolean).join('\n'),
          };
        }
      }
      await this.db
        .update(chatMessages)
        .set({
          v: 2,
          body: await this.seal(body),
          replyToId,
          files,
          ciphertext: null,
          nonce: null,
          signature: null,
        })
        .where(eq(chatMessages.id, m.id));
      await this.db.delete(chatKeys).where(eq(chatKeys.messageId, m.id));
      carried++;
    }
    if (carried) await this.tell(conversationId, { type: 'chat.changed', conversationId });
    return { carried, refused };
  }

  /** A photo or file, for members of a conversation where it was sent. */
  async file(ownerId: string, conversationId: string, fileId: string) {
    await this.member(ownerId, conversationId);
    const [m] = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          isNull(chatMessages.deletedAt),
          sql`${chatMessages.files} @> ${JSON.stringify([fileId])}::jsonb`,
        ),
      )
      .limit(1);
    if (!m) throw notFound();
    return this.files.read(m.filesOwnerId ?? m.senderId, fileId);
  }
}
