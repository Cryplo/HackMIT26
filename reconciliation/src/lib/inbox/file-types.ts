import { detectType, IntakeError } from '../intake/schema';
import { spreadsheetRows } from './source-preview';

export function inboxFileType(bytes: Uint8Array, declared: string, name: string): string {
  const extension = name.split('.').at(-1)?.toLowerCase();
  const textType = extension === 'csv' ? 'text/csv' : extension === 'eml' ? 'message/rfc822' : extension === 'txt' ? 'text/plain' : null;
  if (!textType) {
    try { return detectType(bytes, declared); }
    catch { throw new IntakeError('unsupported_file', 'Supported formats: PDF, PNG, JPG, CSV, TXT, and EML. This file could not be read.', 415); }
  }
  if (bytes.length > 100000) throw new IntakeError('unsupported_file', 'Text, CSV, and email exports must be under 100 KB.', 415);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new IntakeError('unsupported_file', 'Use a UTF-8 text, CSV, or email export.', 415); }
  if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new IntakeError('unsupported_file', 'This file is not a readable text export.', 415);
  if (extension === 'eml' && !/^From:/im.test(text)) throw new IntakeError('unsupported_file', 'The email export needs a From header.', 415);
  if (extension === 'csv' && spreadsheetRows(text).filter(row => row.some(cell => cell.trim())).length !== 2) {
    throw new IntakeError('multiple_requests', 'Upload one CSV response with its header. In the spreadsheet, choose a response row and parse or download that row.', 415);
  }
  return textType;
}
