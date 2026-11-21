"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { categories, type Drawing } from "@/lib/schemas";
const mimes: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
};
export default function Uploads({
  send,
  onDone,
}: {
  send: (action: string, data: unknown, id?: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  return (
    <form
      className="panel upload-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const values = new FormData(form);
        const file = values.get("file") as File;
        setError("");
        setProgress(0);
        try {
          if (file.size > 20 * 1024 * 1024)
            throw new Error("File limit is 20 MB.");
          const mime = mimes[file.name.split(".").pop()?.toLowerCase() ?? ""];
          if (!mime) throw new Error("Unsupported file format.");
          const result = (await send("upload.start", {
            name: file.name,
            mime,
            size: file.size,
            revision: values.get("revision"),
            number: values.get("number"),
            discipline: values.get("discipline"),
          })) as { url: string; drawing: Drawing };
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", result.url);
            xhr.setRequestHeader("Content-Type", mime);
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable)
                setProgress(Math.round((event.loaded / event.total) * 100));
            };
            xhr.onload = () =>
              xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error("Storage upload failed."));
            xhr.onerror = () => reject(new Error("Upload connection failed."));
            xhr.send(file);
          });
          await send("upload.finish", undefined, result.drawing.id);
          form.reset();
          onDone();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Upload failed.");
        } finally {
          setProgress(null);
        }
      }}
    >
      <h3>Add a drawing or specification</h3>
      <div className="form-grid">
        <label>
          Document
          <input
            name="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.txt,.csv"
            required
          />
        </label>
        <label>
          Drawing number
          <input name="number" placeholder="C-101" />
        </label>
        <label>
          Revision
          <input name="revision" defaultValue="A" required />
        </label>
        <label>
          Discipline
          <select name="discipline">
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        PDF, PNG, JPG, XLSX, TXT or CSV · up to 20 MB. Each revision is stored
        separately with its own calibrations.
      </p>
      <Button disabled={progress !== null}>
        {progress === null
          ? "Upload document"
          : progress < 100
            ? `Uploading ${progress}%`
            : "Validating document…"}
      </Button>
      {progress !== null && (
        <progress max={100} value={progress} aria-label="Upload progress" />
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
