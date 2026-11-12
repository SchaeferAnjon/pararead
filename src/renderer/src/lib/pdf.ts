import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api } from '../api'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }

export async function loadPdf(paperId: string): Promise<pdfjs.PDFDocumentProxy> {
  const data = await api.pdfData(paperId)
  return pdfjs.getDocument({
    data,
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './pdfjs/standard_fonts/',
    wasmUrl: './pdfjs/wasm/',
    iccUrl: './pdfjs/iccs/'
  }).promise
}
