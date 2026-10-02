import 'server-only';

import { inflateRawSync } from 'node:zlib';

export const H5P_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const H5P_MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 4_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

export class H5PValidationError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export interface H5PDependency { machineName: string; majorVersion: number; minorVersion: number }
interface H5PLibrary extends H5PDependency {
  patchVersion?: number;
  preloadedDependencies?: H5PDependency[];
  dynamicDependencies?: H5PDependency[];
  preloadedJs?: Array<{ path: string }>;
  preloadedCss?: Array<{ path: string }>;
}
export interface H5PPackage {
  title: string;
  mainLibrary: string;
  files: Map<string, Uint8Array>;
  expandedBytes: number;
  libraries: string[];
}

/** One canonical representation for ZIP entries and the authenticated file route. */
export function validateH5PPath(value: string, directory = false): string {
  const name = directory && value.endsWith('/') ? value.slice(0, -1) : value;
  if (!name || name.length > 512 || /[\\:%\u0000-\u001f\u007f]/.test(name) || name.startsWith('/') ||
    name.split('/').some(part => !part || part === '.' || part === '..' || part.length > 180 || /[. ]$/.test(part))) {
    throw new H5PValidationError('Das H5P-Paket enthält einen ungültigen Dateipfad.');
  }
  return name;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Inspect every central/local header before decompressing, then bound actual output. */
export function extractH5PArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22 || bytes.length > H5P_MAX_ARCHIVE_BYTES) throw new H5PValidationError('Die H5P-Datei ist leer oder größer als 50 MB.', bytes.length > H5P_MAX_ARCHIVE_BYTES ? 413 : 400);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && u32(end) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65_557) || u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length) throw new H5PValidationError('Die Datei ist kein vollständiges ZIP-/H5P-Paket.');
  const count = u16(end + 10);
  const centralSize = u32(end + 12);
  const centralStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count || count > MAX_ENTRIES || centralStart + centralSize !== end) throw new H5PValidationError('Mehrteilige, ZIP64- oder zu umfangreiche H5P-Archive werden nicht unterstützt.');
  const entries: Array<{ name: string; compressed: number; expanded: number; dataStart: number; method: number; crc: number; directory: boolean }> = [];
  const names = new Set<string>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let cursor = centralStart;
  let total = 0;
  try {
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw new H5PValidationError('Das ZIP-Verzeichnis ist beschädigt.');
      const flags = u16(cursor + 8);
      const method = u16(cursor + 10);
      const compressed = u32(cursor + 20);
      const expanded = u32(cursor + 24);
      const nameLength = u16(cursor + 28);
      const next = cursor + 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
      const offset = u32(cursor + 42);
      if (next > end || u16(cursor + 34) !== 0 || flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || expanded === 0xffffffff || offset === 0xffffffff) throw new H5PValidationError('Verschlüsselte oder ungültige H5P-Archive werden nicht unterstützt.');
      const archiveName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      const directory = archiveName.endsWith('/');
      const name = validateH5PPath(archiveName, directory);
      const fileMode = u32(cursor + 38) >>> 16;
      const fileType = fileMode & 0xf000;
      if (fileType && fileType !== 0x8000 && fileType !== 0x4000) throw new H5PValidationError('Verknüpfungen und spezielle Dateien sind in H5P-Paketen nicht erlaubt.');
      if (names.has(name)) throw new H5PValidationError('Das H5P-Paket enthält doppelte Dateipfade.');
      names.add(name);
      total += expanded;
      if (expanded > MAX_ENTRY_BYTES || total > H5P_MAX_EXPANDED_BYTES || (compressed > 0 && expanded / compressed > 2_000)) throw new H5PValidationError('Das entpackte H5P-Paket ist zu groß.', 413);
      if (offset + 30 > centralStart || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) throw new H5PValidationError('ZIP-Dateikopf und Verzeichnis stimmen nicht überein.');
      const localNameLength = u16(offset + 26);
      const dataStart = offset + 30 + localNameLength + u16(offset + 28);
      if (dataStart + compressed > centralStart || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== archiveName || (!(flags & 8) && (u32(offset + 18) !== compressed || u32(offset + 22) !== expanded || u32(offset + 14) !== u32(cursor + 16)))) throw new H5PValidationError('Das H5P-Paket enthält widersprüchliche Dateidaten.');
      if ((directory && expanded !== 0) || (method === 0 && compressed !== expanded)) throw new H5PValidationError('Das H5P-Paket enthält ungültige Datei-/Verzeichnisgrößen.');
      entries.push({ name, compressed, expanded, dataStart, method, crc: u32(cursor + 16), directory });
      cursor = next;
    }
    if (cursor !== end) throw new H5PValidationError('Das ZIP-Verzeichnis ist unvollständig.');
    const files = new Map<string, Uint8Array>();
    for (const entry of entries) {
      const compressedBytes = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
      let output: Uint8Array;
      if (entry.method === 0) output = new Uint8Array(compressedBytes);
      else {
        // Native zlib enforces the output cap while inflating, including when
        // an attacker lies about the original size in both ZIP headers.
        output = new Uint8Array(inflateRawSync(compressedBytes, { maxOutputLength: Math.max(1, entry.expanded) }));
        if (output.length !== entry.expanded) throw new H5PValidationError('Die entpackte Dateigröße stimmt nicht mit dem ZIP-Verzeichnis überein.');
      }
      if (crc32(output) !== entry.crc) throw new H5PValidationError('Die Prüfsumme einer H5P-Datei ist ungültig.');
      if (!entry.directory) files.set(entry.name, output);
    }
    return files;
  } catch (error) {
    if (error instanceof H5PValidationError) throw error;
    throw new H5PValidationError('Das H5P-Archiv ist beschädigt oder kann nicht sicher entpackt werden.');
  }
}

