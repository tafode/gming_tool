//! A minimal PDF writer, so the extraction tests need no binary fixture:
//! one page of plain text per entry is all the text extractor has to read.
//!
//! Everything written is ASCII, so string lengths and byte offsets agree.

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

export function buildTextPdf(pages: readonly string[]): Uint8Array {
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  // Object 1 is the catalog, 2 the page tree, then two objects per page, then
  // a single shared font.
  const fontId = 3 + pages.length * 2;

  pages.forEach((_page, index) => {
    pageIds.push(3 + index * 2);
    contentIds.push(4 + index * 2);
  });

  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );

  pages.forEach((text, index) => {
    objects.set(
      pageIds[index],
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        `/Contents ${contentIds[index]} 0 R ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
    const stream = `BT /F1 12 Tf 36 756 Td (${escapeText(text)}) Tj ET`;
    objects.set(contentIds[index], `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  objects.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const size = fontId + 1;
  let file = '%PDF-1.4\n';
  const offsets = new Map<number, number>();

  for (let id = 1; id <= fontId; id += 1) {
    offsets.set(id, file.length);
    file += `${id} 0 obj\n${objects.get(id) ?? 'null'}\nendobj\n`;
  }

  const xrefAt = file.length;
  file += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) {
    file += `${String(offsets.get(id) ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  file += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new TextEncoder().encode(file);
}
