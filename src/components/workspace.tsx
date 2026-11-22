"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Files,
  Ruler,
  Sparkles,
  Table2,
  Library,
  Calculator,
  Settings,
  LogOut,
  Plus,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "./ui/button";
import { EntityForm, type Field } from "./entity-form";
import Uploads from "./uploads";
import CalculatorPanel from "./calculator";
import { lineTotal } from "@/lib/calculations";
import {
  categories,
  type Entity,
  type ProjectData,
  type EstimateData,
  type Rate,
  type Item,
  type Drawing,
  type MeasurementData,
} from "@/lib/schemas";
const Takeoff = dynamic(() => import("./takeoff"), {
  ssr: false,
  loading: () => <p role="status">Loading drawing tools…</p>,
});
const navigation = [
  ["Dashboard", LayoutDashboard],
  ["Projects", FolderOpen],
  ["Drawings", Files],
  ["Takeoff", Ruler],
  ["AI Analysis", Sparkles],
  ["BOQ", Table2],
  ["Cost Library", Library],
  ["Estimates", Calculator],
  ["Settings", Settings],
] as const;
type Tab = (typeof navigation)[number][0];
type Member = { org_id: string; role: string; organisations: { name: string } };
type Calibration = Entity<{
  points: [number, number][];
  known: number;
  scale: number;
}> & { drawing_id: string; page: number };
type Measurement = Entity<MeasurementData> & {
  drawing_id: string;
  page: number;
  calibration_id: string;
};
type Job = {
  id: string;
  drawing_id: string;
  estimate_id: string;
  status: string;
  attempts: number;
  error: string | null;
  result: { summary?: string; warnings?: string[] } | null;
};
type History = {
  id: number;
  entity: string;
  operation: string;
  created_at: string;
  actor_id: string;
};
type Version = {
  id: string;
  created_at: string;
  snapshot: { items: Item[]; estimate: Entity<EstimateData> };
};
type WorkspaceData = {
  members: Member[];
  projects: Entity<ProjectData>[];
  rates: Rate[];
  estimates: Entity<EstimateData>[];
  drawings: Drawing[];
  items: Item[];
  calibrations: Calibration[];
  measurements: Measurement[];
  jobs: Job[];
  history: History[];
  versions: Version[];
  totals: {
    direct: number;
    overhead: number;
    contingency: number;
    profit: number;
    total: number;
    margin: number;
    groups: Record<string, number>;
  } | null;
};
const blank: WorkspaceData = {
  members: [],
  projects: [],
  rates: [],
  estimates: [],
  drawings: [],
  items: [],
  calibrations: [],
  measurements: [],
  jobs: [],
  history: [],
  versions: [],
  totals: null,
};
const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    n,
  );
