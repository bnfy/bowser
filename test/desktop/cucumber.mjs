// Cucumber configuration for the DESKTOP acceptance run. The shared, platform-
// neutral .feature files live in spec/acceptance/; this profile binds them to
// the desktop (Electron) step definitions in test/desktop/.
//
// Profiles:
//   runnable  - the subset currently implemented against the shipping app
//               (drivable via main-process state). This is what CI runs green.
//   dry       - `runnable` under --dry-run: verifies every selected step
//               resolves to a definition without launching Electron.
//   default   - every desktop-applicable scenario (`not @mobile`). Runs the
//               implemented subset and reports the rest as UNDEFINED — an
//               honest view of the remaining backlog.
//
// Run with, e.g.:  xvfb-run -a npx cucumber-js -c test/desktop/cucumber.mjs -p runnable

const common = {
  paths: ['spec/acceptance/**/*.feature'],
  require: ['test/desktop/support/**/*.js', 'test/desktop/steps/**/*.js'],
};

// The scenarios implemented in steps/ (by their stable @F#-n ids).
const RUNNABLE = [
  '@F2-1', '@F2-2', '@F2-3', '@F2-4',
  '@F3-1', '@F3-4', '@F3-5',
  '@F4-4', '@F4-5',
  '@F5-1', '@F5-2', '@F5-3', '@F5-4', '@F5-5',
  '@F7-2',
  '@F9-1', '@F9-2',
  '@F10-2',
  '@F12-3',
  '@F14-1', '@F14-2', '@F14-3', '@F14-4',
  '@F16-2', '@F16-3', '@F16-4', '@F16-5', '@F16-6', '@F16-7',
  '@F17-1',
  '@F28-1', '@F28-2', '@F28-3', '@F28-4', '@F28-5', '@F28-6',
  '@F28-7', '@F28-8', '@F28-9', '@F28-10', '@F28-11', '@F28-12',
].join(' or ');

export default { ...common, tags: 'not @mobile' };
export const runnable = { ...common, tags: RUNNABLE };
export const dry = { ...common, tags: RUNNABLE, dryRun: true };
