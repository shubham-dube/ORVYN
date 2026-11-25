import type { FillField } from '@orvyn/contracts';

/**
 * Reading and filling a form in the page (spec 0020). Only what a person could see and edit is filled; nothing is ever
 * submitted; every value set can be undone.
 */

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;
interface Target {
  field: FillField;
  /** one control; or the buttons of a group of choices */
  els: Control[];
}
interface Before {
  el: Control;
  value: string;
  checked?: boolean;
}

const SKIP_TYPES = new Set([
  'hidden',
  'password',
  'submit',
  'button',
  'reset',
  'image',
  'file',
  'search',
  'color',
  'range',
]);
let targets = new Map<string, Target>();
let before: Before[] = [];

/** Everything, open shadow roots included. */
function all<T extends Element>(sel: string, root: Document | ShadowRoot = document): T[] {
  const out = [...root.querySelectorAll<T>(sel)];
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...all<T>(sel, el.shadowRoot));
  return out;
}

/** Could a person see it? Fields hidden to harvest data are not filled. */
export function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.right + scrollX < 0 || r.bottom + scrollY < 0) return false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
  }
  return true;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

function byIds(el: Element, attr: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  return clean(
    (el.getAttribute(attr) ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => root.getElementById?.(id)?.textContent ?? '')
      .join(' '),
  );
}

/** The words a person reads next to a field. */
export function labelOf(el: Control): string {
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const t = clean([...labels].map((l) => ownText(l, el)).join(' '));
    if (t) return t;
  }
  const aria = byIds(el, 'aria-labelledby') || clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  // the nearest wrapper that holds only this field and says something before it
  let box = el.parentElement;
  for (let i = 0; box && i < 4; i++, box = box.parentElement) {
    if (box.querySelectorAll('input:not([type=hidden]),textarea,select').length > 1) break;
    const t = clean(ownText(box, el));
    if (t && t.length < 200) return t;
  }
  const ph = clean(el.getAttribute('placeholder'));
  return /^(select|choose|type here|enter)\b.{0,12}$/i.test(ph) ? '' : ph || clean(el.getAttribute('title'));
}

function ownText(box: Element, without: Element): string {
  let out = '';
  for (const n of box.childNodes) {
    if (n === without) continue;
    if (n.nodeType === Node.TEXT_NODE) out += ` ${n.textContent}`;
    else if (n instanceof Element && !/^(SCRIPT|STYLE|SELECT|TEXTAREA|INPUT|BUTTON|SVG)$/i.test(n.tagName))
      out += ` ${n.contains(without) ? ownText(n, without) : (n.textContent ?? '')}`;
  }
  return out;
}

function groupLabel(els: HTMLInputElement[]): string {
  const first = els[0]!;
  const set = first.closest('fieldset');
  const legend = clean(set?.querySelector('legend')?.textContent);
  if (legend) return legend;
  const group = first.closest('[role=radiogroup],[role=group]');
  if (group) {
    const t = byIds(group, 'aria-labelledby') || clean(group.getAttribute('aria-label'));
    if (t) return t;
  }
  let box: Element | null = first;
  while (box && !els.every((e) => box!.contains(e))) box = box.parentElement;
  for (let i = 0; box && i < 3; i++, box = box.parentElement) {
    let t = clean(box.textContent);
    for (const e of els) t = t.replace(labelOf(e), ' ');
    t = clean(t);
    if (t && t.length < 250) return t;
  }
  return clean(first.name);
}

/** The fields of this frame, with ids to fill them by. */
export function scan(): { fields: FillField[]; files: number; filled: number } {
  targets = new Map();
  let n = 0;
  let filled = 0;
  const add = (els: Control[], o: Partial<FillField>) => {
    const field: FillField = {
      id: `f${n++}`,
      label: '',
      type: 'text',
      name: '',
      autocomplete: '',
      options: [],
      ...o,
    };
    if (n <= 120) targets.set(field.id, { field, els });
  };
  const seen = new Set<Element>();
  for (const el of all<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) {
    if (seen.has(el) || el.disabled || (el as HTMLInputElement).readOnly) continue;
    const type = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
    if (SKIP_TYPES.has(type)) continue;
    const base = {
      name: clean(el.name || el.id).slice(0, 120),
      autocomplete: clean(el.autocomplete).slice(0, 60),
    };
    if (type === 'radio' || type === 'checkbox') {
      const mates = (
        el.name
          ? all<HTMLInputElement>(`input[type=${type}]`).filter(
              (e) => e.name === el.name && e.form === (el as HTMLInputElement).form,
            )
          : [el as HTMLInputElement]
      ).filter((e) => !e.disabled);
      mates.forEach((m) => seen.add(m));
      // styled choices often hide the real input: one visible label is enough
      if (!mates.some((m) => visible(m) || [...(m.labels ?? [])].some(visible))) continue;
      // ticks are mostly consent: those stay the person's own to give
      if (type === 'checkbox') continue;
      if (mates.some((m) => m.checked)) filled++;
      add(mates, {
        ...base,
        type: 'radio',
        label: groupLabel(mates),
        options: mates.slice(0, 80).map((m) => labelOf(m).slice(0, 120) || m.value),
      });
      continue;
    }
    if (!visible(el)) continue;
    if (el.value.trim() && !(el instanceof HTMLSelectElement)) filled++;
    add([el], {
      ...base,
      type: el instanceof HTMLSelectElement ? 'select' : type,
      label: labelOf(el),
      options:
        el instanceof HTMLSelectElement
          ? [...el.options]
              .slice(0, 300)
              .map((o) => clean(o.text).slice(0, 120))
              .filter(Boolean)
              .slice(0, 80)
          : [],
    });
  }
  for (const el of all<HTMLElement>('[contenteditable=true],[contenteditable=""],[role=textbox]'))
    if (!seen.has(el) && !/^(INPUT|TEXTAREA)$/.test(el.tagName) && visible(el))
      add([el], { label: labelOf(el), type: 'textarea' });
  return {
    fields: [...targets.values()].map((t) => t.field),
    files: all<HTMLInputElement>('input[type=file]').length,
    filled,
  };
}

