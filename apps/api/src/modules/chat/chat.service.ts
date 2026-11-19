import { Inject, Injectable } from '@nestjs/common';
import type {
  ChatMessageView,
  ConversationView,
  NewConversation,
  RegisterChatDevice,
  SendMessage,
} from '@orvyn/contracts';
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { devices as authDevices, users } from '../auth/auth.schema';
import { FilesService } from '../files/files.service';
import { NotifyService } from '../notify/notify.service';
import { RealtimeService } from '../realtime/realtime.service';
import { chatConversations, chatDevices, chatKeys, chatMembers, chatMessages } from './chat.schema';

const MAX_MEMBERS = 50;

/**
 * Chat (spec 0011 part A, ADR-0014). The server keeps who is in which conversation, which devices exist, and opaque
 * ciphertext with one sealed key per recipient device. It never sees content; notifications say only who wrote.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------------ devices and keys

  async registerDevice(ownerId: string, deviceId: string, k: RegisterChatDevice) {
    const [existing] = await this.db.select().from(chatDevices).where(eq(chatDevices.deviceId, deviceId));
    if (existing && existing.ownerId !== ownerId) throw forbidden();
    await this.db
      .insert(chatDevices)
      .values({ deviceId, ownerId, ...k })
      .onConflictDoUpdate({ target: chatDevices.deviceId, set: { ...k, updatedAt: new Date() } });
    // a new or changed key: everyone talking with this person sees the key change
    const convs = await this.myConversationIds(ownerId);
    for (const c of convs) await this.tell(c, { type: 'chat.changed', conversationId: c });
    return { ok: true, changed: !!existing && existing.boxPublic !== k.boxPublic };
  }

  /** Active devices (not signed out) of the given people, with their public keys — to encrypt for. */
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
    const out: string[] = [];
    for (const r of rows) if ((await this.access.principal(r.id))?.entitlements.has('chat')) out.push(r.id);
    return out;
  }

  async people(ownerId: string) {
    const ids = await this.contacts(ownerId);
    if (!ids.length) return [];
    return this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
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

  /** A plain line from ORVYN itself (not encrypted, marked so). */
  async system(conversationId: string, actorId: string, text: string) {
    const id = crypto.randomUUID();
    await this.db
      .insert(chatMessages)
      .values({ id, conversationId, senderId: actorId, kind: 'system', text });
    await this.db
      .update(chatConversations)
      .set({ lastAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    await this.tell(conversationId, { type: 'chat.message', conversationId, messageId: id });
  }

  async view(ownerId: string, conversationId: string): Promise<ConversationView> {
    const me = await this.member(ownerId, conversationId);
    const [c] = await this.db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId));
    const members = await this.db
      .select({ id: users.id, name: users.name, email: users.email, lastReadAt: chatMembers.lastReadAt })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.ownerId))
      .where(and(eq(chatMembers.conversationId, conversationId), isNull(chatMembers.leftAt)));
    const [{ n } = { n: '0' }] = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          ne(chatMessages.senderId, ownerId),
          isNull(chatMessages.deletedAt),
          ...(me.lastReadAt ? [gt(chatMessages.createdAt, me.lastReadAt)] : []),
        ),
      );
    const other = members.find((m) => m.id !== ownerId);
    return {
      id: c!.id,
      kind: c!.kind,
      title: c!.kind === 'direct' ? other?.name || other?.email.split('@')[0] || 'Chat' : c!.title,
      adminId: c!.adminId,
      members: members.map((m) => ({ ...m, lastReadAt: m.lastReadAt?.toISOString() ?? null })),
      muted: me.muted,
      unread: Number(n),
      lastAt: c!.lastAt?.toISOString() ?? null,
      splitGroupId: c!.splitGroupId,
    };
  }

  async list(ownerId: string): Promise<ConversationView[]> {
    const out: ConversationView[] = [];
    for (const id of await this.myConversationIds(ownerId)) out.push(await this.view(ownerId, id));
    return out.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
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
    await this.db
      .update(chatMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, userId)));
    await this.system(
      conversationId,
      ownerId,
      userId === ownerId
        ? `${await this.nameOf(ownerId)} left`
        : `${await this.nameOf(ownerId)} removed ${await this.nameOf(userId)}`,
    );
    return { ok: true };
  }

  async rename(ownerId: string, conversationId: string, title: string) {
    await this.admin(ownerId, conversationId);
    await this.db.update(chatConversations).set({ title }).where(eq(chatConversations.id, conversationId));
    await this.system(conversationId, ownerId, `${await this.nameOf(ownerId)} named the group “${title}”`);
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

  async read(ownerId: string, conversationId: string) {
    await this.member(ownerId, conversationId);
    const at = new Date();
    await this.db
      .update(chatMembers)
      .set({ lastReadAt: at })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.ownerId, ownerId)));
    await this.notify.dismissByKey(ownerId, `chat:${conversationId}`);
    await this.tell(
      conversationId,
      { type: 'chat.read', conversationId, userId: ownerId, at: at.toISOString() },
      ownerId,
    );
    return { ok: true };
  }

  async typing(ownerId: string, conversationId: string) {
    await this.member(ownerId, conversationId);
    await this.tell(conversationId, { type: 'chat.typing', conversationId, userId: ownerId }, ownerId);
    return { ok: true };
  }

  // ------------------------------------------------------------------ messages

  /**
   * Stores one encrypted message. Every sealed key must be for a device of a member; files must be the sender's own
   * uploads. The server checks shape and membership — it cannot check content, and does not try.
   */
  async send(ownerId: string, deviceId: string, conversationId: string, m: SendMessage) {
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
    for (const f of m.files) await this.files.meta(ownerId, f); // throws unless it is the sender's own upload
    const [exists] = await this.db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.id, m.id));
    if (exists) return { id: m.id }; // a retry
    await this.db.insert(chatMessages).values({
      id: m.id,
      conversationId,
      senderId: ownerId,
      senderDeviceId: deviceId,
      ciphertext: m.ciphertext,
      nonce: m.nonce,
      signature: m.signature,
      files: m.files,
    });
    await this.db
      .insert(chatKeys)
      .values(m.keys.map((k) => ({ messageId: m.id, deviceId: k.deviceId, sealed: k.sealed })));
    await this.db
      .update(chatConversations)
      .set({ lastAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    await this.tell(conversationId, { type: 'chat.message', conversationId, messageId: m.id });
    // a ping without content (the server can't read it anyway)
    const name = await this.nameOf(ownerId);
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
          ne(chatMembers.ownerId, ownerId),
        ),
      );
    for (const r of rows) {
      if (r.muted) continue;
      await this.notify.send({
        userId: r.ownerId,
        module: 'chat',
        kind: 'message',
        title: c!.kind === 'group' ? c!.title : name,
        body: c!.kind === 'group' ? `New message from ${name}` : 'New message',
        url: `/chat/${conversationId}`,
        dedupeKey: `chat:${conversationId}`,
      });
    }
    return { id: m.id };
  }

  /** A page of messages, newest first, each with only the sealed key for the asking device. */
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
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(o.limit);
    return rows.map(({ m, sealed }): ChatMessageView => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderDeviceId: m.senderDeviceId,
      kind: m.kind,
      ciphertext: m.deletedAt ? null : m.ciphertext,
      nonce: m.deletedAt ? null : m.nonce,
      signature: m.deletedAt ? null : m.signature,
      sealedForMe: m.deletedAt ? null : (sealed ?? null),
      text: m.text,
      files: m.deletedAt ? [] : m.files,
      deletedAt: m.deletedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /** Delete for everyone: the ciphertext and its keys are gone from the server. */
  async remove(ownerId: string, messageId: string) {
    const [m] = await this.db.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    if (!m) throw notFound();
    await this.member(ownerId, m.conversationId);
    if (m.senderId !== ownerId || m.kind !== 'msg')
      throw forbidden('not_yours', 'You can delete only your own messages.');
    await this.db
      .update(chatMessages)
      .set({ deletedAt: new Date(), ciphertext: null, nonce: null, signature: null, files: [] })
      .where(eq(chatMessages.id, messageId));
    await this.db.delete(chatKeys).where(eq(chatKeys.messageId, messageId));
    for (const f of m.files) await this.files.remove(ownerId, f).catch(() => undefined);
    await this.tell(m.conversationId, { type: 'chat.message', conversationId: m.conversationId, messageId });
    return { ok: true };
  }

  /** An encrypted attachment, for members of a conversation where it was sent. */
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
    return this.files.read(m.senderId, fileId);
  }
}
