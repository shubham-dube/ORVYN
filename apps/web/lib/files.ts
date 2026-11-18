/** The type a stored file most likely has, from its name (for files whose type wasn't kept on the item). */
const BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  weba: 'audio/webm',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

export function mimeFromName(name: string, fallback = 'application/octet-stream'): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase();
  // "voice-….webm" is a voice note; other .webm files are most often video
  if (ext === 'webm' && !/^voice-/i.test(name)) return 'video/webm';
  return (ext && BY_EXT[ext]) || fallback;
}
