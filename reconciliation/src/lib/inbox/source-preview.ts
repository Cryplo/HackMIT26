// Read-only CSV display: keep quoted commas, escaped quotes, and multiline cells intact.
export function spreadsheetRows(text: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell); cell = '';
      if (char === '\n') { rows.push(row.splice(0)); }
    } else cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

// ponytail: presentation of readable text exports, not a MIME decoder. Unknown layouts retain raw text.
export function emailMessages(text: string) {
  return text.replace(/\r\n?/g, '\n').split(/(?=^On .+wrote:\s*$)/m).map(part => {
    const boundary = part.indexOf('\n\n');
    const header = boundary < 0 ? '' : part.slice(0, boundary);
    const field = (name: string) => header.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1] || '';
    const body = boundary < 0 ? part : part.slice(boundary + 2).trim();
    const attachments = body.match(/^Attachments:\s*(.+)$/m)?.[1].split(/[;,]/).map(name => name.trim()).filter(Boolean) || [];
    return { from: field('From'), to: field('To'), subject: field('Subject'),
      date: field('Sent') || field('Date') || header.match(/^On (.+) wrote:/m)?.[1] || '',
      body: body.replace(/^Attachments:\s*.+$/m, '').trim(), attachments };
  });
}
