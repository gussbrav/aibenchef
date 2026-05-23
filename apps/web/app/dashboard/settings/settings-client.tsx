"use client";

import { useEffect, useState } from "react";
import {
  History,
  MailPlus,
  Settings,
  Sliders,
  Sparkles,
  User as UserIcon,
  Users as UsersIcon,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

import { AiProvidersSection } from "./ai-providers-section";
import { AuditSection } from "./audit-section";
import { DebugSection } from "./debug-section";
import { InvitationsSection } from "./invitations-section";
import { ProfileSection } from "./profile-section";
import { SystemSettingsSection } from "./system-settings-section";
import { UsersSection } from "./users-section";

type Tab =
  | "perfil"
  | "ai"
  | "usuarios"
  | "invitaciones"
  | "sistema"
  | "auditoria"
  | "debug";

type Me = { id: string; role: "admin" | "usuario" };

export function SettingsClient() {
  const [tab, setTab] = useState<Tab>("perfil");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/v1/me")
      .then((r) => r.json())
      .then((j) => {
        if (j.data) setMe(j.data as Me);
      })
      .catch(() => {});
  }, []);

  const tabs: Array<{ id: Tab; label: string; icon: typeof UserIcon; adminOnly?: boolean }> = [
    { id: "perfil", label: "Mi perfil", icon: UserIcon },
    { id: "ai", label: "Proveedores AI", icon: Sparkles, adminOnly: true },
    { id: "usuarios", label: "Usuarios", icon: UsersIcon, adminOnly: true },
    { id: "invitaciones", label: "Invitaciones", icon: MailPlus, adminOnly: true },
    { id: "sistema", label: "Sistema", icon: Sliders, adminOnly: true },
    { id: "auditoria", label: "Auditoria", icon: History, adminOnly: true },
    { id: "debug", label: "Diagnostico", icon: Wrench, adminOnly: true },
  ];

  const isAdmin = me?.role === "admin";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-slate-600" />
          Configuracion
        </h1>
      </header>

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          if (t.adminOnly && !isAdmin) return null;
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 h-10 text-sm font-medium inline-flex items-center gap-2 border-b-2 transition-colors",
                active
                  ? "border-brand-600 text-slate-900"
                  : "border-transparent text-slate-600 hover:text-slate-900",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === "perfil" && <ProfileSection />}
        {tab === "ai" && isAdmin && <AiProvidersSection />}
        {tab === "usuarios" && isAdmin && me && <UsersSection currentUserId={me.id} />}
        {tab === "invitaciones" && isAdmin && <InvitationsSection />}
        {tab === "sistema" && isAdmin && <SystemSettingsSection />}
        {tab === "auditoria" && isAdmin && <AuditSection />}
        {tab === "debug" && isAdmin && <DebugSection />}
        {tab !== "perfil" && !isAdmin && (
          <div className="p-6 bg-slate-50 border border-slate-200 rounded text-sm text-slate-600 text-center">
            Esta seccion es solo para administradores.
          </div>
        )}
      </div>
    </div>
  );
}
