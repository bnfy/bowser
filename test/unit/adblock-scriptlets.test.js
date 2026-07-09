const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {
  isolateScriptlet,
  installScriptletIsolation,
} = require('../../src/main/adblock-scriptlets');

// Reduced form of the proxyApplyFn helper emitted by the two prevent-fetch
// rules currently matching chatgpt.com. Its Function#toString handler remains
// live after evaluation and resolves `proxyApplyFn` from the script's scope.
function proxyScriptlet(label) {
  return `
function proxyApplyFn(path, handler) {
  const original = globalThis[path];
  if (proxyApplyFn.proxies === undefined) {
    proxyApplyFn.proxies = new WeakMap();
    proxyApplyFn.nativeToString = Function.prototype.toString;
    const toStringProxy = new Proxy(Function.prototype.toString, {
      apply(_target, thisArg) {
        let unwrapped = thisArg;
        for (;;) {
          const next = proxyApplyFn.proxies.get(unwrapped);
          if (next === undefined) break;
          unwrapped = next;
        }
        return proxyApplyFn.nativeToString.call(unwrapped);
      },
    });
    proxyApplyFn.proxies.set(toStringProxy, proxyApplyFn.nativeToString);
    Function.prototype.toString = toStringProxy;
  }
  const proxy = new Proxy(original, {
    apply(target, thisArg, args) {
      return handler({ reflect: () => Reflect.apply(target, thisArg, args) });
    },
  });
  proxyApplyFn.proxies.set(proxy, original);
  globalThis[path] = proxy;
}
proxyApplyFn('fetch', (context) => {
  hits.push('${label}');
  return context.reflect();
});`;
}

function makeContext() {
  const context = vm.createContext({ hits: [] });
  vm.runInContext(
    'globalThis.fetch = function originalFetch(value) { return value; };',
    context
  );
  return context;
}

test('unisolated scriptlets reproduce the global proxy recursion', () => {
  const context = makeContext();
  vm.runInContext(proxyScriptlet('first'), context);
  vm.runInContext(proxyScriptlet('second'), context);

  assert.throws(
    () => vm.runInContext('Function.prototype.toString.call(fetch)', context),
    /Maximum call stack size exceeded/
  );
});

test('isolated scriptlets keep both wrappers usable without recursion', () => {
  const context = makeContext();
  vm.runInContext(isolateScriptlet(proxyScriptlet('first')), context);
  vm.runInContext(isolateScriptlet(proxyScriptlet('second')), context);

  assert.equal(vm.runInContext("fetch('ok')", context), 'ok');
  assert.deepEqual(Array.from(context.hits), ['second', 'first']);
  assert.match(
    vm.runInContext('Function.prototype.toString.call(fetch)', context),
    /originalFetch/
  );
});

test('isolated scriptlets preserve Ghostery shared globals between injections', () => {
  const context = vm.createContext({
    scriptletGlobals: { warOrigin: 'https://war.invalid' },
  });
  const first = `
    if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; }
    globalThis.firstWarOrigin = scriptletGlobals.warOrigin;
    scriptletGlobals.safeSelf = { calls: 1 };
  `;
  const second = `
    if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; }
    globalThis.secondWarOrigin = scriptletGlobals.warOrigin;
    scriptletGlobals.safeSelf.calls += 1;
  `;

  vm.runInContext(isolateScriptlet(first), context);
  vm.runInContext(isolateScriptlet(second), context);

  assert.equal(context.firstWarOrigin, 'https://war.invalid');
  assert.equal(context.secondWarOrigin, 'https://war.invalid');
  assert.equal(context.scriptletGlobals.safeSelf.calls, 2);
});

test('the blocker adapter wraps scripts once and preserves other results', () => {
  const styles = ['.ad { display: none }'];
  const blocker = {
    getCosmeticsFilters() {
      return { active: true, styles, scripts: ['first();', 'second();'] };
    },
  };

  installScriptletIsolation(blocker);
  installScriptletIsolation(blocker);
  const result = blocker.getCosmeticsFilters();

  assert.equal(result.active, true);
  assert.equal(result.styles, styles);
  assert.deepEqual(result.scripts, [
    "((scriptletGlobals) => {\nfirst();\n})(typeof globalThis.scriptletGlobals === 'undefined' ? (globalThis.scriptletGlobals = {}) : globalThis.scriptletGlobals);",
    "((scriptletGlobals) => {\nsecond();\n})(typeof globalThis.scriptletGlobals === 'undefined' ? (globalThis.scriptletGlobals = {}) : globalThis.scriptletGlobals);",
  ]);
});
