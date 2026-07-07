// Mutable state shared across hooks, the World, and step definitions:
// the launched Electron app handle, the local fixtures base URL, and the
// per-scenario map of logical page names -> tab ids (reset in a Before hook).
module.exports = {
  app: null,
  fixturesBase: null,
  tabByName: {},
  activeExpectedUrl: null,
  lastNewTabId: null,
};
