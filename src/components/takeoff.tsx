"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  PageViewport,
} from "pdfjs-dist";
import { Button } from "./ui/button";
import type { Drawing, Entity, Point, MeasurementData } from "@/lib/schemas";
import { measure } from "@/lib/calculations";
type Calibration = Entity<{ points: Point[]; known: number; scale: number }> & {
  drawing_id: string;
  page: number;
};
type Measurement = Entity<MeasurementData> & {
  drawing_id: string;
  page: number;
  calibration_id: string;
};
type Props = {
  drawings: Drawing[];
  selected: string;
  onSelect: (id: string) => void;
  calibrations: Calibration[];
  measurements: Measurement[];
  url: (id: string) => string;
  send: (
    action: string,
    data?: unknown,
    id?: string,
    version?: number,
  ) => Promise<unknown>;
  onChanged: () => Promise<void>;
  onError: (error: string) => void;
  estimate: string;
};
export default function Takeoff(props: Props) {
  const available = props.drawings.filter(
    (d) =>
      d.status === "ready" &&
      ["application/pdf", "image/png", "image/jpeg"].includes(d.mime),
  );
  const drawing =
    available.find((d) => d.id === props.selected) ?? available[0];
  const [page, setPage] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<
    "pan" | "calibrate" | "length" | "area" | "volume"
  >("calibrate");
  const [points, setPoints] = useState<Point[]>([]);
  const [known, setKnown] = useState(1);
  const [depth, setDepth] = useState(0.3);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [editing, setEditing] = useState<Measurement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [views, setViews] = useState<{
    current: PageViewport;
    base: PageViewport;
  } | null>(null);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const id = drawing?.id;
  const mime = drawing?.mime;
  const docURL = id ? props.url(id) : "";
  const cal = editing
    ? props.calibrations.find((c) => c.id === editing.calibration_id)
    : props.calibrations.find((c) => c.drawing_id === id && c.page === page);
  const measurements = props.measurements.filter(
    (m) => m.drawing_id === id && m.page === page,
  );
  useEffect(() => {
    setPage(1);
    setPoints([]);
    setEditing(null);
    setRotation(0);
  }, [id]);
  useEffect(() => {
    setPoints([]);
    setEditing(null);
  }, [page]);
  useEffect(() => {
    if (!docURL || !mime) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setPdf(null);
    setImg(null);
    (async () => {
      const r = await fetch(docURL, { signal: abort.signal });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (mime === "application/pdf") {
        const lib = await import("pdfjs-dist");
        lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = lib.getDocument({ url: data.url });
        const loaded = await task.promise;
        if (!cancelled) setPdf(loaded);
        else await task.destroy();
      } else {
        const image = new Image();
        image.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () =>
            reject(new Error("Unable to load drawing image."));
          image.src = data.url;
        });
        if (image.width * image.height > 40_000_000)
          throw new Error(
            "Image exceeds 40 megapixels. Resize before taking off.",
          );
        if (!cancelled) setImg(image);
      }
    })()
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      abort.abort();
      task?.destroy();
    };
  }, [docURL, mime]);
  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null =
      null;
    (async () => {
      const target = canvas.current;
      if (!target) return;
      const context = target.getContext("2d");
      if (!context) return;
      if (pdf) {
        const p = await pdf.getPage(page);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1, rotation: 0 });
        const view = p.getViewport({ scale: 1, rotation });
        setViews({ current: view, base });
        const density = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.ceil(view.width * density);
        target.height = Math.ceil(view.height * density);
        setSize({ width: view.width, height: view.height });
        renderTask = p.render({
          canvas: target,
          canvasContext: context,
          viewport: view,
          transform: [density, 0, 0, density, 0, 0],
        });
        await renderTask.promise;
      } else if (img) {
        setViews(null);
        const swap = rotation === 90 || rotation === 270;
        const width = swap ? img.height : img.width,
          height = swap ? img.width : img.height;
        target.width = width;
        target.height = height;
        setSize({ width, height });
        context.translate(width / 2, height / 2);
        context.rotate((rotation * Math.PI) / 180);
        context.drawImage(img, -img.width / 2, -img.height / 2);
      }
    })().catch((e) => {
      if (!cancelled && e.name !== "RenderingCancelledException")
        setError(e.message);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, img, page, rotation]);
  const display = (p: Point): Point => {
    if (views) {
      const v = views.base.convertToPdfPoint(...p);
      return views.current.convertToViewportPoint(v[0], v[1]) as Point;
    }
    if (!img) return p;
    switch (rotation) {
      case 90:
        return [img.height - p[1], p[0]];
      case 180:
        return [img.width - p[0], img.height - p[1]];
      case 270:
        return [p[1], img.width - p[0]];
      default:
        return p;
    }
  };
  const documentPoint = (p: Point): Point => {
    if (views) {
      const v = views.current.convertToPdfPoint(...p);
      return views.base.convertToViewportPoint(v[0], v[1]) as Point;
    }
    if (!img) return p;
    switch (rotation) {
      case 90:
        return [p[1], img.height - p[0]];
      case 180:
        return [img.width - p[0], img.height - p[1]];
      case 270:
        return [img.width - p[1], p[0]];
      default:
        return p;
    }
  };
  const line = (ps: Point[]) => ps.map((p) => display(p).join(",")).join(" ");
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Takeoff could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  let quantity = "";
  try {
    if (cal && ["length", "area", "volume"].includes(mode)) {
      const result = measure(
        points,
        cal.data.scale,
        mode as "length" | "area" | "volume",
        depth,
      );
      quantity = `${result.quantity.toLocaleString("en-AU", { maximumFractionDigits: 4 })} ${result.unit}`;
    }
  } catch {
    /* Incomplete geometry is expected while drawing. */
  }
  if (!drawing)
    return (
      <div className="empty">
        <h3>Upload a drawing to start</h3>
        <p>PDF, PNG and JPG drawings support calibrated takeoff.</p>
      </div>
    );
  return (
    <section className="panel">
      <div className="viewer-tools">
        <label>
          Drawing / revision
          <select
            value={drawing.id}
            onChange={(e) => props.onSelect(e.target.value)}
          >
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · rev {d.revision}
              </option>
            ))}
          </select>
        </label>
        <label>
          Page
          <select
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {Array.from({ length: drawing.page_count }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1} / {drawing.page_count}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zoom
          <select
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n * 100}%
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => setRotation((rotation + 90) % 360)}
        >
          Rotate 90°
        </Button>
        <label>
          Tool
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              setPoints([]);
              setEditing(null);
            }}
          >
            {["pan", "calibrate", "length", "area", "volume"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => setPoints(points.slice(0, -1))}
        >
          Undo point
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setPoints([]);
            setEditing(null);
          }}
        >
          Clear points
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading private drawing…</p>}
      <div className="viewer-stage" ref={stage}>
        <div
          className="drawing-surface"
          style={{ width: size.width * zoom, height: size.height * zoom }}
        >
          <canvas
            ref={canvas}
            aria-label={`${drawing.name}, revision ${drawing.revision}, page ${page}`}
          />
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            role="img"
            aria-label="Drawing measurement overlay. Click to place points; pan tool drags the drawing."
            style={{ cursor: mode === "pan" ? "grab" : "crosshair" }}
            onPointerDown={(event) => {
              if (mode === "pan" && stage.current) {
                pan.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: stage.current.scrollLeft,
                  top: stage.current.scrollTop,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                return;
              }
              if (loading || (!pdf && !img)) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const p = documentPoint([
                ((event.clientX - rect.left) * size.width) / rect.width,
                ((event.clientY - rect.top) * size.height) / rect.height,
              ]);
              const clean: Point = [Math.max(0, p[0]), Math.max(0, p[1])];
              setPoints((old) =>
                mode === "calibrate" && old.length >= 2
                  ? [clean]
                  : [...old, clean],
              );
            }}
            onPointerMove={(event) => {
              if (pan.current && stage.current) {
                stage.current.scrollLeft =
                  pan.current.left - (event.clientX - pan.current.x);
                stage.current.scrollTop =
                  pan.current.top - (event.clientY - pan.current.y);
              }
            }}
            onPointerUp={() => {
              pan.current = null;
            }}
            onPointerCancel={() => {
              pan.current = null;
            }}
          >
            {measurements
              .filter((m) => m.id !== editing?.id)
              .map((m) => (
                <g key={m.id} opacity=".65">
                  {m.data.mode === "length" ? (
                    <polyline
                      points={line(m.data.points)}
                      fill="none"
                      stroke="#147b64"
                      strokeWidth={2 / zoom}
                    />
                  ) : (
                    <polygon
                      points={line(m.data.points)}
                      fill="#11a78622"
                      stroke="#147b64"
                      strokeWidth={2 / zoom}
                    />
                  )}
                </g>
              ))}
            {cal && (
              <polyline
                points={line(cal.data.points)}
                fill="none"
                stroke="#bd8b21"
                strokeWidth={2 / zoom}
                strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              />
            )}
            <polyline
              points={line(points)}
              fill={["area", "volume"].includes(mode) ? "#058b7233" : "none"}
              stroke={mode === "calibrate" ? "#bd8b21" : "#057f67"}
              strokeWidth={3 / zoom}
            />
            {points.map((p, i) => {
              const [x, y] = display(p);
              return (
                <g key={i}>
                  <circle
                    cx={x}
                    cy={y}
                    r={4 / zoom}
                    fill="#fff"
                    stroke="#076c58"
                    strokeWidth={2 / zoom}
                  />
                  <text
                    x={x + 7 / zoom}
                    y={y - 7 / zoom}
                    fontSize={12 / zoom}
                    fill="#10372e"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <p className="muted">
        {points.length} points selected. Coordinates are stored in unrotated
        document units. Pan with the pan tool; scroll to move around the
        drawing. Select a known labelled dimension to calibrate.
      </p>
      {mode === "calibrate" ? (
        <div className="toolbar">
          <label>
            Known distance (metres)
            <input
              type="number"
              min="0.000001"
              step="any"
              value={known}
              onChange={(e) => setKnown(Number(e.target.value))}
            />
          </label>
          <Button
            disabled={busy || points.length !== 2}
            onClick={() =>
              act(async () => {
                await props.send("calibration.save", {
                  drawing_id: drawing.id,
                  page,
                  points,
                  known,
                });
                setPoints([]);
                setMode("length");
              })
            }
          >
            Save page calibration
          </Button>
        </div>
      ) : (
        <>
          <p className={cal ? "notice" : "error"}>
            {cal
              ? `Calibration: ${cal.data.known} m reference · ${cal.data.scale.toPrecision(7)} metres/document unit. Existing takeoffs retain their calibration snapshot.`
              : "This revision and page are not calibrated."}
          </p>
          {mode !== "pan" && (
            <div className="form-grid">
              <label>
                Measurement description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              {mode === "volume" && (
                <label>
                  Uniform depth / thickness (m)
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                  />
                </label>
              )}
              <label>
                Annotation / assumptions
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <div>
                <p>
                  <strong>
                    {quantity ||
                      "Complete the geometry to calculate a quantity."}
                  </strong>
                </p>
                <Button
                  disabled={busy || !cal || !quantity || !description}
                  onClick={() =>
                    act(async () => {
                      await props.send(
                        "measurement.save",
                        {
                          calibration_id: cal?.id,
                          measurement: {
                            description,
                            mode,
                            points,
                            depth: mode === "volume" ? depth : null,
                            notes,
                          },
                        },
                        editing?.id,
                        editing?.version,
                      );
                      setPoints([]);
                      setEditing(null);
                    })
                  }
                >
                  {editing ? "Update takeoff" : "Save takeoff"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <h3>Saved takeoffs · page {page}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Measurement</th>
              <th>Quantity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => (
              <tr key={m.id}>
                <td className="description">
                  {m.data.description}
                  <small>{m.data.notes}</small>
                </td>
                <td>
                  {m.data.quantity.toLocaleString("en-AU", {
                    maximumFractionDigits: 4,
                  })}{" "}
                  {m.data.unit}
                </td>
                <td>
                  <div className="actions">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(m);
                        setPoints(m.data.points);
                        setMode(m.data.mode);
                        setDepth(m.data.depth ?? 0.3);
                        setDescription(m.data.description);
                        setNotes(m.data.notes);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !props.estimate}
                      onClick={() =>
                        act(async () => {
                          await props.send("measurement.item", undefined, m.id);
                        })
                      }
                    >
                      Add to draft BOQ
                    </Button>
                    <button
                      className="link-button danger-text"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Delete this takeoff? Existing BOQ snapshots will remain unchanged.",
                          )
                        )
                          act(async () => {
                            await props.send(
                              "measurement.delete",
                              undefined,
                              m.id,
                              m.version,
                            );
                          });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
