import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { validateWorkbookArchive } from "./zip-validation";
export async function validateDocument(buffer: Buffer, mime: string) {
  if (mime === "application/pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid PDF signature.");
    const pdf = await PDFDocument.load(buffer);
    if (pdf.getPageCount() > 500) throw new Error("PDF limit is 500 pages.");
    return pdf.getPageCount();
  }
  if (mime === "image/png") {
    if (
      !buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Invalid PNG signature.");
    return 1;
  }
  if (mime === "image/jpeg") {
    if (buffer[0] !== 255 || buffer[1] !== 216 || buffer[2] !== 255)
      throw new Error("Invalid JPEG signature.");
    return 1;
  }
  if (mime.includes("spreadsheetml")) {
    if (buffer.readUInt16LE(0) !== 0x4b50)
      throw new Error("Invalid XLSX signature.");
    await validateWorkbookArchive(buffer);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    if (wb.worksheets.reduce((n, s) => n + s.rowCount, 0) > 10000)
      throw new Error("Workbook exceeds 10,000 rows.");
    return 1;
  }
  if (buffer.includes(0)) throw new Error("Text file contains binary data.");
  new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  return 1;
}
