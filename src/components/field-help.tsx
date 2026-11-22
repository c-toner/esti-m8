"use client";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

export function FieldHelp({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [open]);
  return (
    <span
      className="field-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (document.activeElement !== button.current) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="field-help-button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="field-help-content"
        hidden={!open}
      >
        {children}
      </span>
    </span>
  );
}
