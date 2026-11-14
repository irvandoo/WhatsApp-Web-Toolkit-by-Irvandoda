/**
 * Design tokens for the small UIs injected into the WhatsApp page (toasts, suggestion list, draft cards).
 * Same palette as app/shared/ui/theme.css so every window of the extension looks like one product.
 * Put it inside a shadow root's <style>, after `:host{all:initial}`, and use var(--s-*).
 */
export const SOFT_TOKENS = `
:host{--s-bg:#fbfcfb;--s-bg2:#eff3f1;--s-fg:#26332e;--s-mut:#5a6862;--s-bd:#e3e9e6;--s-ac:#38a362;--s-ink:#1f6b42;--s-soft:#e6f4ec;--s-bad:#a3403d;--s-badsoft:#fbe9e7;--s-sh:0 8px 28px rgba(38,51,46,.18)}
@media (prefers-color-scheme:dark){:host{--s-bg:#1b2420;--s-bg2:#222d28;--s-fg:#dfe8e3;--s-mut:#9aaaa3;--s-bd:#2d3a34;--s-ac:#58c487;--s-ink:#8fdcae;--s-soft:rgba(88,196,135,.16);--s-bad:#f0a09a;--s-badsoft:rgba(240,130,122,.16);--s-sh:0 8px 28px rgba(0,0,0,.4)}}
`;
