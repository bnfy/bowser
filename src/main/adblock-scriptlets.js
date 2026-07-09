// Ghostery returns cosmetic scriptlets as standalone JavaScript programs.
// Keep each program's declarations private: some uBO scriptlets install
// long-lived Proxy handlers whose closures refer back to helper functions.
// If a later scriptlet replaces those helpers in the page's global scope,
// an older handler can start consulting the newer handler's WeakMap and
// recursively call itself (observed on chatgpt.com with two prevent-fetch
// rules in @ghostery/adblocker-electron 2.18.1).
const isolationInstalled = Symbol('cosmetic-scriptlet-isolation');

function isolateScriptlet(script) {
  // Ghostery deliberately shares scriptletGlobals between injections (for
  // safeSelf caching, WAR resources, and debug state). Pass that shared object
  // into the private scope so the generated `var scriptletGlobals` prologue
  // reuses it while helper function declarations remain isolated.
  return `((scriptletGlobals) => {\n${script}\n})(typeof globalThis.scriptletGlobals === 'undefined' ? (globalThis.scriptletGlobals = {}) : globalThis.scriptletGlobals);`;
}

function installScriptletIsolation(blocker) {
  if (blocker[isolationInstalled]) return;

  const getCosmeticsFilters = blocker.getCosmeticsFilters;
  blocker.getCosmeticsFilters = function getIsolatedCosmeticsFilters(...args) {
    const result = Reflect.apply(getCosmeticsFilters, this, args);
    if (!Array.isArray(result?.scripts) || result.scripts.length === 0) return result;
    return {
      ...result,
      scripts: result.scripts.map(isolateScriptlet),
    };
  };

  Object.defineProperty(blocker, isolationInstalled, { value: true });
}

module.exports = { isolateScriptlet, installScriptletIsolation };
