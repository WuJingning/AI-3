import zlib from 'node:zlib';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md', 'markdown'];

export function extensionOf(fileName = '') {
  const index = fileName.lastIndexOf('.');
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase();
}

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'text', 'json', 'csv']);

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/** 极简 ZIP 读取：仅用于从 .docx 中取出 word/document.xml，避免引入第三方依赖。 */
function readZipEntry(buffer, targetName) {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  const start = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    if (name === targetName) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      return null;
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function docxToText(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml');
  if (!xml) return '';
  const content = xml.toString('utf8');
  return decodeXmlEntities(
    content
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 尽量在本地提取可展示的合同文本。
 * PDF / DOC 由扣子工作流侧解析，本地不做不可靠的解析，返回 notSupported。
 */
export function extractText(fileName, buffer) {
  const ext = extensionOf(fileName);
  if (TEXT_EXTENSIONS.has(ext)) {
    return { ok: true, text: buffer.toString('utf8').replace(/^\uFEFF/, '').trim(), kind: 'text' };
  }
  if (ext === 'docx') {
    try {
      const text = docxToText(buffer);
      if (text) return { ok: true, text, kind: 'docx' };
      return { ok: false, reason: 'docx-parse-failed' };
    } catch {
      return { ok: false, reason: 'docx-parse-failed' };
    }
  }
  return { ok: false, reason: 'not-supported-locally', kind: ext };
}
