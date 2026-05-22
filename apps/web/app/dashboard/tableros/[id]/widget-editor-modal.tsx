"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { SqlEditor } from "@/components/sql-editor";

import type { TableroWidget, WidgetConfig } from "@/lib/domains/tableros";

export function WidgetEditorModal({
  widget,
  onCancel,
  onSave,
}: {
  widget: TableroWidget;
  onCancel: () => void;
  onSave: (w: TableroWidget) => void;
}) {
  const [titulo, setTitulo] = useState(widget.titulo ?? "");
  const [config, setConfig] = useState<WidgetConfig>(widget.config);

  const handleSave = () => {
    onSave({
      ...widget,
      titulo: titulo.trim() || null,
      config,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="h-12 px-4 flex items-center justify-between border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">
            Editar widget: {widget.tipo}
          </h2>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Field label="Titulo">
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Titulo del widget"
              className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
            />
          </Field>

          {widget.tipo === "markdown" ? (
            <Field label="Contenido (markdown)">
              <textarea
                value={config.content ?? ""}
                onChange={(e) => setConfig({ ...config, content: e.target.value })}
                rows={12}
                className="w-full px-3 py-2 text-sm font-mono rounded border border-slate-300 focus:border-brand-500 outline-none resize-none"
              />
            </Field>
          ) : (
            <>
              <Field label="SQL (solo SELECT sobre marts.* y dw.*)">
                <div className="h-64 border border-slate-300 rounded overflow-hidden">
                  <SqlEditor
                    value={config.sql ?? ""}
                    onChange={(v) => setConfig({ ...config, sql: v })}
                  />
                </div>
              </Field>

              {widget.tipo === "kpi" ? (
                <KpiConfigFields config={config} setConfig={setConfig} />
              ) : widget.tipo === "table" ? (
                <FormatoFields config={config} setConfig={setConfig} />
              ) : (
                <ChartConfigFields config={config} setConfig={setConfig} />
              )}
            </>
          )}
        </div>

        <footer className="h-14 px-4 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 h-9 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded"
          >
            Guardar
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function KpiConfigFields({
  config,
  setConfig,
}: {
  config: WidgetConfig;
  setConfig: (c: WidgetConfig) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Campo">
        <input
          value={config.campo ?? ""}
          onChange={(e) => setConfig({ ...config, campo: e.target.value })}
          placeholder="ej: util_neta"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
      <FormatoSelect config={config} setConfig={setConfig} />
      <Field label="Decimales">
        <input
          type="number"
          value={config.decimales ?? 0}
          onChange={(e) => setConfig({ ...config, decimales: Number(e.target.value) })}
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
    </div>
  );
}

function ChartConfigFields({
  config,
  setConfig,
}: {
  config: WidgetConfig;
  setConfig: (c: WidgetConfig) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Eje X (columna)">
        <input
          value={config.xKey ?? ""}
          onChange={(e) => setConfig({ ...config, xKey: e.target.value })}
          placeholder="ej: periodo"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
      <Field label="Series (columna, opcional)">
        <input
          value={config.seriesKey ?? ""}
          onChange={(e) => setConfig({ ...config, seriesKey: e.target.value })}
          placeholder="ej: nomb_correg"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
      <Field label="Y keys (comma)">
        <input
          value={(config.yKeys ?? []).join(",")}
          onChange={(e) =>
            setConfig({
              ...config,
              yKeys: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="ej: util_neta,roa"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
      <FormatoSelect config={config} setConfig={setConfig} />
      <Field label="Decimales">
        <input
          type="number"
          value={config.decimales ?? 0}
          onChange={(e) => setConfig({ ...config, decimales: Number(e.target.value) })}
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
    </div>
  );
}

function FormatoFields({
  config,
  setConfig,
}: {
  config: WidgetConfig;
  setConfig: (c: WidgetConfig) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormatoSelect config={config} setConfig={setConfig} />
      <Field label="Decimales">
        <input
          type="number"
          value={config.decimales ?? 0}
          onChange={(e) => setConfig({ ...config, decimales: Number(e.target.value) })}
          className="w-full h-9 px-3 text-sm rounded border border-slate-300"
        />
      </Field>
    </div>
  );
}

function FormatoSelect({
  config,
  setConfig,
}: {
  config: WidgetConfig;
  setConfig: (c: WidgetConfig) => void;
}) {
  return (
    <Field label="Formato">
      <select
        value={config.formato ?? "numero"}
        onChange={(e) => setConfig({ ...config, formato: e.target.value as never })}
        className="w-full h-9 px-2 text-sm rounded border border-slate-300 bg-white"
      >
        <option value="numero">Numero</option>
        <option value="porcentaje">Porcentaje</option>
        <option value="moneda">Moneda (S/)</option>
      </select>
    </Field>
  );
}
