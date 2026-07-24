import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron } from 'playwright';

const stableExecutable = process.env.BLANC_STABLE_EXECUTABLE;
const candidateExecutable =
  process.env.BLANC_CANDIDATE_EXECUTABLE ||
  path.resolve('dist/mac-arm64/Blanc.app/Contents/MacOS/Blanc');

for (const [label, executable] of [
  ['BLANC_STABLE_EXECUTABLE', stableExecutable],
  ['BLANC_CANDIDATE_EXECUTABLE', candidateExecutable],
]) {
  if (!executable || !fs.existsSync(executable)) {
    throw new Error(`${label} does not point to a packaged Blanc executable`);
  }
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-stable-migration-'));
const favoriteUrl = 'https://example.com/favorite';
const sessionUrls = ['https://example.com/', 'https://www.wikipedia.org/'];
let app;

const writeJson = (name, value) => fs.writeFileSync(
  path.join(userDataDir, name),
  JSON.stringify(value, null, 2)
);

const launch = async (executablePath) => {
  app = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, BLANC_TEST: '0' },
  });
  await app.firstWindow();
};

const waitForRestoredUrls = async () => {
  const deadline = Date.now() + 15_000;
  let urls = [];
  while (Date.now() < deadline) {
    urls = await app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((candidate) => candidate.getURL())
    );
    if (sessionUrls.every((expected) => urls.includes(expected))) return urls;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`session URLs were not restored; saw ${JSON.stringify(urls)}`);
};

try {
  const now = Date.now();
  writeJson('settings.json', {
    searchEngine: 'brave',
    searchSuggestions: false,
    adblockEnabled: false,
    homePage: '',
    theme: 'dark',
    appIcon: 'paper',
    adblockExceptions: ['example.com'],
    usagePing: false,
  });
  writeJson('session.json', {
    urls: sessionUrls,
    activeIndex: 1,
    groups: [{ id: 'migration-group', name: 'research', collapsed: false }],
    groupIds: ['migration-group', 'migration-group'],
    pinned: [true, false],
  });
  writeJson('bookmarks.json', {
    items: [{
      id: 'migration-favorite',
      url: favoriteUrl,
      title: 'Migration favorite',
      favicon: null,
      addedAt: now,
      updatedAt: now,
      folder: 'press',
    }],
    tombstones: [],
  });
  writeJson('history.json', {
    entries: [{
      url: 'https://example.com/history',
      title: 'Migration history',
      visitedAt: now,
    }],
  });

  // Launch the real public Stable first so the fixture is proven acceptable
  // to that build, then hand the exact same profile to the candidate.
  await launch(stableExecutable);
  await waitForRestoredUrls();
  await app.close();
  app = null;

  await launch(candidateExecutable);
  await waitForRestoredUrls();

  const settings = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')
  );
  assert.equal(settings.searchEngine, 'brave');
  assert.equal(settings.searchSuggestions, false);
  assert.equal(settings.usagePing, false);
  assert.equal(settings.onboardingVersion, 1, 'legacy profile should skip first-run');

  const bookmarks = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'bookmarks.json'), 'utf8')
  );
  assert.ok(bookmarks.items.some((item) => item.url === favoriteUrl));

  const history = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'history.json'), 'utf8')
  );
  assert.ok(history.entries.some((entry) => entry.title === 'Migration history'));

  console.log(
    `packaged-migration-smoke OK: ${path.basename(path.resolve(stableExecutable, '../../..'))} -> candidate`
  );
} finally {
  if (app) await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
