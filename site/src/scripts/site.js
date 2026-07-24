/* Shared marketing-site behaviour: release resolution and opt-in analytics. */
(function () {
  const ctas = Array.from(document.querySelectorAll('[data-download-cta]'));
  const links = Array.from(document.querySelectorAll('[data-download-link]'));
  if (!ctas.length && !links.length) return;

  const ua = navigator.userAgent;
  let os = null;
  if (/Windows/i.test(ua)) os = 'win';
  else if (/Android|iPhone|iPad|iPod/i.test(ua)) os = null;
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'mac';
  else if (/Linux/i.test(ua)) os = 'linux';

  // On the dedicated download page, make the relevant installer the first
  // choice without changing the meaningful source order for unsupported
  // devices. The individual links remain available as fallbacks.
  const downloadOptions = document.querySelector('[data-download-options]');
  if (os && downloadOptions) {
    const preferred = links.find((link) => link.dataset.platform === os);
    if (preferred?.parentElement === downloadOptions) downloadOptions.prepend(preferred);
  }

  const pickAsset = (assets, kind) => {
    if (kind === 'mac') {
      const dmgs = assets.filter((asset) => asset.name.endsWith('.dmg'));
      return dmgs.find((asset) => asset.name.includes('arm64')) || dmgs[0];
    }
    if (kind === 'win') return assets.find((asset) => asset.name.endsWith('.exe'));
    if (kind === 'linux') return assets.find((asset) => asset.name.endsWith('.AppImage'));
    return null;
  };

  fetch('https://api.github.com/repos/bnfy/blanc/releases/latest')
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((release) => {
      links.forEach((link) => {
        const asset = pickAsset(release.assets, link.dataset.platform);
        if (asset) link.href = asset.browser_download_url;
      });
      if (!os) return;
      const asset = pickAsset(release.assets, os);
      if (!asset) return;
      ctas.forEach((cta) => {
        cta.href = asset.browser_download_url;
        cta.dataset.platform = os;
      });
    })
    .catch(() => { /* Releases page remains the deliberate fallback. */ });
})();

// Nothing Google-related loads until the visitor opts in. Tracking hooks are
// harmless before consent because no gtag function exists until GA is loaded.
try {
  const GA_ID = 'G-MN8BLY6GE9';
  let loaded = false;
  const loadGA = () => {
    if (loaded) return;
    loaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  };

  const banner = document.getElementById('consent');
  const consent = localStorage.getItem('ga-consent');
  if (consent === 'granted') {
    loadGA();
  } else if (consent !== 'denied' && banner) {
    banner.hidden = false;
    document.body.classList.add('has-consent');
    const dismiss = (choice) => {
      localStorage.setItem('ga-consent', choice);
      banner.hidden = true;
      document.body.classList.remove('has-consent');
    };
    document.getElementById('consentAllow').addEventListener('click', () => {
      dismiss('granted');
      loadGA();
    });
    document.getElementById('consentDeny').addEventListener('click', () => dismiss('denied'));
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-track]');
    if (!target || typeof window.gtag !== 'function') return;
    const payload = {
      source_page: document.body.dataset.page || location.pathname,
      cta_position: target.dataset.ctaPosition || undefined,
      platform: target.dataset.platform || undefined,
      feature: target.dataset.feature || undefined,
    };
    window.gtag('event', target.dataset.track, payload);
  });
} catch (error) { /* A broken analytics path must never affect the site. */ }
