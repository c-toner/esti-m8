"use client";
import { useState } from "react";
import { calculatorFields, civil, type Calculator } from "@/lib/calculations";
import { Button } from "./ui/button";
export default function CalculatorPanel({
  onAdd,
}: {
  onAdd: (data: unknown) => Promise<void>;
}) {
  const [mode, setMode] = useState<Calculator>("trench");
  const [input, setInput] = useState<Record<string, number>>({});
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  let result: ReturnType<typeof civil> | null = null;
  let error = "";
  try {
    if (calculatorFields[mode].every((key) => input[key] !== undefined))
      result = civil(mode, input);
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  return (
    <section className="panel">
      <h3>Civil quantity calculators</h3>
      <p className="muted">
        Lengths, widths, depths and pipe outside diameter in metres. Areas in
        m²; volumes in m³.
      </p>
      <div className="form-grid">
        <label>
          Calculation
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Calculator);
              setInput({});
            }}
          >
            {Object.keys(calculatorFields).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {calculatorFields[mode].map((key) => (
          <label key={key}>
            {key.replace(/([A-Z])/g, " $1")}
            <input
              type="number"
              min={0}
              step="any"
              value={input[key] ?? ""}
              onChange={(e) =>
                setInput({ ...input, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label>
          BOQ description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
      {result ? (
        <>
          <strong>
            {result.quantity.toLocaleString("en-AU", {
              maximumFractionDigits: 6,
            })}{" "}
            m³
          </strong>
          <p className="muted">{result.method}</p>
        </>
      ) : (
        <p className="muted">{error || "Enter all dimensions."}</p>
      )}
      <Button
        disabled={!result || !description || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onAdd({ mode, inputs: input, description });
          } finally {
            setBusy(false);
          }
        }}
      >
        Add calculation to draft BOQ
      </Button>
    </section>
  );
}
