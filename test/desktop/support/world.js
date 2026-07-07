const { setWorldConstructor } = require('@cucumber/cucumber');
const ctx = require('./context');

// The World is the per-scenario `this` in steps. It wraps the running Electron
// app with a generic bridge into the test hook (globalThis.__blanc) plus a few
// polling helpers for the parts of app state that settle asynchronously
// (a WebContentsView's URL isn't final until its navigation commits).
class BlancWorld {
  /** Invoke a globalThis.__blanc method in the Electron main process. */
  async call(method, ...args) {
    return ctx.app.evaluate(
      (_electron, p) => globalThis.__blanc[p.m](...p.a),
      { m: method, a: args }
    );
  }

  /** Snapshot of tab/group/active state from the main process. */
  state() {
    return this.call('state');
  }

  /** Poll state() until `predicate(state)` is truthy, or throw on timeout. */
  async waitForState(predicate, { timeout = 5000, interval = 100 } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      last = await this.state();
      if (predicate(last)) return last;
      if (Date.now() > deadline) {
        throw new Error(`waitForState timed out; last state: ${JSON.stringify(last)}`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** Local, offline-loadable URL for a logical page name. */
  fixtureUrl(name) {
    return `${ctx.fixturesBase}/site/${encodeURIComponent(name)}`;
  }
}

setWorldConstructor(BlancWorld);
