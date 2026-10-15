import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentViewer } from '../src/components/DocumentViewer';
import type { PdfDocumentInfo } from '../src/pdf/library';

const PDF: PdfDocumentInfo = {
  path: 'adventures/Lost Mine.pdf',
  name: 'Lost Mine',
  size: 1024,
  modified: 1700000001,
  kind: 'pdf',
};

const WORD: PdfDocumentInfo = {
  path: 'notes.docx',
  name: 'notes',
  size: 2048,
  modified: 1700000002,
  kind: 'office',
};

afterEach(cleanup);

describe('the document viewer', () => {
  it('asks for a document when none is chosen', () => {
    render(
      <DocumentViewer
        document={null}
        page={1}
        revision={0}
        converter="soffice"
        preparing={false}
        error={null}
      />,
    );

    expect(screen.getByText(/Pick a document/)).toBeTruthy();
  });

  it('reads a PDF in the browser’s own viewer', () => {
    render(
      <DocumentViewer
        document={PDF}
        page={1}
        revision={0}
        converter="soffice"
        preparing={false}
        error={null}
      />,
    );

    const viewer = screen.getByTitle('Lost Mine — page 1') as HTMLIFrameElement;
    expect(viewer.getAttribute('src')).toBe('/pdfs/adventures/Lost%20Mine.pdf#page=1');
  });

  it('escapes a document folder it has to reach through a path', () => {
    render(
      <DocumentViewer
        document={PDF}
        page={4}
        revision={2}
        converter="soffice"
        preparing={false}
        error={null}
      />,
    );

    const viewer = screen.getByTitle('Lost Mine — page 4') as HTMLIFrameElement;
    expect(viewer.getAttribute('src')).toBe('/pdfs/adventures/Lost%20Mine.pdf#page=4');
  });

  it('says it is converting an office document rather than showing a blank frame', () => {
    render(
      <DocumentViewer
        document={WORD}
        page={1}
        revision={0}
        converter="soffice"
        preparing
        error={null}
      />,
    );

    expect(screen.getByText(/Converting notes/)).toBeTruthy();
    expect(screen.queryByTitle('notes — page 1')).toBeNull();
  });

  it('explains when office documents cannot be read', () => {
    render(
      <DocumentViewer
        document={WORD}
        page={1}
        revision={0}
        converter={null}
        preparing={false}
        error={null}
      />,
    );

    expect(screen.getByText(/Install LibreOffice/)).toBeTruthy();
  });

  it('shows why opening a document failed', () => {
    render(
      <DocumentViewer
        document={WORD}
        page={1}
        revision={0}
        converter="soffice"
        preparing={false}
        error="the document could not be converted"
      />,
    );

    expect(screen.getByText(/could not be converted/)).toBeTruthy();
  });
});
