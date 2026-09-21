/**
 * Minimal, dependency-light .docx export.
 *
 * A .docx is just a ZIP of a few XML parts. We build the smallest valid Word
 * document (paragraphs + headings) with JSZip, write it to the device, and hand
 * it to the OS share sheet. No native docx renderer needed; works in Expo Go and
 * standalone builds.
 */
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type Block = { text: string; heading?: 1 | 2; bold?: boolean };

function esc(s: string) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraph(b: Block) {
  const styleMap: Record<number, string> = { 1: 'Heading1', 2: 'Heading2' };
  const pStyle = b.heading ? `<w:pStyle w:val="${styleMap[b.heading]}"/>` : '';
  const runProps = b.bold || b.heading ? '<w:rPr><w:b/></w:rPr>' : '';
  // Preserve line breaks within a block.
  const runs = esc(b.text)
    .split('\n')
    .map((line, i) => (i === 0 ? '' : '<w:br/>') + `<w:r>${runProps}<w:t xml:space="preserve">${line}</w:t></w:r>`)
    .join('');
  return `<w:p><w:pPr>${pStyle}</w:pPr>${runs}</w:p>`;
}

function documentXml(blocks: Block[]) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    blocks.map(paragraph).join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

function safeName(s: string) {
  return (s || 'document').replace(/[^\w.-]+/g, '_').slice(0, 60);
}

/** Build the .docx, save to a temp file, return its URI. */
export async function buildDocx(filename: string, blocks: Block[]): Promise<string> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels')!.file('.rels', ROOT_RELS);
  zip.folder('word')!.file('document.xml', documentXml(blocks));
  const base64 = await zip.generateAsync({ type: 'base64' });
  const uri = `${FileSystem.cacheDirectory}${safeName(filename)}.docx`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/** Build + open the share sheet so the user can save/send the .docx. */
export async function exportDocx(filename: string, blocks: Block[]): Promise<void> {
  const uri = await buildDocx(filename, blocks);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      dialogTitle: filename,
      UTI: 'org.openxmlformats.wordprocessingml.document',
    });
  }
}