/** Sets a value the way typing does, so React, Vue and Angular notice. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  el.focus({ preventScroll: true });
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}

function current(t: Target): string {
  const el = t.els[0]!;
  if (t.field.type === 'radio') {
    const i = t.els.findIndex((e) => (e as HTMLInputElement).checked);
    return i < 0 ? '' : (t.field.options[i] ?? '');
  }
  if (el instanceof HTMLSelectElement) {
    const o = el.selectedOptions[0];
    return o && o.value !== '' && !/^(select|choose|please|--)/i.test(o.text.trim()) ? clean(o.text) : '';
  }
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.value
    : (el.textContent ?? '');
}

function mark(el: Element): void {
  const e = el as HTMLElement;
  const old = e.style.outline;
  e.style.outline = '2px solid #3b82f6';
  setTimeout(() => (e.style.outline = old), 4000);
}

/** Fills empty fields only (what I typed stays mine). Says what was filled. */
export function fill(values: { id: string; value: string }[]): {
  done: string[];
  kept: string[];
  failed: string[];
} {
  const out = { done: [] as string[], kept: [] as string[], failed: [] as string[] };
  before = [];
  for (const v of values) {
    const t = targets.get(v.id);
    const el = t?.els[0];
    if (!t || !el?.isConnected) {
      out.failed.push(v.id);
      continue;
    }
    if (current(t).trim()) {
      out.kept.push(v.id);
      continue;
    }
    if (t.field.type === 'radio') {
      const hit = t.els[t.field.options.indexOf(v.value)] as HTMLInputElement | undefined;
      if (!hit) {
        out.failed.push(v.id);
        continue;
      }
      before.push({ el: hit, value: '', checked: hit.checked });
      hit.click();
      mark(hit.labels?.[0] ?? hit);
      (hit.checked ? out.done : out.failed).push(v.id);
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      const o = [...el.options].find((x) => clean(x.text).slice(0, 120) === v.value);
      if (!o) {
        out.failed.push(v.id);
        continue;
      }
      before.push({ el, value: el.value });
      setValue(el, o.value);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const max = el.maxLength > 0 ? el.maxLength : Infinity;
      if (v.value.length > max) {
        out.failed.push(v.id); // half an answer is worse than none
        continue;
      }
      before.push({ el, value: el.value });
      setValue(el, v.value);
      // a list that opens as you type: what was typed may need choosing, so it is left marked for a look
    } else {
      before.push({ el, value: el.textContent ?? '' });
      el.focus();
      el.textContent = v.value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v.value }));
    }
    mark(el);
    out.done.push(v.id);
  }
  return out;
}

export function undo(): number {
  let n = 0;
  for (const b of before.reverse()) {
    if (!b.el.isConnected) continue;
    if (b.checked !== undefined) {
      const box = b.el as HTMLInputElement;
      if (box.checked !== b.checked) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(box, b.checked);
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (
      b.el instanceof HTMLInputElement ||
      b.el instanceof HTMLTextAreaElement ||
      b.el instanceof HTMLSelectElement
    )
      setValue(b.el, b.value);
    else b.el.textContent = b.value;
    n++;
  }
  before = [];
  return n;
}

/** What is in the form now, for learning: questions with answers (never secrets; `scan` leaves those out). */
export function answers(): { q: string; a: string; field: FillField }[] {
  scan();
  return [...targets.values()].flatMap((t) => {
    const a = current(t).trim();
    return a && t.field.label && a.length <= 5000 ? [{ q: t.field.label, a, field: t.field }] : [];
  });
}
