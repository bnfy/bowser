(() => {
  const params = new URL(location.href).searchParams;
  const url = params.get('url') || '';
  const code = params.get('code') || '';
  const desc = params.get('desc') || '';

  document.getElementById('errorUrl').textContent = url;
  document.getElementById('errorDetail').textContent = desc ? `${desc} (${code})` : `Error ${code}`;

  // Only re-link to schemes a failed navigation can legitimately have —
  // never let a crafted error URL smuggle e.g. javascript: into the href.
  if (/^(https?|file):\/\//i.test(url)) {
    document.getElementById('retryLink').href = url;
  }
})();
