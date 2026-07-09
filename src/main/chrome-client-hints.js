function chromeClientHintPlatform(platform = process.platform) {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function chromeClientHintArchitecture(arch = process.arch) {
  if (arch === 'arm64') return 'arm';
  if (arch === 'x64' || arch === 'ia32') return 'x86';
  return arch;
}

function chromeClientHintBitness(arch = process.arch) {
  return arch.includes('64') ? '64' : '32';
}

function chromeClientHintPlatformVersion(platform = process.platform, systemVersion) {
  // Chrome sends the macOS product version, while Windows/Linux desktop
  // expose an empty high-entropy platform-version value in this profile.
  if (platform !== 'darwin') return '';
  const value = systemVersion ??
    (typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '');
  if (!value) return '';
  const parts = String(value).split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

module.exports = {
  chromeClientHintPlatform,
  chromeClientHintArchitecture,
  chromeClientHintBitness,
  chromeClientHintPlatformVersion,
};
