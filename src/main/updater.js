const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// Auto-update = replacing the whole app (Chromium included) — same model
// Chrome itself uses. electron-updater reads the `build.publish` config
// (GitHub Releases) from the app-update.yml that electron-builder embeds
// at package time, so none of this runs in dev.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let updateDownloaded = false;

function promptRestart(info) {
  dialog
    .showMessageBox({
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      message: `Update ${info.version} downloaded`,
      detail: 'Restart to apply it. The update includes the latest Chromium engine.',
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return; // dev builds have nothing to update against

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    promptRestart(info);
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err.message);
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    if (!updateDownloaded) autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

/** Menu-triggered check with visible feedback. */
async function checkForUpdatesManually() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', message: 'Updates are only available in packaged builds.' });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      dialog.showMessageBox({
        type: 'info',
        message: 'You’re up to date',
        detail: `Bowser ${app.getVersion()} is the latest version.`,
      });
    }
    // If newer, the download starts automatically and the
    // update-downloaded handler prompts for restart.
  } catch (err) {
    dialog.showMessageBox({ type: 'warning', message: 'Update check failed', detail: err.message });
  }
}

module.exports = { setupAutoUpdater, checkForUpdatesManually };
