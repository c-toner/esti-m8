"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
export type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "textarea" | "checkbox";
  options?: readonly (string | { value: string; label: string })[];
  required?: boolean;
  step?: string;
  nullable?: boolean;
};
export function EntityForm({
  title,
  fields,
  initial,
  onSave,
  onClose,
  busy,
}: {
  title: string;
  fields: Field[];
  initial: Record<string, unknown>;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => {
    if (!dirty || confirm("Discard unsaved changes?")) onClose();
  };
  return (
    <dialog
      ref={ref}
      className="editor-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const data: Record<string, unknown> = { ...initial };
          fields.forEach((f) => {
            const value = form.get(f.key);
            data[f.key] =
              f.type === "checkbox"
                ? value === "on"
                : f.nullable && value === ""
                  ? null
                  : f.type === "number"
                    ? Number(value)
                    : value;
          });
          await onSave(data);
        }}
      >
        <header>
          <h2>{title}</h2>
          <Button type="button" variant="outline" onClick={close}>
            Close
          </Button>
        </header>
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
              {f.label}
              {f.options ? (
                <select
                  name={f.key}
                  defaultValue={String(
                    initial[f.key] ??
                      (typeof f.options[0] === "string"
                        ? f.options[0]
                        : (f.options[0]?.value ?? "")),
                  )}
                >
                  {f.options.map((o) => (
                    <option
                      key={typeof o === "string" ? o : o.value}
                      value={typeof o === "string" ? o : o.value}
                    >
                      {typeof o === "string" ? o : o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.key}
                  defaultValue={String(initial[f.key] ?? "")}
                  rows={3}
                />
              ) : f.type === "checkbox" ? (
                <input
                  name={f.key}
                  type="checkbox"
                  defaultChecked={Boolean(initial[f.key])}
                />
              ) : (
                <input
                  name={f.key}
                  type={f.type ?? "text"}
                  min={f.type === "number" ? 0 : undefined}
                  step={f.type === "number" ? (f.step ?? "any") : undefined}
                  required={f.required}
                  defaultValue={String(initial[f.key] ?? "")}
                />
              )}
            </label>
          ))}
        </div>
        <footer>
          <p className="muted">Changes are saved when you select Save.</p>
          <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </footer>
      </form>
    </dialog>
  );
}
