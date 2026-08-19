"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlarmClock,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  DollarSign,
  GraduationCap,
  Loader2,
  Search,
  Sparkles,
  User as UserIcon,
  Users as UsersIcon,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { PLAN_META, type UserPlan } from "@/lib/plans";

// ============================================================================
// Types (mirror del domain User)
// ============================================================================

type UserRow = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: "admin" | "usuario";
  status: "active" | "suspended" | "invited";
  plan: UserPlan;
  academicVerifiedAt: string | null;
  lastLoginAt: string | null;
  planStartedAt: string | null;
  planExpiresAt: string | null;
  planChangedAt: string | null;
  planChangedBy: string | null;
  planNotes: string | null;
  createdAt: string;
};

type Stats = {
  total: number;
  byPlan: Record<UserPlan, number>;
  byRole: Record<"admin" | "usuario", number>;
  byStatus: Record<"active" | "suspended" | "invited", number>;
  activeLast7d: number;
  activeLast30d: number;
  neverLoggedIn: number;
  expiringNext7d: number;
  expiringNext30d: number;
  mrrUsd: number;
};

type PagedResp = {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
};

// ============================================================================
// Helpers
// ============================================================================

const fmtDateShort = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
};

const fmtRelativeLogin = (iso: string | null): string => {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days}d`;
  if (days < 30) return `hace ${Math.floor(days / 7)}sem`;
  if (days < 365) return `hace ${Math.floor(days / 30)}m`;
  return `hace ${Math.floor(days / 365)}a`;
};

const fmtDaysToExpiry = (iso: string | null): { text: string; urgent: boolean } => {
  if (!iso) return { text: "sin expiración", urgent: false };
  const diffMs = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: `venció hace ${Math.abs(days)}d`, urgent: true };
  if (days === 0) return { text: "vence hoy", urgent: true };
  if (days <= 7) return { text: `en ${days}d`, urgent: true };
  if (days <= 30) return { text: `en ${days}d`, urgent: false };
  return { text: fmtDateShort(iso), urgent: false };
};

const planColorClasses: Record<UserPlan, string> = {
  free: "bg-slate-100 text-slate-700 border border-slate-200",
  trial: "bg-amber-100 text-amber-900 border border-amber-300",
  academic: "bg-sky-100 text-sky-800 border border-sky-200",
  pro: "bg-brand-100 text-brand-800 border border-brand-200",
  business: "bg-emerald-100 text-emerald-800 border border-emerald-200",
};

// ============================================================================
// Componente principal
// ============================================================================

export function SuscripcionesClient({ initialStats }: { initialStats: Stats }) {
  const [stats, setStats] = useState<Stats>(initialStats);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<UserPlan | "all">("all");
  const [statusFilter, setStatusFilter] = useState<
    "active" | "suspended" | "invited" | "all"
  >("all");
  const [activeInDays, setActiveInDays] = useState<number | null>(null);
  const [expiringInDays, setExpiringInDays] = useState<number | null>(null);
  const [sort, setSort] = useState<
    "createdAtDesc" | "lastLoginDesc" | "planExpiresAsc" | "emailAsc"
  >("createdAtDesc");

  // Paginacion
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Modal
  const [editing, setEditing] = useState<UserRow | null>(null);

  // Debounce search input (300ms) — evita hammer al backend al tipear
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sort", sort);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (planFilter !== "all") params.set("plan", planFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (activeInDays) params.set("activeInDays", String(activeInDays));
      if (expiringInDays) params.set("expiringInDays", String(expiringInDays));

      const [rUsers, rStats] = await Promise.all([
        fetch(`/api/v1/admin/users?${params.toString()}`),
        fetch(`/api/v1/admin/users/stats`),
      ]);
      const jUsers = await rUsers.json();
      const jStats = await rStats.json();
      if (jUsers.error) {
        setError(jUsers.error.message ?? "Error cargando usuarios");
        return;
      }
      if (jStats.error) {
        setError(jStats.error.message ?? "Error cargando stats");
        return;
      }
      const data = jUsers.data as PagedResp;
      setRows(data.rows);
      setTotal(data.total);
      setStats(jStats.data as Stats);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    sort,
    debouncedSearch,
    planFilter,
    statusFilter,
    activeInDays,
    expiringInDays,
  ]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Reset a page 1 cuando cambia cualquier filtro
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, planFilter, statusFilter, activeInDays, expiringInDays, sort]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <StatsGrid stats={stats} />

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Buscar
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Email o nombre..."
              className="w-full h-9 pl-9 pr-3 text-sm rounded border border-slate-300 bg-white focus:border-brand-500 outline-none"
            />
          </div>
        </div>
        <FilterSelect
          label="Plan"
          value={planFilter}
          onChange={(v) => setPlanFilter(v as UserPlan | "all")}
          options={[
            { value: "all", label: "Todos" },
            { value: "free", label: "Free" },
            { value: "academic", label: "Académico" },
            { value: "pro", label: "Pro" },
            { value: "business", label: "Business" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(v) =>
            setStatusFilter(v as "active" | "suspended" | "invited" | "all")
          }
          options={[
            { value: "all", label: "Todos" },
            { value: "active", label: "Activos" },
            { value: "suspended", label: "Suspendidos" },
            { value: "invited", label: "Invitados" },
          ]}
        />
        <FilterSelect
          label="Actividad"
          value={activeInDays === null ? "" : String(activeInDays)}
          onChange={(v) => setActiveInDays(v === "" ? null : Number(v))}
          options={[
            { value: "", label: "Cualquiera" },
            { value: "7", label: "Últimos 7d" },
            { value: "30", label: "Últimos 30d" },
            { value: "90", label: "Últimos 90d" },
          ]}
        />
        <FilterSelect
          label="Expira en"
          value={expiringInDays === null ? "" : String(expiringInDays)}
          onChange={(v) => setExpiringInDays(v === "" ? null : Number(v))}
          options={[
            { value: "", label: "Cualquiera" },
            { value: "7", label: "Próx. 7d" },
            { value: "30", label: "Próx. 30d" },
          ]}
        />
        <FilterSelect
          label="Ordenar"
          value={sort}
          onChange={(v) =>
            setSort(
              v as
                | "createdAtDesc"
                | "lastLoginDesc"
                | "planExpiresAsc"
                | "emailAsc",
            )
          }
          options={[
            { value: "createdAtDesc", label: "Más recientes" },
            { value: "lastLoginDesc", label: "Último login" },
            { value: "planExpiresAsc", label: "Expira antes" },
            { value: "emailAsc", label: "Email A→Z" },
          ]}
        />
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#FFC000] border-b-2 border-slate-900/30">
              <tr>
                <Th>Usuario</Th>
                <Th>Plan</Th>
                <Th>Expira</Th>
                <Th>Último login</Th>
                <Th>Rol</Th>
                <Th>Status</Th>
                <Th>Alta</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Cargando suscriptores...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-slate-500">
                    Sin resultados para los filtros aplicados.
                  </td>
                </tr>
              ) : (
                rows.map((u) => <UserRowView key={u.id} u={u} onEdit={() => setEditing(u)} />)
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
            <span>
              Mostrando <strong>{(page - 1) * pageSize + 1}</strong>–
              <strong>{Math.min(page * pageSize, total)}</strong> de{" "}
              <strong>{total.toLocaleString("es-PE")}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="p-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-500">
                Página <strong>{page}</strong> de <strong>{totalPages}</strong>
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                className="p-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <ChangePlanModal
          user={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            cargar();
          }}
        />
      )}
    </>
  );
}

// ============================================================================
// Stats cards
// ============================================================================

function StatsGrid({ stats }: { stats: Stats }) {
  const paidCount =
    stats.byPlan.academic + stats.byPlan.pro + stats.byPlan.business;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={DollarSign}
        iconClass="text-emerald-600 bg-emerald-100"
        label="MRR estimado"
        value={`$${stats.mrrUsd.toLocaleString("en-US")}`}
        hint={`${paidCount} suscriptor${paidCount === 1 ? "" : "es"} pagando`}
      />
      <StatCard
        icon={UsersIcon}
        iconClass="text-brand-600 bg-brand-100"
        label="Total registrados"
        value={stats.total.toLocaleString("es-PE")}
        hint={`${stats.byPlan.free} en free`}
      />
      <StatCard
        icon={Activity}
        iconClass="text-sky-600 bg-sky-100"
        label="Activos 30 días"
        value={stats.activeLast30d.toLocaleString("es-PE")}
        hint={`${stats.activeLast7d} en últimos 7d`}
      />
      <StatCard
        icon={AlarmClock}
        iconClass={
          stats.expiringNext7d > 0
            ? "text-rose-600 bg-rose-100"
            : "text-amber-600 bg-amber-100"
        }
        label="Expiran 7 días"
        value={stats.expiringNext7d.toString()}
        hint={`${stats.expiringNext30d} en próx. 30d`}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconClass,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  iconClass: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {value}
          </p>
          <p className="text-xs text-slate-500 mt-1 truncate">{hint}</p>
        </div>
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", iconClass)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Rows + helpers
// ============================================================================

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-900",
        className,
      )}
    >
      {children}
    </th>
  );
}

function UserRowView({ u, onEdit }: { u: UserRow; onEdit: () => void }) {
  const meta = PLAN_META[u.plan];
  const expiry = fmtDaysToExpiry(u.planExpiresAt);
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {(u.name || u.email)
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase() || "?"}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-slate-900 truncate">
              {u.name || "(sin nombre)"}
            </div>
            <div className="text-xs text-slate-500 truncate flex items-center gap-1">
              {u.email}
              {u.academicVerifiedAt && (
                <span
                  title={`Email .edu.pe verificado ${fmtDateShort(u.academicVerifiedAt)}`}
                  className="inline-flex items-center"
                >
                  <GraduationCap className="w-3 h-3 text-sky-600" />
                </span>
              )}
              {!u.emailVerified && (
                <span className="text-[10px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-medium uppercase">
                  no verif
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider",
            planColorClasses[u.plan],
          )}
        >
          {meta.labelCorto}
          {meta.precioMensualUsd > 0 && (
            <span className="opacity-70 font-normal">${meta.precioMensualUsd}</span>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs">
        <span
          className={cn(
            "tabular-nums",
            expiry.urgent ? "text-rose-600 font-semibold" : "text-slate-600",
          )}
        >
          {expiry.text}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-600 tabular-nums">
        {fmtRelativeLogin(u.lastLoginAt)}
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium uppercase tracking-wider",
            u.role === "admin"
              ? "bg-violet-100 text-violet-700"
              : "bg-slate-100 text-slate-700",
          )}
        >
          {u.role === "admin" ? (
            <Crown className="w-3 h-3" />
          ) : (
            <UserIcon className="w-3 h-3" />
          )}
          {u.role}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium uppercase tracking-wider",
            u.status === "active"
              ? "bg-emerald-100 text-emerald-700"
              : u.status === "suspended"
                ? "bg-rose-100 text-rose-700"
                : "bg-amber-100 text-amber-700",
          )}
        >
          {u.status}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-500 tabular-nums">
        {fmtDateShort(u.createdAt)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 px-2.5 h-7 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded"
        >
          <Sparkles className="w-3 h-3" />
          Cambiar plan
        </button>
      </td>
    </tr>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="w-36">
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 text-sm rounded border border-slate-300 bg-white focus:border-brand-500 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================================
// Modal: cambiar plan
// ============================================================================

function ChangePlanModal({
  user,
  onCancel,
  onSaved,
}: {
  user: UserRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState<UserPlan>(user.plan);
  const [expiresAt, setExpiresAt] = useState<string>(
    user.planExpiresAt ? user.planExpiresAt.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState<string>(user.planNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaidPlan = plan !== "free";
  const suggestedExpiry = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const guardar = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { plan };
      body.planNotes = notes.trim() ? notes.trim() : null;
      if (isPaidPlan) {
        body.planExpiresAt = expiresAt
          ? new Date(`${expiresAt}T23:59:59`).toISOString()
          : null;
      } else {
        // Free no tiene expiracion
        body.planExpiresAt = null;
      }
      const r = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) {
        setError(j.error.message ?? "Error");
        return;
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Cambiar plan</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {user.name || "(sin nombre)"} · {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Plan destino
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["free", "academic", "pro", "business"] as UserPlan[]).map((p) => {
                const meta = PLAN_META[p];
                const selected = plan === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlan(p)}
                    className={cn(
                      "text-left px-3 py-2.5 rounded-lg border transition-colors",
                      selected
                        ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                        : "border-slate-200 hover:border-slate-300 bg-white",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900">
                        {meta.label}
                      </span>
                      {selected && <Check className="w-4 h-4 text-brand-600" />}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {meta.precioMensualUsd > 0
                        ? `$${meta.precioMensualUsd}/mes`
                        : "Gratis"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {isPaidPlan && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                <CalendarClock className="w-3.5 h-3.5 inline mr-1" />
                Fecha de expiración
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="flex-1 h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setExpiresAt(suggestedExpiry)}
                  className="px-3 h-9 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded"
                >
                  +1 mes
                </button>
                <button
                  type="button"
                  onClick={() => setExpiresAt("")}
                  className="px-3 h-9 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Perpetuo
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Vacío = perpetuo (admin manual, sin auto-downgrade).
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notas (visible sólo para admins)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Ej: pagó por Yape S/. 35, contacto WhatsApp 987..."
              className="w-full px-3 py-2 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none resize-none"
            />
          </div>

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 h-9 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={saving}
            className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

