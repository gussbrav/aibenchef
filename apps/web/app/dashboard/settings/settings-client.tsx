"use client";

import { useEffect, useState } from "react";
import {
  CloudRain,
  Database,
  History,
  Key,
  MailPlus,
  Menu,
  Settings,
  Sliders,
  Sparkles,
  User as UserIcon,
  Users as UsersIcon,
  Wrench,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { PLAN_LIMITS, type UserPlan } from "@/lib/plans";

import { AiProvidersSection } from "./ai-providers-section";
import { ApiKeysSection } from "./api-keys-section";
import { AuditSection } from "./audit-section";
import { DebugSection } from "./debug-section";
import { InvitationsSection } from "./invitations-section";
import { ProfileSection } from "./profile-section";
import { SystemSettingsSection } from "./system-settings-section";
import { UsersSection } from "./users-section";
import { EntityProfilesClient } from "../admin/entity-profiles/entity-profiles-client";
import { MacroContextClient } from "../admin/macro-context/macro-context-client";

type Tab =
  | "perfil"
  | "api-keys"
  | "ai"
  | "usuarios"
  | "invitaciones"
  | "sistema"
  | "auditoria"
  | "debug"
  | "perfiles-entidad"
  | "contexto-macro";

type NavItem = {
  id: Tab;
  label: string;
  icon: typeof UserIcon;
  adminOnly?: boolean;
  hidden?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

type Me = { id: string; role: "admin" | "usuario"; plan?: UserPlan };

export function SettingsClient() {
  const [tab, setTab] = useState<Tab>("perfil");
  const [me, setMe] = useState<Me | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/v1/me")
      .then((r) => r.json())
      .then((j) => {
        if (j.data) setMe(j.data as Me);
      })
      .catch(() => {});
  }, []);

  const isAdmin = me?.role === "admin";
  const apiAccessAllowed =
    isAdmin || (me?.plan ? PLAN_LIMITS[me.plan].apiAccess : false);

  // Sidebar agrupado — escala bien a 10+ items sin saturar.
  const groups: NavGroup[] = [
    {
      label: "Mi cuenta",
      items: [
        { id: "perfil", label: "Mi perfil", icon: UserIcon },
        { id: "api-keys", label: "API keys", icon: Key, hidden: !apiAccessAllowed },
      ],
    },
    {
      label: "IA y contexto",
      items: [
        { id: "ai", label: "Proveedores AI", icon: Sparkles, adminOnly: true },
        { id: "perfiles-entidad", label: "Perfiles entidad", icon: Database, adminOnly: true },
        { id: "contexto-macro", label: "Contexto macro", icon: CloudRain, adminOnly: true },
      ],
    },
    {
      label: "Equipo",
      items: [
        { id: "usuarios", label: "Usuarios", icon: UsersIcon, adminOnly: true },
        { id: "invitaciones", label: "Invitaciones", icon: MailPlus, adminOnly: true },
      ],
    },
    {
      label: "Sistema",
      items: [
        { id: "sistema", label: "Preferencias", icon: Sliders, adminOnly: true },
        { id: "auditoria", label: "Auditoría", icon: History, adminOnly: true },
        { id: "debug", label: "Diagnóstico", icon: Wrench, adminOnly: true },
      ],
    },
  ];

  // Encuentra la label del tab activo (para mostrar en header mobile)
  const activeItem = groups
    .flatMap((g) => g.items)
    .find((i) => i.id === tab);

  const handleSelect = (id: Tab) => {
    setTab(id);
    setMobileOpen(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-slate-600" />
          Configuración
        </h1>
      </header>

      {/* Mobile: botón para abrir sidebar */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="w-full flex items-center justify-between px-4 h-11 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-900"
        >
          <span className="inline-flex items-center gap-2">
            {activeItem && <activeItem.icon className="w-4 h-4 text-slate-600" />}
            {activeItem?.label ?? "Secciones"}
          </span>
          <Menu className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      <div className="flex gap-6">
        {/* Sidebar desktop */}
        <aside className="hidden md:block w-56 flex-shrink-0">
          <nav className="space-y-6 sticky top-6">
            {groups.map((g) => {
              const visibleItems = g.items.filter((it) => {
                if (it.hidden) return false;
                if (it.adminOnly && !isAdmin) return false;
                return true;
              });
              if (visibleItems.length === 0) return null;
              return (
                <div key={g.label}>
                  <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {g.label}
                  </div>
                  <ul className="space-y-0.5">
                    {visibleItems.map((it) => {
                      const Icon = it.icon;
                      const active = tab === it.id;
                      return (
                        <li key={it.id}>
                          <button
                            type="button"
                            onClick={() => handleSelect(it.id)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 h-9 text-sm font-medium rounded-md transition-colors",
                              active
                                ? "bg-brand-50 text-brand-700"
                                : "text-slate-700 hover:bg-slate-100",
                            )}
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate text-left">{it.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Contenido */}
        <main className="flex-1 min-w-0">
          {tab === "perfil" && <ProfileSection />}
          {tab === "api-keys" && apiAccessAllowed && <ApiKeysSection />}
          {tab === "ai" && isAdmin && <AiProvidersSection />}
          {tab === "perfiles-entidad" && isAdmin && <EntityProfilesClient />}
          {tab === "contexto-macro" && isAdmin && <MacroContextClient />}
          {tab === "usuarios" && isAdmin && me && <UsersSection currentUserId={me.id} />}
          {tab === "invitaciones" && isAdmin && <InvitationsSection />}
          {tab === "sistema" && isAdmin && <SystemSettingsSection />}
          {tab === "auditoria" && isAdmin && <AuditSection />}
          {tab === "debug" && isAdmin && <DebugSection />}
          {tab !== "perfil" && tab !== "api-keys" && !isAdmin && (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded text-sm text-slate-600 text-center">
              Esta sección es solo para administradores.
            </div>
          )}
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200">
              <span className="font-semibold text-slate-900">Secciones</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1 hover:bg-slate-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-3 space-y-5">
              {groups.map((g) => {
                const visibleItems = g.items.filter((it) => {
                  if (it.hidden) return false;
                  if (it.adminOnly && !isAdmin) return false;
                  return true;
                });
                if (visibleItems.length === 0) return null;
                return (
                  <div key={g.label}>
                    <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {g.label}
                    </div>
                    <ul className="space-y-0.5">
                      {visibleItems.map((it) => {
                        const Icon = it.icon;
                        const active = tab === it.id;
                        return (
                          <li key={it.id}>
                            <button
                              type="button"
                              onClick={() => handleSelect(it.id)}
                              className={cn(
                                "w-full flex items-center gap-2.5 px-3 h-10 text-sm font-medium rounded-md transition-colors",
                                active
                                  ? "bg-brand-50 text-brand-700"
                                  : "text-slate-700 hover:bg-slate-100",
                              )}
                            >
                              <Icon className="w-4 h-4 flex-shrink-0" />
                              <span className="truncate text-left">{it.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
