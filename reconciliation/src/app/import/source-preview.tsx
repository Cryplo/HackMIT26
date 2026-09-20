import { FileSpreadsheet, Paperclip } from 'lucide-react';
import { emailMessages, spreadsheetRows } from '@/lib/inbox/source-preview';
import type { SourceSample } from './source-workbench';
import styles from './source-workbench.module.css';

export function SourcePreview({ sample }: { sample: SourceSample }) {
  if (sample.file_type.startsWith('image/')) return <div className={styles.imageStage}><img className={styles.image} src={sample.url} alt={`Original receipt ${sample.name}`} /></div>;
  if (sample.file_type === 'text/csv') {
    const [headers = [], ...rows] = spreadsheetRows(sample.preview);
    return <div className={styles.spreadsheet}>
      <div className={styles.sheetTitle}><FileSpreadsheet size={19} aria-hidden="true" /><span>Form responses<small>{sample.name}</small></span><span className={styles.readOnly}>Read only</span></div>
      <div className={styles.sheetScroll} tabIndex={0} role="region" aria-label="Form response spreadsheet">
        <table><caption className="sr-only">Form response data from {sample.name}</caption><thead>
          <tr className={styles.columnLetters} aria-hidden="true"><td /><>{headers.map((_, index) => <td key={index}>{String.fromCharCode(65 + index)}</td>)}</></tr>
          <tr><th scope="row">1</th>{headers.map((header, index) => <th scope="col" key={index}>{header}</th>)}</tr>
        </thead><tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{index + 2}</th>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table>
      </div>
      <div className={styles.sheetFooter}><strong>Responses</strong><span>{rows.length} response{rows.length === 1 ? '' : 's'} · {headers.length} columns</span></div>
    </div>;
  }
  if (sample.source === 'email' || sample.file_type === 'message/rfc822') {
    const messages = emailMessages(sample.preview);
    if (messages.every(message => message.from)) return <section className={styles.mailThread} aria-label="Email conversation">
      <div className={styles.mailSubject}><h3>{messages[0].subject || sample.name}</h3><span>{messages.length} messages</span></div>
      {messages.map((message, index) => <article className={styles.mailMessage} key={index} aria-label={`Message from ${message.from}`}>
        <div className={styles.mailSender}><span className={styles.avatar} aria-hidden="true">{message.from[0].toUpperCase()}</span><div><strong>{message.from}</strong><small>to {message.to || 'recipient not stated'}</small></div></div>
        {message.date && <p className={styles.mailDate}>{message.date}</p>}
        <div className={styles.mailBody}>{message.body}</div>
        {!!message.attachments.length && <div className={styles.attachments} aria-label="Referenced attachments">{message.attachments.map(name => <span key={name}><Paperclip size={13} aria-hidden="true" />{name}</span>)}</div>}
      </article>)}
      <details className={styles.sourceText}><summary>View source text</summary><pre>{sample.preview}</pre></details>
    </section>;
  }
  if (sample.file_type === 'application/pdf') return <object className={styles.pdfPreview} data={`${sample.url}#toolbar=0&navpanes=0&view=FitH`} type="application/pdf" aria-label={`PDF preview: ${sample.name}`}><p>PDF preview unavailable. <a href={sample.url} target="_blank" rel="noreferrer">Open the original PDF</a>.</p></object>;
  return <pre>{sample.preview}</pre>;
}
