import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));

const nativeRoot = path.resolve('src-tauri');
const nsis = config.bundle.windows.nsis;
const wix = config.bundle.windows.wix;

describe('Windows installer resources', () => {
  it('provides correctly sized, uncompressed 24-bit BMPs for the native installer slots', () => {
    const images = [
      [nsis.sidebarImage, 164, 314], [nsis.headerImage, 150, 57],
      [wix.bannerPath, 493, 58], [wix.dialogImagePath, 493, 312],
    ];
    for (const [relativePath, width, height] of images) {
      const image = fs.readFileSync(path.join(nativeRoot, relativePath));
      expect(image.toString('ascii', 0, 2)).toBe('BM');
      expect(image.readUInt32LE(2)).toBe(image.length);
      expect(image.readUInt32LE(10)).toBe(54);
      expect(image.readUInt32LE(14)).toBe(40);
      expect(image.readInt32LE(18)).toBe(width);
      expect(image.readInt32LE(22)).toBe(height);
      expect(image.readUInt16LE(26)).toBe(1);
      expect(image.readUInt16LE(28)).toBe(24);
      expect(image.readUInt32LE(30)).toBe(0);
      expect(image.length).toBe(54 + ((width * 3 + 3) & ~3) * height);
    }
    const icon = fs.readFileSync(path.join(nativeRoot, nsis.installerIcon));
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBeGreaterThan(0);
  });

  it('resolves every custom page label and all Tauri 2.10.1 message keys in both languages', () => {
    // These are the required keys in the pinned CLI's NSIS language files.
    const required = `addOrReinstall alreadyInstalled alreadyInstalledLong appRunning
      appRunningOkKill chooseMaintenanceOption choowHowToInstall createDesktop
      dontUninstall dontUninstallDowngrade failedToKillApp installingWebview2
      newerVersionInstalled older olderOrUnknownVersionInstalled silentDowngrades
      unableToUninstall uninstallApp uninstallBeforeInstalling unknown webview2AbortError
      webview2DownloadError webview2DownloadSuccess webview2Downloading webview2InstallError
      webview2InstallSuccess deleteAppData`.split(/\s+/).filter(Boolean);
    const hooks = fs.readFileSync(path.join(nativeRoot, nsis.installerHooks), 'utf8');
    const pageLabels = [...hooks.matchAll(/\$\((FlashRun\w+)\)/g)].map((match) => match[1]);
    expect(pageLabels.length).toBeGreaterThan(0);
    for (const language of nsis.languages) {
      const file = nsis.customLanguageFiles[language];
      const contents = fs.readFileSync(path.join(nativeRoot, file), 'utf8');
      const messages = [...contents.matchAll(/^LangString (\w+) \$\{LANG_(\w+)\} "(.+)"$/gm)];
      const keys = messages.map((match) => match[1]);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.sort()).toEqual([...required, ...pageLabels].sort());
      expect(messages.every((match) => match[2] === language.toUpperCase())).toBe(true);
      expect(contents).not.toContain('\uFFFD');
    }
  });
});
