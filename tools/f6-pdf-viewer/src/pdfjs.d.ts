/** pdfjs-dist の ESM build には型がパス解決されないため最小宣言を置く。 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export interface PdfViewport {
    width: number;
    height: number;
  }
  export interface PdfPage {
    getViewport(opts: { scale: number }): PdfViewport;
    render(opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }): { promise: Promise<void> };
  }
  export interface PdfDocument {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
  }
  export function getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfDocument> };
  export const GlobalWorkerOptions: { workerSrc: string };
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?raw' {
  const src: string;
  export default src;
}
