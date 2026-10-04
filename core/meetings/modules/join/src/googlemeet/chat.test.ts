/**
 * Browser-context chat send — jsdom fixture test.
 *
 * chat_send is declared in acts.v1 (contracts.ts) but was never implemented: a published
 * command was accepted by the bot's subscriber and silently dropped. Verified live on
 * 2026-08-18 — nothing reached the meeting chat, nothing appeared in the bot log.
 *
 * Same contract as leave-click (#542): the routine is serialized into the page, so it may
 * use DOM globals and its arguments only, and every selector must be plain CSS —
 * document.querySelector has no Playwright engines, and a `:has-text()` entry throws
 * SyntaxError at runtime rather than at build time.
 *
 * Run: npx tsx src/googlemeet/chat.test.ts
 */

import { JSDOM } from 'jsdom';
import { googleChatSendBrowserAction } from './chat';
import { googleChatToggleMatchers, googleChatInputSelectors, googleChatSendMatchers } from './selectors';

let passed = 0, failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) { console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); passed++; }
  else { console.log(`  \x1b[31mFAIL\x1b[0m  ${name} (erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)})`); failed++; }
}

function mountDom(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  const clicked: string[] = [];
  const keys: string[] = [];
  dom.window.HTMLElement.prototype.click = function (this: HTMLElement) {
    clicked.push(this.getAttribute('data-fixture-id') ?? this.tagName.toLowerCase());
  };
  const g = globalThis as any;
  g.window = dom.window; g.document = dom.window.document;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  g.Element = dom.window.Element; g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent; g.Event = dom.window.Event;
  dom.window.document.addEventListener('keydown', (e: any) => keys.push(e.key));
  return { dom, clicked, keys, doc: dom.window.document };
}

const matchers = {
  toggles: googleChatToggleMatchers,
  inputs: googleChatInputSelectors,
  sends: googleChatSendMatchers,
};

// page.evaluate(fn, arg) hands the page function exactly ONE argument. Invoke it the same way,
// so a signature that only works when called directly fails here and not in a live meeting.
const send = (text: string) =>
  (googleChatSendBrowserAction as (arg: unknown) => Promise<boolean>)({ text, ...matchers });

const OPEN_PANEL = `
  <button aria-label="Chat with everyone" data-fixture-id="toggle"></button>
  <textarea aria-label="Send a message to everyone" data-fixture-id="input"></textarea>
  <button aria-label="Send a message" data-fixture-id="send"></button>`;

const CLOSED_PANEL = `
  <button aria-label="Chat with everyone" data-fixture-id="toggle"></button>`;

async function run() {
  console.log('chat send (browser context)');

  // 1. Offener Panel: Text landet im Feld, Absenden wird ausgeloest
  {
    const { clicked, doc } = mountDom(OPEN_PANEL);
    const ok = await send('Hallo Team');
    const field = doc.querySelector('[data-fixture-id="input"]') as HTMLTextAreaElement;
    check('meldet Erfolg', ok, true);
    check('Text steht im Eingabefeld', field.value, 'Hallo Team');
    check('Senden ausgeloest', clicked.includes('send'), true);
  }

  // 2. Geschlossener Panel: erst oeffnen. Ohne Eingabefeld kein Erfolg,
  //    aber der Toggle MUSS geklickt worden sein.
  {
    const { clicked } = mountDom(CLOSED_PANEL);
    const ok = await send('Hallo');
    check('oeffnet den geschlossenen Panel', clicked.includes('toggle'), true);
    check('meldet Misserfolg ohne Eingabefeld', ok, false);
  }

  // 3. Leerer Text wird nicht gesendet (sonst postet ein Bug leere Zeilen ins Meeting)
  {
    const { clicked } = mountDom(OPEN_PANEL);
    const ok = await send('   ');
    check('sendet keinen leeren Text', ok, false);
    check('klickt dabei nicht auf Senden', clicked.includes('send'), false);
  }

  // 4. Kein Chat vorhanden (Bot noch nicht zugelassen): sauberes false, kein Wurf
  {
    mountDom('<div>nichts hier</div>');
    let threw = false;
    let ok: boolean | undefined;
    try { ok = await send('Hallo'); } catch { threw = true; }
    check('wirft nicht ohne Chat-Elemente', threw, false);
    check('meldet Misserfolg', ok, false);
  }

  // 5. Regression #542: jeder Selektor muss reines CSS sein
  {
    const { doc } = mountDom(OPEN_PANEL);
    const all = [
      ...matchers.toggles.map(m => m.css).filter(Boolean) as string[],
      ...matchers.inputs,
      ...matchers.sends.map(m => m.css).filter(Boolean) as string[],
    ];
    let bad = 0;
    for (const sel of all) {
      try { doc.querySelector(sel); } catch { bad++; console.log(`      ungueltig: ${sel}`); }
    }
    check('alle Selektoren sind gueltiges CSS', bad, 0);
  }

  console.log(failed === 0 ? `\nPASS (${passed})` : `\nFAIL (${failed} von ${passed + failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