function jsonFile(files: Map<string, Uint8Array>, name: string): Record<string, unknown> {
  const bytes = files.get(name);
  if (!bytes || bytes.length > MAX_JSON_BYTES) throw new H5PValidationError(`Die Datei ${name} fehlt oder ist zu groß.`);
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new H5PValidationError(`Die Datei ${name} enthält ungültige JSON-Daten.`); }
}
function dependency(value: unknown): H5PDependency {
  const item = value as H5PDependency | null;
  if (!item || typeof item !== 'object' || typeof item.machineName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(item.machineName) || !Number.isInteger(item.majorVersion) || item.majorVersion < 0 || item.majorVersion > 10_000 || !Number.isInteger(item.minorVersion) || item.minorVersion < 0 || item.minorVersion > 10_000) throw new H5PValidationError('Eine H5P-Bibliotheksabhängigkeit ist ungültig.');
  return item;
}
function dependencies(value: unknown): H5PDependency[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) throw new H5PValidationError('Die H5P-Bibliotheksabhängigkeiten sind ungültig.');
  return value.map(dependency);
}
export function h5pLibraryFolder(value: H5PDependency) { return `${value.machineName}-${value.majorVersion}.${value.minorVersion}`; }

export function validateH5PPackage(bytes: Uint8Array): H5PPackage {
  const files = extractH5PArchive(bytes);
  const manifest = jsonFile(files, 'h5p.json');
  jsonFile(files, 'content/content.json');
  if (typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 300 || typeof manifest.mainLibrary !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(manifest.mainLibrary)) throw new H5PValidationError('Das H5P-Paket hat keinen gültigen Titel oder Inhaltstyp.');
  const libraries = new Map<string, H5PLibrary>();
  for (const name of files.keys()) {
    if (!/^[^/]+\/library\.json$/.test(name)) continue;
    const library = jsonFile(files, name);
    const dep = dependency(library);
    const folder = h5pLibraryFolder(dep);
    if (name !== `${folder}/library.json` || libraries.has(folder)) throw new H5PValidationError('Bibliotheksname und H5P-Verzeichnis stimmen nicht überein.');
    libraries.set(folder, library as unknown as H5PLibrary);
    for (const key of ['preloadedJs', 'preloadedCss']) {
      const assets = library[key];
      if (assets === undefined) continue;
      if (!Array.isArray(assets) || assets.length > 500) throw new H5PValidationError('Eine H5P-Bibliothek hat ungültige Ressourcen.');
      for (const asset of assets) {
        if (!asset || typeof asset.path !== 'string' || !files.has(`${folder}/${validateH5PPath(asset.path)}`)) throw new H5PValidationError(`Eine benötigte Ressource der Bibliothek ${folder} fehlt.`);
      }
    }
  }
  const preloadedDependencies = dependencies(manifest.preloadedDependencies);
  const rootDependencies = [...preloadedDependencies, ...dependencies(manifest.dynamicDependencies)];
  if (!preloadedDependencies.some(dep => dep.machineName === manifest.mainLibrary)) throw new H5PValidationError('Die Hauptbibliothek ist nicht in den H5P-Abhängigkeiten enthalten.');
  for (const dep of rootDependencies) if (!libraries.has(h5pLibraryFolder(dep))) throw new H5PValidationError(`Die Bibliothek ${h5pLibraryFolder(dep)} fehlt. Bitte exportieren Sie die .h5p-Datei mit allen Bibliotheken.`);
  for (const [folder, library] of libraries) {
    for (const dep of [...dependencies(library.preloadedDependencies), ...dependencies(library.dynamicDependencies)]) if (!libraries.has(h5pLibraryFolder(dep))) throw new H5PValidationError(`Die Bibliothek ${h5pLibraryFolder(dep)} für ${folder} fehlt.`);
  }
  // Runtime preload cycles cannot be resolved by the standalone player.
  const completed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (folder: string) => {
    if (visiting.has(folder)) throw new H5PValidationError('Die H5P-Bibliotheken enthalten einen Abhängigkeitszyklus.');
    if (completed.has(folder)) return;
    visiting.add(folder);
    for (const dep of dependencies(libraries.get(folder)?.preloadedDependencies)) visit(h5pLibraryFolder(dep));
    visiting.delete(folder); completed.add(folder);
  };
  for (const folder of libraries.keys()) visit(folder);
  return { title: manifest.title.trim(), mainLibrary: manifest.mainLibrary, files, expandedBytes: [...files.values()].reduce((sum, value) => sum + value.length, 0), libraries: [...libraries.keys()] };
}
