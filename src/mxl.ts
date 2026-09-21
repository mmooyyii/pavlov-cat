// Reader for .mxl — the zipped MusicXML that MuseScore, Sibelius and most
// download sites hand out by default. A container that small doesn't justify a
// zip dependency: we walk the central directory by hand and let the browser's
// DecompressionStream do the inflating.
//
// Scope: stored (method 0) and deflate (method 8) entries, no zip64, no
// encryption — everything a real .mxl uses.

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

// The end-of-central-directory record sits at the very end, unless the archive
// carries a trailing comment — so scan backwards over the comment's max range.
function findEocd(view: DataView): number {
  const max = Math.min(view.byteLength, EOCD_MIN + 0xffff);
  for (let i = EOCD_MIN; i <= max; i++) {
    const at = view.byteLength - i;
    if (view.getUint32(at, true) === EOCD_SIG) return at;
  }
  return -1;
}

function readCentralDirectory(view: DataView, bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('不是有效的 .mxl 压缩包');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  const utf8 = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CD_SIG) break;
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    entries.push({
      name: utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(entry: ZipEntry, view: DataView, bytes: Uint8Array): Promise<Uint8Array> {
  const at = entry.localOffset;
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_SIG) {
    throw new Error(`压缩包损坏:${entry.name}`);
  }
  // Name/extra lengths come from the local header — they may differ from the
  // central directory's copies.
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`不支持的压缩方式(${entry.method})`);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('这个浏览器不支持解压 .mxl,请换新版 Chrome / Safari,或导出未压缩的 .musicxml');
  }
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// MusicXML text may be UTF-8 or UTF-16; honour the BOM when there is one.
function decodeXml(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

// The container names the real score; only fall back to guessing when it's
// missing or unreadable (some exporters ship a bare zip).
function pickScoreName(containerXml: string | null, entries: readonly ZipEntry[]): string | null {
  if (containerXml) {
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const path = doc.querySelector('rootfile')?.getAttribute('full-path');
    if (path && entries.some(e => e.name === path)) return path;
  }
  return entries.find(e =>
    !e.name.startsWith('META-INF/') &&
    !e.name.endsWith('/') &&
    /\.(musicxml|xml)$/i.test(e.name),
  )?.name ?? null;
}

/** Extract the MusicXML document from a .mxl archive, as text. */
export async function readMxl(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const entries = readCentralDirectory(view, bytes);
  if (!entries.length) throw new Error('压缩包是空的');

  const containerEntry = entries.find(e => e.name === 'META-INF/container.xml');
  let containerXml: string | null = null;
  if (containerEntry) {
    try { containerXml = decodeXml(await readEntry(containerEntry, view, bytes)); } catch { /* guess instead */ }
  }

  const name = pickScoreName(containerXml, entries);
  if (!name) throw new Error('压缩包里没有找到 MusicXML');
  const target = entries.find(e => e.name === name);
  if (!target) throw new Error('压缩包里没有找到 MusicXML');
  return decodeXml(await readEntry(target, view, bytes));
}