const projectFields: Field[] = [
  {
    key: "name",
    label: "Project name",
    help: "A recognisable name for the job. Projects group drawings, takeoffs and estimates for the same work.",
    required: true,
  },
  {
    key: "client",
    label: "Client",
    help: "The customer or organisation you are preparing the estimate for.",
  },
  {
    key: "location",
    label: "Location",
    help: "The site address or location where the work will be carried out.",
  },
  {
    key: "region",
    label: "Region",
    help: "The area this project or rate relates to, such as NSW or Sydney. This reference does not automatically adjust prices.",
  },
  {
    key: "tender_reference",
    label: "Tender reference",
    help: "The client\u2019s tender or job reference used to identify this project.",
  },
  {
    key: "tender_closing_date",
    label: "Tender closing date",
    help: "The date the tender is due. Leave blank if it has not been confirmed.",
    type: "date",
    nullable: true,
  },
  {
    key: "status",
    label: "Status",
    help: "Track the project’s progress: Draft, In review, Tendered or Archived. This does not approve individual BOQ items.",
    options: ["Draft", "In review", "Tendered", "Archived"],
  },
  {
    key: "description",
    label: "Description",
    help: "A brief description of the project scope and the work to be estimated.",
    type: "textarea",
  },
];
const estimateFields: Field[] = [
  {
    key: "name",
    label: "Estimate name",
    help: "A name for this pricing version, such as Tender estimate or Revised scope. A project can have multiple estimates.",
    required: true,
  },
  {
    key: "overhead",
    label: "Overheads %",
    help: "An allowance for indirect costs such as supervision, administration and insurance. Applied to approved direct costs: 10% of $10,000 adds $1,000.",
    type: "number",
    required: true,
  },
  {
    key: "contingency",
    label: "Contingency %",
    help: "An allowance for uncertainty or unexpected costs. Applied to approved direct costs, independently of overheads: 5% of $10,000 adds $500.",
    type: "number",
    required: true,
  },
  {
    key: "markup",
    label: "Profit markup %",
    help: "Profit added to direct costs plus overheads and contingency. A 10% markup on $11,500 adds $1,150. Markup is not profit margin, which is profit as a percentage of the final price.",
    type: "number",
    required: true,
  },
  {
    key: "notes",
    label: "Assumptions and exclusions",
    help: "Record what the price relies on and what is not included, such as ground conditions, working hours or disposal fees. These notes accompany the estimate.",
    type: "textarea",
  },
];
const rateFields: Field[] = [
  {
    key: "code",
    label: "Rate code",
    help: "A unique reference for this library rate, such as PIPE-150. CSV imports use this code to match and update rates.",
    required: true,
  },
  {
    key: "description",
    label: "Description",
    help: "Describe what one unit of this rate includes, such as supply and installation of a specified pipe.",
    required: true,
  },
  {
    key: "category",
    label: "Category",
    help: "The type of work or cost this line belongs to. Categories help organise the BOQ and cost breakdown.",
    options: categories,
  },
  {
    key: "unit",
    label: "Unit",
    help: "The basis for the quantity and price: m = metres, m2 = square metres, m3 = cubic metres, t = tonnes, kg = kilograms, ea = each, hr = hours and L = litres. Item or lot is a lump-sum amount. Day is a daily rate.",
    options: [
      "m",
      "m2",
      "m3",
      "t",
      "kg",
      "ea",
      "item",
      "lot",
      "hr",
      "day",
      "L",
    ],
  },
  {
    key: "rate",
    label: "Unit rate AUD",
    help: "The cost of one unit in Australian dollars, excluding GST. Quantity × unit rate gives the line amount. Overheads, contingency and profit are added at estimate level.",
    type: "number",
    required: true,
  },
  {
    key: "supplier",
    label: "Supplier",
    help: "The business or source that supplied this price, so it can be checked or refreshed later.",
  },
  {
    key: "region",
    label: "Region",
    help: "The area this project or rate relates to, such as NSW or Sydney. This reference does not automatically adjust prices.",
  },
  {
    key: "effective_date",
    label: "Effective date",
    help: "The date this price applies from. Leave blank if unknown; this date does not automatically expire or update the rate.",
    type: "date",
    nullable: true,
  },
  {
    key: "source",
    label: "Quote / source reference",
    help: "A quote number, document reference or other source that lets you trace where this price came from.",
  },
  {
    key: "notes",
    label: "Notes",
    help: "Additional details, inclusions, exclusions or conditions relevant to using this rate.",
    type: "textarea",
  },
  {
    key: "archived",
    label: "Archive this rate",
    help: "Retire the rate from active use while keeping its history. Existing estimate prices keep their saved rate snapshots.",
    type: "checkbox",
  },
];
const itemFields: Field[] = [
  {
    key: "code",
    label: "Item code",
    help: "An optional reference for this BOQ line, such as a bill item number or internal work code.",
  },
  {
    key: "description",
    label: "Description",
    help: "Describe the work being priced, including relevant size, material, specification and inclusions.",
    required: true,
  },
  {
    key: "category",
    label: "Category",
    help: "The type of work or cost this line belongs to. Categories help organise the BOQ and cost breakdown.",
    options: categories,
  },
  {
    key: "quantity",
    label: "Quantity (blank if unknown)",
    help: "The amount of work in the selected unit. Leave blank when unknown; an item needs a known quantity before it can be approved.",
    type: "number",
    nullable: true,
  },
  {
    key: "unit",
    label: "Unit",
    help: "The basis for the quantity and price: m = metres, m2 = square metres, m3 = cubic metres, t = tonnes, kg = kilograms, ea = each, hr = hours and L = litres. Item or lot is a lump-sum amount. Day is a daily rate.",
    options: [
      "m",
      "m2",
      "m3",
      "t",
      "kg",
      "ea",
      "item",
      "lot",
      "hr",
      "day",
      "L",
    ],
  },
  {
    key: "rate",
    label: "Unit rate AUD",
    help: "The cost of one unit in Australian dollars, excluding GST. Quantity × unit rate gives the line amount. Overheads, contingency and profit are added at estimate level.",
    type: "number",
    required: true,
  },
  {
    key: "evidence",
    label: "Source evidence",
    help: "The drawing note, specification or other evidence supporting this item. Record enough detail for another estimator to check it.",
    type: "textarea",
  },
  {
    key: "method",
    label: "Calculation / measurement method",
    help: "Explain how the quantity was obtained, for example length × width × depth, a drawing measurement or a manual allowance.",
    type: "textarea",
  },
  {
    key: "notes",
    label: "Review notes",
    help: "Record checks, unresolved questions or qualifications for this item. Editing the item returns it to draft and requires re-approval.",
    type: "textarea",
  },
];
type Modal = {
  title: string;
  fields: Field[];
  initial: Record<string, unknown>;
  action: string;
  id?: string;
  version?: number;
};
export default function Workspace({ email }: { email: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [org, setOrg] = useState("");
  const [project, setProject] = useState("");
  const [estimate, setEstimate] = useState("");
  const [data, setData] = useState<WorkspaceData>(blank);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("code");
  const [drawing, setDrawing] = useState("");
  const query = useCallback(
    () =>
      new URLSearchParams({
        ...(org ? { org } : {}),
        ...(project ? { project } : {}),
        ...(estimate ? { estimate } : {}),
      }),
    [org, project, estimate],
  );
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`/api/workspace?${query()}`, { signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData({ ...blank, ...result });
      if (!org && result.members?.length) setOrg(result.members[0].org_id);
      if (org && !project && result.projects?.length)
        setProject(result.projects[0].id);
      if (project && !estimate && result.estimates?.length)
        setEstimate(result.estimates[0].id);
    },
    [query, org, project, estimate],
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    reload(abort.signal)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [reload]);
  useEffect(() => {
    if (!modal) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [modal]);
  useEffect(() => {
    if (!data.jobs.some((j) => ["queued", "running"].includes(j.status)))
      return;
    const timer = setInterval(() => reload().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [data.jobs, reload]);
  const send = async (
    action: string,
    payload?: unknown,
    entity?: string,
    version?: number,
  ) => {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...(org ? { org } : {}),
        ...(project ? { project } : {}),
        ...(estimate ? { estimate } : {}),
        ...(entity ? { id: entity } : {}),
        ...(version ? { version } : {}),
        data: payload,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
      setNotice("Changes saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (
    action: string,
    payload?: unknown,
    entity?: string,
    version?: number,
  ) =>
    perform(async () => {
      await send(action, payload, entity, version);
    });
  const p = data.projects.find((p) => p.id === project);
  const e = data.estimates.find((e) => e.id === estimate);
  const member = data.members.find((m) => m.org_id === org);
  const changeProject = (id: string) => {
    setProject(id);
    setEstimate("");
    setDrawing("");
  };
  const editProject = (value?: Entity<ProjectData>) =>
    setModal({
      title: value ? "Edit project" : "Create project",
      fields: projectFields,
      initial: value
        ? { ...value.data }
        : {
            name: "",
            client: "",
            location: "",
            region: "NSW",
            description: "",
            tender_reference: "",
            tender_closing_date: null,
            currency: "AUD",
            status: "Draft",
          },
      action: "project.save",
      id: value?.id,
      version: value?.version,
    });
  const editEstimate = (value?: Entity<EstimateData>) =>
    setModal({
      title: value ? "Estimate settings" : "Create estimate",
      fields: estimateFields,
      initial: value
        ? { ...value.data }
        : {
            name: "Tender estimate",
            overhead: 0,
            contingency: 0,
            markup: 0,
            notes: "",
          },
      action: "estimate.save",
      id: value?.id,
      version: value?.version,
    });
  const editRate = (value?: Rate) =>
    setModal({
      title: value ? "Edit cost rate" : "Add cost rate",
      fields: rateFields,
      initial: value
        ? { ...value.data }
        : {
            code: "",
            description: "",
            category: "Other",
            unit: "m",
            rate: 0,
            supplier: "",
            region: "NSW",
            effective_date: null,
            source: "",
            notes: "",
            archived: false,
          },
      action: "rate.save",
      id: value?.id,
      version: value?.version,
    });
  const editItem = (value?: Item) =>
    setModal({
      title: value
        ? "Edit BOQ item · requires re-approval"
        : "Add manual BOQ item",
      fields: [
        ...itemFields,
        {
          key: "drawing_id",
          label: "Source drawing / revision",
          help: "The exact uploaded drawing revision supporting this item. Select its page as well; leave both blank if there is no drawing reference.",
          nullable: true,
          options: [
            { value: "", label: "No drawing reference" },
            ...data.drawings
              .filter((d) => d.status === "ready")
              .map((d) => ({
                value: d.id,
                label: `${d.name} · rev ${d.revision}`,
              })),
          ],
        },
        {
          key: "source_page",
          label: "Source page (1-based)",
          help: "The page within the selected file, counting from 1. This is the PDF page position, which may differ from the printed drawing number.",
          type: "number",
          step: "1",
          nullable: true,
        },
      ],
      initial: value
        ? { ...value.data }
        : {
            code: "",
            description: "",
            category: "Other",
            quantity: null,
            unit: "m",
            rate: 0,
            source_type: "manual",
            drawing_id: null,
            source_page: null,
            evidence: "",
            method: "",
            notes: "",
            confidence: "low",
          },
      action: "item.save",
      id: value?.id,
      version: value?.version,
    });
  const exportURL = (action: string) =>
    `/api/workspace?${query()}&action=${action}`;
  const filteredItems = data.items
    .filter(
      (i) =>
        (!filter || i.data.category === filter) &&
        `${i.data.code} ${i.data.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "status"
        ? a.status.localeCompare(b.status)
        : String(
            a.data[sort as "code" | "description" | "category"],
          ).localeCompare(
            String(b.data[sort as "code" | "description" | "category"]),
          ),
    );
  const filteredRates = data.rates.filter(
    (r) =>
      (!filter || r.data.category === filter) &&
      `${r.data.code} ${r.data.description} ${r.data.supplier}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const openDrawing = (d: Drawing) =>
    perform(async () => {
      const response = await fetch(
        `/api/workspace?${query()}&action=document&id=${d.id}`,
      );
      const r = await response.json();
      if (!response.ok) throw new Error(r.error);
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CE</div>
          <span>
            Civil
            <br />
            Estimator
          </span>
        </div>
        <nav aria-label="Primary">
          {navigation.map(([name, Icon]) => (
            <button
              key={name}
              className={`nav-item ${tab === name ? "active" : ""}`}
              onClick={() => {
                setTab(name);
                setFilter("");
                setSearch("");
              }}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span>WORKSPACE</span>
          <select
            aria-label="Organisation"
            value={org}
            onChange={(event) => {
              setOrg(event.target.value);
              setProject("");
              setEstimate("");
            }}
          >
            {data.members.map((m) => (
              <option key={m.org_id} value={m.org_id}>
                {m.organisations.name}
              </option>
            ))}
          </select>
          <p>{email}</p>
          <button
            className="nav-item"
            onClick={async () => {
              await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <label>
            Project
            <select
              value={project}
              onChange={(event) => changeProject(event.target.value)}
            >
              <option value="">Select a project</option>
              {data.projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.data.name}
                </option>
              ))}
            </select>
          </label>
          <span>AUD · Excluding GST · {member?.role ?? "New workspace"}</span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {p?.data.tender_reference || "CIVIL WORKS ESTIMATING"}
              </span>
              <h1>{tab}</h1>
              <p>
                {p
                  ? `${p.data.name}${p.data.location ? " · " + p.data.location : ""}`
                  : "Your evidence-led estimating workspace"}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={() => perform(async () => {})}
            >
              <RefreshCw size={15} />
              Refresh
            </Button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {loading && (
            <p role="status" className="progress-note">
              Loading workspace…
            </p>
          )}
          {!loading && !org ? (
            <section className="panel">
              <h2>Create your organisation</h2>
              <p>
                You will become its administrator. Projects, documents and rates
                are isolated to this organisation.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const f = new FormData(event.currentTarget);
                  perform(async () => {
                    const r = await send("organisation.create", {
                      name: f.get("name"),
                    });
                    setOrg(r.id);
                  });
                }}
              >
                <label>
                  Organisation name
                  <input name="name" required maxLength={200} />
                </label>
                <br />
                <Button disabled={busy}>Create workspace</Button>
              </form>
            </section>
          ) : (
            <>
              {tab === "Dashboard" && (
                <>
                  <div className="metrics">
                    <Metric
                      label="Projects"
                      value={String(data.projects.length)}
                    />
                    <Metric
                      label="Documents in project"
                      value={String(
                        data.drawings.filter((d) => d.status === "ready")
                          .length,
                      )}
                    />
                    <Metric
                      label="Items awaiting review"
                      value={String(
                        data.items.filter((i) => i.status === "draft").length,
                      )}
                    />
                    <Metric
                      label="Approved tender total"
                      value={money(data.totals?.total ?? 0)}
                      highlight
                    />
                  </div>
                  <section className="panel">
                    <h2>Continue estimating</h2>
                    <p className="muted">
                      Select a project, confirm the drawing revision, then build
                      and review your estimate.
                    </p>
                    <div className="toolbar">
                      <Button onClick={() => editProject()}>
                        <Plus size={16} />
                        New project
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setTab("Drawings")}
                      >
                        Manage drawings
                        <ArrowUpRight size={15} />
                      </Button>
                      <Button variant="outline" onClick={() => setTab("BOQ")}>
                        Review BOQ
                        <ArrowUpRight size={15} />
                      </Button>
                    </div>
                    {p && (
                      <p>
                        {p.data.client || "Client not entered"} ·{" "}
                        {p.data.status} · {p.data.region}
                      </p>
                    )}
                  </section>
                  <HistoryPanel history={data.history} />
                </>
              )}
              {tab === "Projects" && (
                <>
                  <div className="toolbar">
                    <Button onClick={() => editProject()}>
                      <Plus size={16} />
                      Create project
                    </Button>
                  </div>
                  {data.projects.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Project / client</th>
                            <th>Location</th>
                            <th>Tender closes</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.projects.map((v) => (
                            <tr key={v.id}>
                              <td className="description">
                                <button
                                  className="link-button"
                                  onClick={() => {
                                    changeProject(v.id);
                                    setTab("Estimates");
                                  }}
                                >
                                  {v.data.name}
                                </button>
                                <small>{v.data.client}</small>
                              </td>
                              <td>
                                {v.data.location} · {v.data.region}
                              </td>
                              <td>{v.data.tender_closing_date || "—"}</td>
                              <td>
                                <span className="badge">{v.data.status}</span>
                              </td>
                              <td>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => editProject(v)}
                                >
                                  Edit
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="Create your first project"
                      text="Give your drawings, quantities and estimates a shared home."
                    />
                  )}
                </>
              )}
              {tab === "Cost Library" && (
                <>
                  <div className="toolbar">
                    <Button onClick={() => editRate()}>
                      <Plus size={16} />
                      Add rate
                    </Button>
                    <a href={exportURL("rates-csv")}>Export CSV</a>
                    <label>
                      Import CSV
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            perform(async () => {
                              await send("rates.import", await file.text());
                            });
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <p className="muted">
                    User-supplied rates only. Applying a rate saves its price
                    and provenance to the BOQ. Later library changes do not
                    reprice estimates.
                  </p>
                  <SearchFilter
                    search={search}
                    setSearch={setSearch}
                    filter={filter}
                    setFilter={setFilter}
                  />
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Rate</th>
                          <th>Category</th>
                          <th>AUD / unit</th>
                          <th>Supplier / source</th>
                          <th>Effective</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRates.map((r) => (
                          <tr key={r.id}>
                            <td className="description">
                              {r.data.description}
                              <small>
                                {r.data.code}
                                {r.data.archived ? " · Archived" : ""}
                              </small>
                            </td>
                            <td>{r.data.category}</td>
                            <td>
                              {money(r.data.rate)} / {r.data.unit}
                            </td>
                            <td>
                              {r.data.supplier}
                              <small>{r.data.source}</small>
                            </td>
                            <td>{r.data.effective_date || "—"}</td>
                            <td>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => editRate(r)}
                              >
                                Edit
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.rates.length && (
                    <Empty
                      title="Your rate library is empty"
                      text="Add verified quotes or import the prototype CSV. Required CSV headers: code, description, unit, rate. Optional: category, supplier, region, effective_date, source, notes."
                    />
                  )}
                </>
              )}
              {[
                "Drawings",
                "Takeoff",
                "AI Analysis",
                "BOQ",
                "Estimates",
              ].includes(tab) && !p ? (
                <Empty
                  title="Select or create a project"
                  text="Use the project selector above, or create a project in Projects."
                />
              ) : null}
              {p && tab === "Drawings" && (
                <>
                  <Uploads
                    send={send}
                    onDone={() => reload().catch((e) => setError(e.message))}
                  />
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Discipline</th>
                          <th>Revision</th>
                          <th>Pages</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.drawings.map((d) => (
                          <tr key={d.id}>
                            <td className="description">
                              {d.name}
                              <small>
                                {d.number} · {(d.size / 1024 / 1024).toFixed(1)}{" "}
                                MB
                              </small>
                            </td>
                            <td>{d.discipline}</td>
                            <td>{d.revision}</td>
                            <td>{d.page_count || "—"}</td>
                            <td>
                              <span className={`badge ${d.status}`}>
                                {d.status}
                              </span>
                            </td>
                            <td>
                              <div className="actions">
                                {d.status === "ready" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openDrawing(d)}
                                    >
                                      Open
                                    </Button>
                                    {[
                                      "application/pdf",
                                      "image/png",
                                      "image/jpeg",
                                    ].includes(d.mime) && (
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          setDrawing(d.id);
                                          setTab("Takeoff");
                                        }}
                                      >
                                        Takeoff
                                      </Button>
                                    )}
                                  </>
                                )}
                                {d.status === "pending" && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      mutate("upload.finish", undefined, d.id)
                                    }
                                  >
                                    Retry validation
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {p && tab === "Takeoff" && (
                <>
                  <Takeoff
                    drawings={data.drawings}
                    selected={drawing}
                    onSelect={setDrawing}
                    calibrations={data.calibrations}
                    measurements={data.measurements}
                    url={(id) =>
                      `/api/workspace?${query()}&action=document&id=${id}`
                    }
                    send={send}
                    onChanged={() => reload()}
                    onError={setError}
                    estimate={estimate}
                  />
                  {estimate ? (
                    <CalculatorPanel
                      onAdd={(payload) => mutate("calculator.item", payload)}
                    />
                  ) : (
                    <p className="muted">
                      Create an estimate to add calculated quantities to the
                      BOQ.
                    </p>
                  )}
                </>
              )}
              {p && ["BOQ", "Estimates", "AI Analysis"].includes(tab) && (
                <div className="toolbar">
                  <label>
                    Estimate
                    <select
                      value={estimate}
                      onChange={(event) => setEstimate(event.target.value)}
                    >
                      <option value="">Select estimate</option>
                      {data.estimates.map((e) => (
                        <option value={e.id} key={e.id}>
                          {e.data.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button variant="outline" onClick={() => editEstimate()}>
                    <Plus size={15} />
                    New estimate
                  </Button>
                  {e && (
                    <Button variant="outline" onClick={() => editEstimate(e)}>
                      Settings & markups
                    </Button>
                  )}
                </div>
              )}
              {p && tab === "BOQ" && e && (
                <>
                  <div className="metrics">
                    <Metric
                      label="Approved direct costs"
                      value={money(data.totals?.direct ?? 0)}
                    />
                    <Metric
                      label="Overheads + contingency"
                      value={money(
                        (data.totals?.overhead ?? 0) +
                          (data.totals?.contingency ?? 0),
                      )}
                    />
                    <Metric
                      label="Profit markup amount"
                      value={money(data.totals?.profit ?? 0)}
                    />
                    <Metric
                      label="Tender total · excl. GST"
                      value={money(data.totals?.total ?? 0)}
                      highlight
                    />
                  </div>
                  <div className="toolbar">
                    <Button onClick={() => editItem()}>
                      <Plus size={15} />
                      Add item
                    </Button>
                    <a href={exportURL("excel")}>Export Excel estimate</a>
                    <span className="muted">
                      Only explicitly approved items enter totals. Changes
                      require re-approval.
                    </span>
                  </div>
                  <SearchFilter
                    search={search}
                    setSearch={setSearch}
                    filter={filter}
                    setFilter={setFilter}
                  />
                  <label className="toolbar">
                    Sort
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                    >
                      {["code", "description", "category", "status"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Work item / evidence</th>
                          <th>Quantity</th>
                          <th>Unit rate</th>
                          <th>Line amount</th>
                          <th>Apply saved rate</th>
                          <th>Status</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((i) => (
                          <tr key={i.id}>
                            <td className="description">
                              {i.data.description}
                              <small>
                                {i.data.code} · {i.data.category} ·{" "}
                                {i.data.source_type}
                              </small>
                              <details>
                                <summary>Evidence & provenance</summary>
                                <p>
                                  {i.data.evidence ||
                                    "No source evidence entered."}
                                </p>
                                <p>{i.data.method}</p>
                                <p>
                                  {
                                    data.drawings.find(
                                      (d) => d.id === i.data.drawing_id,
                                    )?.name
                                  }{" "}
                                  {i.data.source_page
                                    ? "· p" + i.data.source_page
                                    : ""}
                                </p>
                                <p>
                                  {i.rate_snapshot
                                    ? `${i.rate_snapshot.code} · ${i.rate_snapshot.supplier} · ${i.rate_snapshot.source} · ${i.rate_snapshot.effective_date ?? ""}`
                                    : "No saved-rate snapshot."}
                                </p>
                                <p>{i.data.notes}</p>
                              </details>
                            </td>
                            <td>
                              {i.data.quantity === null
                                ? "Unknown"
                                : i.data.quantity.toLocaleString("en-AU", {
                                    maximumFractionDigits: 6,
                                  })}{" "}
                              {i.data.unit}
                            </td>
                            <td>{money(i.data.rate)}</td>
                            <td>
                              {i.data.quantity === null
                                ? "—"
                                : money(
                                    lineTotal(i.data.quantity, i.data.rate),
                                  )}
                            </td>
                            <td>
                              <select
                                aria-label={`Apply rate to ${i.data.description}`}
                                value=""
                                disabled={busy}
                                onChange={(event) => {
                                  if (event.target.value)
                                    mutate(
                                      "item.rate",
                                      { rate: event.target.value },
                                      i.id,
                                      i.version,
                                    );
                                }}
                              >
                                <option value="">Choose rate…</option>
                                {data.rates
                                  .filter(
                                    (r) =>
                                      !r.data.archived &&
                                      r.data.unit === i.data.unit,
                                  )
                                  .map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.data.code} · {money(r.data.rate)}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td>
                              <span className={`badge ${i.status}`}>
                                {i.status}
                              </span>
                            </td>
                            <td>
                              <div className="actions">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => editItem(i)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={
                                    busy ||
                                    i.data.quantity === null ||
                                    i.status === "approved"
                                  }
                                  onClick={() => {
                                    if (
                                      i.data.rate === 0 &&
                                      !confirm(
                                        "This item has a zero rate. Approve it as unpriced?",
                                      )
                                    )
                                      return;
                                    mutate(
                                      "item.approve",
                                      undefined,
                                      i.id,
                                      i.version,
                                    );
                                  }}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    mutate(
                                      "item.reject",
                                      undefined,
                                      i.id,
                                      i.version,
                                    )
                                  }
                                >
                                  Reject
                                </Button>
                                <button
                                  className="link-button danger-text"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "Delete this BOQ item? Its revision history will be retained.",
                                      )
                                    )
                                      mutate(
                                        "item.delete",
                                        undefined,
                                        i.id,
                                        i.version,
                                      );
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
                  {!data.items.length && (
                    <Empty
                      title="Build your bill of quantities"
                      text="Add a manual line, send a saved takeoff to the BOQ, or queue document analysis. All new items start in draft."
                    />
                  )}
                </>
              )}
              {p && tab === "Estimates" && (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Estimate</th>
                          <th>Overheads</th>
                          <th>Contingency</th>
                          <th>Profit markup</th>
                          <th>Last updated</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.estimates.map((v) => (
                          <tr key={v.id}>
                            <td>{v.data.name}</td>
                            <td>{v.data.overhead}%</td>
                            <td>{v.data.contingency}%</td>
                            <td>{v.data.markup}%</td>
                            <td>
                              {new Date(v.updated_at).toLocaleString("en-AU")}
                            </td>
                            <td>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setEstimate(v.id);
                                  setTab("BOQ");
                                }}
                              >
                                Open BOQ
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {e && (
                    <section className="panel">
                      <h3>{e.data.name}</h3>
                      <p>
                        {e.data.notes ||
                          "No estimate-level assumptions recorded."}
                      </p>
                      <p className="muted">
                        Profit margin: {(data.totals?.margin ?? 0).toFixed(2)}%.
                        Markup is applied to direct costs plus overheads and
                        contingency.
                      </p>
                      <div className="toolbar">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              const r = await send("estimate.duplicate");
                              setEstimate(r.id);
                            })
                          }
                        >
                          Duplicate estimate
                        </Button>
                        <a href={exportURL("excel")}>Export Excel</a>
                      </div>
                      <h3>Saved BOQ revisions</h3>
                      {data.versions.map((v) => (
                        <details key={v.id}>
                          <summary>
                            {new Date(v.created_at).toLocaleString("en-AU")} ·{" "}
                            {v.snapshot.items.length} items
                          </summary>
                          <pre>{JSON.stringify(v.snapshot, null, 2)}</pre>
                        </details>
                      ))}
                    </section>
                  )}
                  <HistoryPanel history={data.history} />
                </>
              )}
              {p && tab === "AI Analysis" && (
                <>
                  <div className="ai-disclosure">
                    <h3>Draft assistance, with evidence</h3>
                    <p>
                      Selected documents are sent to OpenAI for processing.
                      Background processing stores response data temporarily. AI
                      quantities and references need independent review; it
                      cannot calibrate or measure your drawings. No supplier
                      prices are generated.
                    </p>
                    <p className="muted">
                      Up to 20 documents per request, 15 MB and 50 pages each.
                      The scheduled worker processes jobs independently with
                      bounded retries. Use PDF, images, XLSX, CSV or text.
                    </p>
                  </div>
                  <form
                    className="panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      mutate("ai.queue", form.getAll("drawings"));
                    }}
                  >
                    <h3>Select documents for this estimate</h3>
                    {data.drawings
                      .filter((d) => d.status === "ready")
                      .map((d) => (
                        <label
                          key={d.id}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 12,
                          }}
                        >
                          <input type="checkbox" name="drawings" value={d.id} />
                          {d.name} · rev {d.revision}
                        </label>
                      ))}
                    <Button disabled={busy || !estimate}>Queue analysis</Button>
                  </form>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Status</th>
                          <th>Attempts</th>
                          <th>Results</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.jobs.map((j) => (
                          <tr key={j.id}>
                            <td>
                              {
                                data.drawings.find((d) => d.id === j.drawing_id)
                                  ?.name
                              }
                            </td>
                            <td>
                              <span className={`badge ${j.status}`}>
                                {j.status}
                              </span>
                            </td>
                            <td>{j.attempts}</td>
                            <td className="description">
                              {j.error ||
                                j.result?.summary ||
                                "Waiting for the scheduled worker."}
                              {j.result?.warnings?.map((w, i) => (
                                <small key={i}>{w}</small>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "Settings" && (
                <section className="panel">
                  <h2>{member?.organisations.name}</h2>
                  <p>
                    Your role: {member?.role}. Currency: AUD. All totals exclude
                    GST.
                  </p>
                  <p className="muted">
                    Ask a new user to register and confirm their email, then add
                    their Supabase user ID. Admins can add members; estimators
                    can work on projects, rates and estimates.
                  </p>
                  {member?.role === "admin" && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        mutate("member.add", {
                          user_id: form.get("user_id"),
                          role: form.get("role"),
                        });
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          New member user ID
                          <input name="user_id" required />
                        </label>
                        <label>
                          Role
                          <select name="role">
                            <option>estimator</option>
                            <option>admin</option>
                          </select>
                        </label>
                      </div>
                      <Button disabled={busy}>Add organisation member</Button>
                    </form>
                  )}
                  <p className="muted">
                    Server credentials, AI model and worker schedule are
                    configured in environment variables. See the deployment
                    guide in the repository.
                  </p>
                </section>
              )}
            </>
          )}
          {modal && (
            <EntityForm
              key={`${modal.action}-${modal.id ?? "new"}`}
              {...modal}
              busy={busy}
              onClose={() => setModal(null)}
              onSave={(payload) =>
                perform(async () => {
                  const r = await send(
                    modal.action,
                    payload,
                    modal.id,
                    modal.version,
                  );
                  if (modal.action === "project.save" && !modal.id)
                    changeProject(r.id);
                  if (modal.action === "estimate.save" && !modal.id)
                    setEstimate(r.id);
                  setModal(null);
                })
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`metric ${highlight ? "highlight" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function HistoryPanel({ history }: { history: History[] }) {
  return (
    <section className="panel history">
      <h3>Project history</h3>
      {history.length ? (
        history.map((h) => (
          <article key={h.id}>
            <strong>
              {h.operation.toLowerCase()} · {h.entity.replaceAll("_", " ")}
            </strong>
            <br />
            <small>
              {new Date(h.created_at).toLocaleString("en-AU")} ·{" "}
              {h.actor_id || "System"}
            </small>
          </article>
        ))
      ) : (
        <p className="muted">Project changes will appear here.</p>
      )}
    </section>
  );
}
function SearchFilter({
  search,
  setSearch,
  filter,
  setFilter,
}: {
  search: string;
  setSearch: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  return (
    <div className="toolbar">
      <input
        aria-label="Search"
        placeholder="Search code or description…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label="Filter category"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
