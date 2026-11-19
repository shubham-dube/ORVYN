/**
 * Where people download ORVYN (spec 0007 C4). By default, the newest GitHub Release, whose files always have the
 * same names (see .github/workflows/release.yml); override with env when the store listings exist.
 */
const BASE =
  process.env.NEXT_PUBLIC_DOWNLOAD_BASE ?? 'https://github.com/shubham-dube/ORVYN/releases/latest/download';

export const DOWNLOADS = {
  android: process.env.NEXT_PUBLIC_ANDROID_URL ?? `${BASE}/orvyn-android.apk`,
  windows: process.env.NEXT_PUBLIC_WINDOWS_URL ?? `${BASE}/orvyn-windows-setup.exe`,
  /** the Chrome Web Store listing once published; until then the zip to load unpacked */
  chromeStore: process.env.NEXT_PUBLIC_CHROME_STORE_URL ?? null,
  chromeZip: `${BASE}/orvyn-chrome-extension.zip`,
  releases: BASE.replace(/\/latest\/download$/, ''),
};

/** Where people reach the founder: NEXT_PUBLIC_CONTACT_EMAIL, else the project's issues page. */
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL
  ? `mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}`
  : 'https://github.com/shubham-dube/ORVYN/issues';
