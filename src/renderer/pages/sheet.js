// Shared glue for utility pages presented in the sheet (body.sheet):
// dialog semantics, the ✕, scrim-click dismissal, and initial focus on the
// page heading so keyboard/screen-reader users land on what just opened.
// Esc is handled main-side (before-input-event); this file never needs it.
(() => {
  const page = document.querySelector('.page');
  if (!page || !window.bowserPages?.surface) return;

  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  const heading = page.querySelector('h1');
  if (heading) {
    if (!heading.id) heading.id = 'sheetTitle';
    page.setAttribute('aria-labelledby', heading.id);
    heading.tabIndex = -1;
    heading.focus();
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sheet-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', () => window.bowserPages.surface.close());
  // All five utility pages have a sticky .page-nav — the ✕ rides it so it
  // never scrolls away and never stacks under the nav band.
  page.querySelector('.page-nav').append(close);

  // Clicks on the scrim (the body itself, outside the card) dismiss.
  document.body.addEventListener('mousedown', (e) => {
    if (e.target === document.body) window.bowserPages.surface.close();
  });
})();
