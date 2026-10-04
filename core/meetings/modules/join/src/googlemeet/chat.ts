import type { BrowserContextButtonMatcher } from "../shared/leave-click";

export type ChatSendArgs = {
  text: string;
  toggles: BrowserContextButtonMatcher[];
  inputs: string[];
  sends: BrowserContextButtonMatcher[];
};

/**
 * Post a message to the Google Meet chat, from INSIDE the page.
 *
 * Serialized through page.evaluate, so the same contract as leave-click applies: DOM globals
 * and its single argument only (page.evaluate passes exactly one), no module scope, and plain CSS in every selector — document
 * .querySelector has no Playwright engines, and a `:has-text()` entry throws SyntaxError at
 * runtime rather than failing the build (#542).
 *
 * Returns true only when the text actually reached the composer and a send was dispatched.
 * Every failure path resolves false rather than throwing: the caller is an acts handler, and
 * a bot that dies because a chat panel moved is worse than one that skips a message.
 */
export async function googleChatSendBrowserAction(args: ChatSendArgs): Promise<boolean> {
  // Serialization contract (see leave-click): esbuild-family compilers wrap nested functions
  // in a `__name` helper that does not exist in the page. Identity fallback first.
  (globalThis as any).__name = (globalThis as any).__name || ((f: unknown) => f);
  const blog = (m: string) => { try { (window as any).logBot?.(m); } catch { /* best-effort */ } };

  const message = (args.text ?? "").trim();
  if (!message) { blog("[chat_send] empty message — nothing sent"); return false; }

  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el as HTMLElement);
    return rect.width > 0 && rect.height > 0
      && cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  const findByMatchers = (matchers: BrowserContextButtonMatcher[]): HTMLElement | null => {
    for (const m of matchers) {
      const scope = m.css ?? 'button, [role="button"]';
      let candidates: Element[];
      try { candidates = Array.from(document.querySelectorAll(scope)); }
      catch (e: any) { blog(`[chat_send] invalid selector ${scope}: ${e?.message}`); continue; }
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        if (m.text && !normalize(el.textContent ?? "").includes(normalize(m.text))) continue;
        return el as HTMLElement;
      }
    }
    return null;
  };

  const findInput = (): HTMLElement | null => {
    for (const sel of args.inputs) {
      let els: Element[];
      try { els = Array.from(document.querySelectorAll(sel)); }
      catch (e: any) { blog(`[chat_send] invalid selector ${sel}: ${e?.message}`); continue; }
      for (const el of els) if (isVisible(el)) return el as HTMLElement;
    }
    return null;
  };

  // The panel may be closed. Opening it is idempotent from our side: if the input is already
  // there we never touch the toggle, so we cannot accidentally close an open panel.
  let input = findInput();
  if (!input) {
    const toggle = findByMatchers(args.toggles);
    if (toggle) {
      blog("[chat_send] chat panel closed — opening");
      toggle.click();
      // Meet animates the panel in. Poll briefly rather than guessing a fixed delay.
      for (let i = 0; i < 20 && !input; i++) {
        await new Promise((r) => setTimeout(r, 100));
        input = findInput();
      }
    }
  }
  if (!input) { blog("[chat_send] no chat input found — not admitted, or Meet changed the panel"); return false; }

  // Meet's composer is React-controlled: assigning .value alone leaves React's internal state
  // stale and the message is discarded on send. Set through the native setter and dispatch the
  // events React listens for. Contenteditable takes textContent instead.
  const tag = input.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const el = input as HTMLTextAreaElement;
    // Take the prototype off the element rather than off a global: the globals are not
    // guaranteed to be present in every context this is exercised in.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (setter) setter.call(el, message); else el.value = message;
  } else {
    input.textContent = message;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // Enter is how a human sends; the button is the fallback when Meet swallows the key.
  input.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
  }));

  const sendBtn = findByMatchers(args.sends);
  if (sendBtn) sendBtn.click();
  else blog("[chat_send] no send button — relying on Enter");

  blog(`[chat_send] sent (${message.length} chars)`);
  return true;
}
