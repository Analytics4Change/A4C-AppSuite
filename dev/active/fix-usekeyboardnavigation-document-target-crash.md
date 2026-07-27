---
status: seed
last_updated: 2026-07-26
---

# Seed: useKeyboardNavigation throws on a document-targeted key event with no containerRef

**Origin**: surfaced during the `fix/failing-vm-test-suites` remediation (PR — the failing-VM-tests fix). A genuine latent robustness bug, escalated rather than patched (the test worked around it by dispatching from a real element).

## Problem
`useKeyboardNavigation.handleKeyDown` (`frontend/src/hooks/useKeyboardNavigation.ts:269-272`) does `const target = event.target as HTMLElement; target?.closest('[data-focus-context="open"]')`. When the hook is mounted **without a `containerRef`**, its listener falls back to `document` (`:379`). If a `keydown` event's `target` is the `document` node itself, `document.closest` is `undefined` → **`TypeError: target?.closest is not a function`**.

## Impact
Low in practice: real keyboard events target the focused **element** (which has `.closest`), not the document node — so this essentially only bites synthetic `document.dispatchEvent`. But it is a real unguarded cast (`event.target as HTMLElement`) that can throw.

## Proposed fix (product, tiny)
Guard the cast in `handleKeyDown`: treat `event.target` as an element only when it is one, e.g. `const target = event.target instanceof HTMLElement ? event.target : null;` and null-check before `.closest()`/`.getAttribute()` (the same `target` is reused in the Escape branch at `:324`). Behaviour-preserving for the normal (element-target) path.

## Verification
Add a unit test dispatching a `keydown` on `document` with a null `containerRef` and assert it does not throw (currently worked around in `useKeyboardNavigation.test.tsx` by dispatching from a real element).
