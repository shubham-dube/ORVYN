import { Inject, Injectable } from '@nestjs/common';
import {
  FillFact,
  FillMapReply,
  type FillMapRequest,
  FillProfile,
  PageReadReply,
  type PageReadRequest,
} from '@orvyn/contracts';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Seal } from '../../common/seal';
import { DB, type Db } from '../../db/db.module';
import { AiService } from '../ai/ai.service';
import { plainAi } from '../ai/plain';
import { fillProfiles } from './fill.schema';

const Structured = z.object({ facts: z.array(z.unknown()).max(400) });
const Draft = z.object({
  answer: z.string().max(6000).default(''),
  missing: z.string().max(400).default(''),
});

const ASKS: Record<PageReadRequest['mode'], string> = {
  brief:
    'Say what this page is and what matters in it: "text" = 2 to 4 sentences, "points" = up to 7 key facts with their numbers.',
  ask: 'Answer the person’s question from the page: "text" = the answer, "points" = the lines of the page that show it. If the page does not say, say so.',
  catch:
    'Find the catch for the reader: hidden costs, renewals, lock-ins, data sharing, deadlines, fine print, manipulative design. "text" = the verdict in 1 or 2 sentences, "points" = each catch. If there is none, say so.',
  actions:
    'List what the reader should do or record. "actions" = up to 8 of {"kind":"task","text":"renew passport by 12 Dec"} or {"kind":"expense","text":"spent 240 on lunch at Cafe"}, worded as a quick note, with the day, time or amount when the page gives it. "text" = one sentence.',
  compare:
    'Compare the pages for someone choosing between them: "text" = a recommendation and why, "points" = the differences that matter, naming each page.',
};

/**
 * Magic fill (spec 0020, D-0020-4). The mapping call gets labels and fact names only; values never go to the model
 * there. A draft (asked for one by one) and reading a pasted profile are the two calls that see the person's words.
 */
@Injectable()
export class FillService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly seal: Seal,
    private readonly ai: AiService,
  ) {}

  async profile(ownerId: string): Promise<FillProfile> {
    const [r] = await this.db.select().from(fillProfiles).where(eq(fillProfiles.ownerId, ownerId));
    if (!r) return FillProfile.parse({});
    const box = await this.seal.for(ownerId, 'fill');
    return FillProfile.parse(box.open(r.sealed));
  }

  async save(ownerId: string, p: FillProfile): Promise<FillProfile> {
    const box = await this.seal.for(ownerId, 'fill');
    // one value per key: the last one given wins
    const clean: FillProfile = { ...p, facts: [...new Map(p.facts.map((f) => [f.key, f])).values()] };
    const sealed = box.seal(clean);
    await this.db
      .insert(fillProfiles)
      .values({ ownerId, sealed })
      .onConflictDoUpdate({ target: fillProfiles.ownerId, set: { sealed, updatedAt: new Date() } });
    return clean;
  }

  async structure(ownerId: string, text: string): Promise<{ facts: FillFact[] }> {
    const r = await plainAi(() =>
      this.ai.complete({
        ownerId,
        task: 'fill.structure',
        system: `Turn a person's profile text into facts for filling forms.
Answer {"facts":[{"key","label","value","group"}]}. group is one of identity, contact, address, work, education, links,
money, other. key is lowercase snake_case. Use these keys when they apply: first_name, middle_name, last_name,
full_name, email, phone, date_of_birth (YYYY-MM-DD), gender, nationality, address_line1, address_line2, city, state,
postal_code, country, linkedin, github, website, current_company, current_title, total_experience_years,
current_salary, expected_salary, notice_period, work_authorization, highest_degree, university, graduation_year, gpa,
skills, languages. Add others (company_1, company_1_title, company_1_start and so on) as needed. Copy values exactly;
never invent one. Skip passwords, card numbers, CVVs, PINs and one-time codes.`,
        data: [{ type: 'text', text }],
        schema: Structured,
        maxTokens: 6000,
        cache: false,
      }),
    );
    // one bad fact does not lose the rest
    const facts = r.facts.flatMap((f) => {
      const p = FillFact.safeParse(f);
      return p.success && p.data.value.trim() ? [p.data] : [];
    });
    return { facts };
  }

  async map(ownerId: string, req: FillMapRequest): Promise<FillMapReply> {
    const r = await plainAi(() =>
      this.ai.complete({
        ownerId,
        task: 'fill.map',
        system: `Match the fields of a web form to facts a person has. You see field labels and fact names, never values.
Answer {"map":[{"id": field id, "key": fact key or null}]} with one entry per field. Use null unless the fact clearly
answers the field: a wrong match is worse than none. Never match password, one-time code, card, captcha, search or
consent fields.`,
        data: [{ type: 'text', text: JSON.stringify(req) }],
        schema: FillMapReply,
        maxTokens: 3000,
      }),
    );
    const ids = new Set(req.fields.map((f) => f.id));
    const keys = new Set(req.keys.map((k) => k.key));
    return { map: r.map.filter((m) => ids.has(m.id) && (m.key === null || keys.has(m.key))) };
  }

  async draft(ownerId: string, o: { question: string; page: string; maxChars: number }) {
    const p = await this.profile(ownerId);
    const about = [p.story, ...p.facts.map((f) => `${f.label}: ${f.value}`)].join('\n').slice(0, 24_000);
    const r = await plainAi(() =>
      this.ai.complete({
        ownerId,
        task: 'fill.draft',
        system: `Write an answer to one question on a form, in the first person, as this person would. Plain, specific
and warm; no clichés. Use only facts from their profile: never invent experience, numbers or opinions. If the profile
does not answer it, say what is missing in "missing" and leave "answer" empty. At most ${o.maxChars} characters.
Answer {"answer": string, "missing": string}.`,
        user: 'Answer the QUESTION below, using the PROFILE.',
        data: [
          { type: 'text', text: `QUESTION\n${o.question}` },
          { type: 'text', text: `PROFILE\n${about}` },
          ...(o.page ? [{ type: 'text' as const, text: `THE PAGE (for context only)\n${o.page}` }] : []),
        ],
        schema: Draft,
        maxTokens: 1500,
        cache: false,
      }),
    );
    return { answer: r.answer.slice(0, o.maxChars), missing: r.missing };
  }

  async read(ownerId: string, req: PageReadRequest): Promise<PageReadReply> {
    return plainAi(() =>
      this.ai.complete({
        ownerId,
        task: 'page.read',
        system: `You read web pages for a person. Today is ${new Date().toISOString().slice(0, 10)}. ${ASKS[req.mode]}
Use only what the pages say. Answer {"text","points","actions"}; leave out what does not apply.`,
        ...(req.mode === 'ask' ? { user: `The person asks: ${req.question}` } : {}),
        data: req.pages.map((p, i) => ({
          type: 'text' as const,
          text: `PAGE ${i + 1}: ${p.title}\n${p.url.split(/[?#]/)[0]}\n${p.text}`,
        })),
        schema: PageReadReply,
        maxTokens: 1500,
        cache: false,
      }),
    );
  }
}
