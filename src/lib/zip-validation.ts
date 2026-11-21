import { fromBuffer } from "yauzl";
/** Validate expansion limits by streaming every entry before ExcelJS allocates workbook XML. */
export function validateWorkbookArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new Error("Invalid workbook archive."));
          return;
        }
        let entries = 0,
          total = 0,
          done = false;
        const fail = (error: Error) => {
          if (done) return;
          done = true;
          zip.close();
          reject(error);
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!done) {
            done = true;
            resolve();
          }
        });
        zip.on("entry", (entry) => {
          if (
            ++entries > 10000 ||
            entry.uncompressedSize > 32 * 1024 * 1024 ||
            (entry.generalPurposeBitFlag & 1) !== 0
          ) {
            fail(new Error("Workbook archive exceeds safe expansion limits."));
            return;
          }
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              fail(new Error("Workbook archive cannot be read."));
              return;
            }
            stream.on("error", fail);
            stream.on("data", (chunk: Buffer) => {
              total += chunk.length;
              if (total > 64 * 1024 * 1024) {
                stream.destroy();
                fail(new Error("Workbook expands beyond 64 MB."));
              }
            });
            stream.on("end", () => {
              if (!done) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
