// PR A — accept-failure command-feedback assertions.
// Paste into DevTools console AFTER the failed submit, BEFORE dismissing.
(() => {
  const alerts  = document.querySelectorAll('[role="alert"]');
  const banner  = document.querySelector('[data-testid="command-feedback-banner"]');
  const echo    = document.querySelector('[data-testid="command-feedback-toast-error"]');
  const text    = (banner?.innerText || '');
  const leaks   = /PROCESSING_FAILED|uq_users_email_normalized|duplicate key|SQLSTATE|23505/i.test(text);
  const focusIn = !!banner && (document.activeElement === banner || banner.contains(document.activeElement));
  const echoFocusable = echo
    ? echo.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])').length
    : 0;

  const r = {
    '1. exactly one role=alert (INV-1)' : alerts.length === 1 ? 'PASS' : `FAIL (${alerts.length})`,
    '2. focus moved to banner'          : focusIn ? 'PASS' : `FAIL (on <${document.activeElement?.tagName?.toLowerCase()}>)`,
    '3. echo present + aria-hidden'     : echo ? (echo.getAttribute('aria-hidden') === 'true' ? 'PASS' : 'FAIL (not aria-hidden)') : 'FAIL (missing)',
    '4. echo has no focusable child (INV-2)': echoFocusable === 0 ? 'PASS' : `FAIL (${echoFocusable})`,
    '5. message sanitized'              : banner ? (leaks ? 'FAIL (leaks internals)' : 'PASS') : 'FAIL (no banner)',
  };
  console.table(r);
  console.log('banner text:', JSON.stringify(text));
  window.__prA = { submit: document.querySelector('[data-testid="accept-invitation-submit"]') };
  console.log('Now click the banner dismiss (X), then run:  __prAafter()');
  window.__prAafter = () => console.table({
    '6. banner gone'   : !document.querySelector('[data-testid="command-feedback-banner"]') ? 'PASS' : 'FAIL',
    '7. echo gone'     : !document.querySelector('[data-testid="command-feedback-toast-error"]') ? 'PASS' : 'FAIL',
    '8. focus restored to submit (NOT body)':
        document.activeElement === window.__prA.submit ? 'PASS'
        : `FAIL (on <${document.activeElement?.tagName?.toLowerCase()}>)`,
  });
  return r;
})();
