import "server-only";

import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";

import { db } from "@/lib/infrastructure/db";
import { requireSession } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";

// ── Colores corporativos ──────────────────────────────────────────────────────
const C = {
  azul:        "FF1E3A5F",
  azulClaro:   "FFE8F0F8",
  dorado:      "FFFFC000",
  doradoClaro: "FFFFF9E6",
  teal:        "FF0F766E",
  tealClaro:   "FFE6FAF8",
  grisOsc:     "FF475569",
  grisMed:     "FF94A3B8",
  grisClaro:   "FFF8FAFC",
  blanco:      "FFFFFFFF",
  verde:       "FFD1FAE5",
  verdeOsc:    "FF166534",
  amarillo:    "FFFEF9C3",
  rojo:        "FFFEE2E2",
  rojoOsc:     "FF991B1B",
  negro:       "FF0F172A",
};

function fillSolid(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}
function fontBold(cell: ExcelJS.Cell, size = 10, argb = C.negro) {
  cell.font = { bold: true, size, color: { argb } };
}
function border(cell: ExcelJS.Cell) {
  const s = { style: "thin" as ExcelJS.BorderStyle, color: { argb: "FFE2E8F0" } };
  cell.border = { top: s, left: s, bottom: s, right: s };
}

const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const fmtDic      = (p: number) => `Dic ${Math.floor(p / 100)}`;
const fmtPeriodo  = (p: number) => `${MESES[(p % 100) - 1]} ${Math.floor(p / 100)}`;
const miles       = (v: number | null | undefined): number | null => v == null ? null : Math.round(v / 1_000);
const pct2        = (v: number | null | undefined): number | null => v == null ? null : Math.round(v * 10_000) / 100;

// ── Tipos de filas de datos ───────────────────────────────────────────────────
type BalRow = {
  periodo: number; nomb_correg: string;
  cta_a1: string|null; cta_a3: string|null;
  cta_a4: string|null; cta_a4_1: string|null; cta_a4_2: string|null;
  cta_a4_3: string|null; cta_a4_4: string|null;
  cta_b1: string|null; cta_b4: string|null;
};
type ErRow = {
  periodo: number; nomb_correg: string;
  cta_1_4: string|null; cta_2: string|null; cta_4: string|null;
  cta_6: string|null; cta_7: string|null; cta_8: string|null;
  cta_10: string|null; cta_10_1: string|null; cta_10_2: string|null;
  cta_10_3: string|null; cta_10_4: string|null;
  cta_12_7: string|null; cta_12_8: string|null; cta_13: string|null;
};
type MesRow = {
  periodo: number; nomb_correg: string;
  cta_a4: string|null; cta_a4_1: string|null; cta_a4_2: string|null; cta_a4_3: string|null;
};
type KpiRow = { periodo: number; nomb_correg: string; kpi_codigo: string; valor: string|null; };

function n(v: string | null | undefined): number | null {
  if (v == null) return null;
  const x = parseFloat(String(v));
  return isNaN(x) ? null : x;
}

function carteraBruta12m(serie: MesRow[], periodo: number): number | null {
  const mes  = periodo % 100;
  const anio = Math.floor(periodo / 100);
  // Ventana estricta de 12 meses: 11 meses atrás hasta periodo (inclusive)
  let startMes = mes - 11;
  let startAnio = anio;
  if (startMes <= 0) { startMes += 12; startAnio -= 1; }
  const ini  = startAnio * 100 + startMes;
  const v    = serie.filter(x => x.periodo >= ini && x.periodo <= periodo);
  const vals = v.map(x => (n(x.cta_a4_1) ?? 0) + (n(x.cta_a4_2) ?? 0) + (n(x.cta_a4_3) ?? 0)).filter(x => x > 0);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function generarExcel(opts: {
  entidades: string[];
  desde: number;
  hasta: number;
  secciones: string[];
}): Promise<Buffer> {
  const { entidades, desde, hasta, secciones } = opts;
  const DIC_PERIODOS = Array.from({ length: hasta - desde + 1 }, (_, i) => (desde + i) * 100 + 12);
  const MES_INICIO = desde * 100 + 1;
  const MES_FIN    = hasta * 100 + 12;

  // IN clause con parámetros escalares individuales — drizzle no soporta
  // arrays JS como parámetros SQL (los serializa como record/tuple).
  const entIn = sql.join(entidades.map(e => sql`${e}`), sql`, `);

  // ── Consultas paralelas ───────────────────────────────────────────────────
  const [balRows, erRows, mesRows, kpiRows] = await Promise.all([
    secciones.includes("balance") ? db.execute<BalRow>(sql`
      SELECT periodo, nomb_correg,
        cta_a1, cta_a3, cta_a4, cta_a4_1, cta_a4_2, cta_a4_3, cta_a4_4,
        cta_b1, cta_b4
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([]),

    secciones.includes("er") ? db.execute<ErRow>(sql`
      SELECT periodo, nomb_correg,
        cta_1_4, cta_2, cta_4, cta_6, cta_7, cta_8,
        cta_10, cta_10_1, cta_10_2, cta_10_3, cta_10_4,
        cta_12_7, cta_12_8, cta_13
      FROM marts.mv_eeff_resultados_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([]),

    secciones.includes("cartera") ? db.execute<MesRow>(sql`
      SELECT periodo, nomb_correg, cta_a4, cta_a4_1, cta_a4_2, cta_a4_3
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo BETWEEN ${MES_INICIO} AND ${MES_FIN}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([]),

    secciones.includes("cartera") ? db.execute<KpiRow>(sql`
      SELECT periodo, nomb_correg, kpi_codigo, valor
      FROM marts.fact_kpis_mensuales
      WHERE nomb_correg IN (${entIn})
        AND kpi_codigo IN (
          'pe_rendimiento_cartera','pe_costo_fondeo','pe_costo_provisiones',
          'pe_gastos_operacionales','pe_punto_equilibrio','pe_margen_neto'
        )
        AND moneda = 'TOTAL'
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
      ORDER BY nomb_correg, periodo, kpi_codigo
    `) : Promise.resolve([]),
  ]);

  // Índices en memoria
  const balIdx = new Map<string, BalRow>();
  for (const r of balRows) balIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

  const erIdx = new Map<string, ErRow>();
  for (const r of erRows) erIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

  const mesIdx = new Map<string, MesRow[]>();
  for (const r of mesRows) {
    if (!mesIdx.has(r.nomb_correg)) mesIdx.set(r.nomb_correg, []);
    mesIdx.get(r.nomb_correg)!.push(r);
  }

  const kpiIdx = new Map<string, Map<string, number | null>>();
  for (const r of kpiRows) {
    const key = `${r.nomb_correg}__${r.periodo}`;
    if (!kpiIdx.has(key)) kpiIdx.set(key, new Map());
    kpiIdx.get(key)!.set(r.kpi_codigo, n(r.valor));
  }

  // ── Workbook ─────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator  = "Aibenchef";
  wb.created  = new Date();
  wb.modified = new Date();

  // ── PORTADA ───────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Portada");
    ws.views = [{ showGridLines: false }];
    ws.columns = [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
    let r = 1;

    ws.mergeCells(r, 1, r, 7);
    const titleCell = ws.getRow(r).getCell(1);
    titleCell.value = `Reporte EEFF — ${entidades.length} entidad${entidades.length > 1 ? "es" : ""}`;
    titleCell.font  = { bold: true, size: 18, color: { argb: C.blanco } };
    titleCell.alignment = { horizontal: "left", vertical: "middle" };
    fillSolid(titleCell, C.azul);
    ws.getRow(r).height = 36; r++;

    ws.mergeCells(r, 1, r, 7);
    const sub = ws.getRow(r).getCell(1);
    sub.value = `Saldos en Miles S/ · SBS · Aibenchef · Generado: ${new Date().toLocaleDateString("es-PE")} · Rango: ${desde}–${hasta}`;
    sub.font  = { size: 10, color: { argb: C.blanco }, italic: true };
    fillSolid(sub, C.azul); ws.getRow(r).height = 18; r++;

    r++;

    const headers = ["Entidad", "Primer Dic disponible", "Último Dic disponible", `Cartera Bruta Dic ${hasta} (Miles S/)`, `PE Dic ${hasta} (%)`, `Rend. Dic ${hasta} (%)`, "Estado"];
    const hRow = ws.getRow(r);
    headers.forEach((h, i) => {
      const c = hRow.getCell(i + 1);
      c.value = h; fontBold(c, 10, C.blanco); fillSolid(c, C.azul);
      c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
      border(c);
    });
    hRow.height = 20; r++;

    for (let ei = 0; ei < entidades.length; ei++) {
      const ent     = entidades[ei]!;
      const lastDic = DIC_PERIODOS[DIC_PERIODOS.length - 1]!;
      const bal     = balIdx.get(`${ent}__${lastDic}`);
      const kpiMap  = kpiIdx.get(`${ent}__${lastDic}`);
      const pe      = kpiMap?.get("pe_punto_equilibrio") ?? null;
      const rend    = kpiMap?.get("pe_rendimiento_cartera") ?? null;
      const carBruta = bal ? miles((n(bal.cta_a4_1) ?? 0) + (n(bal.cta_a4_2) ?? 0) + (n(bal.cta_a4_3) ?? 0)) : null;
      const firstDic  = DIC_PERIODOS.find(p => balIdx.has(`${ent}__${p}`));
      const lastDicOk = [...DIC_PERIODOS].reverse().find(p => balIdx.has(`${ent}__${p}`));
      const hasKpi    = pe != null && rend != null;
      const bg        = ei % 2 === 0 ? C.blanco : C.grisClaro;

      const row = ws.getRow(r);
      const vals: (string | number | null)[] = [
        ent,
        firstDic   ? fmtDic(firstDic)   : "—",
        lastDicOk  ? fmtDic(lastDicOk)  : "—",
        carBruta,
        rend != null ? pct2(rend) : null,
        pe   != null ? pct2(pe)   : null,
        hasKpi ? "Con KPI" : "Sin KPI",
      ];
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
        fillSolid(c, i === 6 ? (hasKpi ? C.verde : C.amarillo) : bg);
        border(c);
        if (i === 3 && typeof v === "number") c.numFmt = '#,##0';
        if ((i === 4 || i === 5) && typeof v === "number") c.numFmt = '0.00"%"';
        if (i === 6) c.font = { bold: true, size: 10, color: { argb: hasKpi ? C.verdeOsc : C.grisOsc } };
      });
      r++;
    }

    r++;
    ws.mergeCells(r, 1, r, 7);
    const nota = ws.getRow(r).getCell(1);
    nota.value = "Metodología: Cartera bruta = cta_a4_1 + cta_a4_2 + cta_a4_3 (antes de provisiones). Prom.12M = promedio de los 12 meses que terminan en el periodo (inclusive), equivale al año calendario para diciembre. PE = Costo Fondeo + Provisiones + Gastos Operacionales sobre Cartera Prom. Fuente: marts.v_eeff_balance_ancho, marts.mv_eeff_resultados_ancho, marts.fact_kpis_mensuales.";
    nota.font = { size: 9, italic: true, color: { argb: C.grisMed } };
    nota.alignment = { wrapText: true };
    ws.getRow(r).height = 36;
  }

  // ── BALANCE DICIEMBRES ────────────────────────────────────────────────────
  if (secciones.includes("balance")) {
    const ws = wb.addWorksheet("Balance Dic");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];
    const nCols = entidades.length * DIC_PERIODOS.length;
    ws.columns = [{ width: 24 }, { width: 36 }, ...Array(nCols).fill({ width: 14 })];
    let r = 1;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = `Balance — Saldos de Diciembre (Miles S/)`;
    t.font  = { bold: true, size: 14, color: { argb: C.blanco } };
    fillSolid(t, C.azul); ws.getRow(r).height = 28; r++;

    // Header entidades
    const h1 = ws.getRow(r);
    fillSolid(h1.getCell(1), C.azul); fillSolid(h1.getCell(2), C.azul);
    for (let ei = 0; ei < entidades.length; ei++) {
      const col = 3 + ei * DIC_PERIODOS.length;
      ws.mergeCells(r, col, r, col + DIC_PERIODOS.length - 1);
      const c = h1.getCell(col);
      c.value = entidades[ei]!; fontBold(c, 10, C.blanco);
      c.alignment = { horizontal: "center" }; fillSolid(c, C.azul);
    }
    h1.height = 20; r++;

    // Header años
    const h2 = ws.getRow(r);
    h2.getCell(1).value = "GRUPO"; fontBold(h2.getCell(1), 9, C.blanco); fillSolid(h2.getCell(1), C.grisOsc); h2.getCell(1).alignment = { horizontal: "center" };
    h2.getCell(2).value = "CUENTA"; fontBold(h2.getCell(2), 9, C.blanco); fillSolid(h2.getCell(2), C.grisOsc);
    for (let ei = 0; ei < entidades.length; ei++) {
      for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
        const col = 3 + ei * DIC_PERIODOS.length + pi;
        const c   = h2.getCell(col);
        c.value   = fmtDic(DIC_PERIODOS[pi]!);
        fontBold(c, 9, C.blanco); fillSolid(c, C.grisOsc);
        c.alignment = { horizontal: "center" }; border(c);
      }
    }
    h2.height = 18; r++;

    type BalDef = { grupo: string; label: string; fn: (b: BalRow) => number | null; bold?: boolean };
    const balDefs: BalDef[] = [
      { grupo: "ACTIVO",  label: "Cartera Bruta",                   fn: b => (n(b.cta_a4_1)??0)+(n(b.cta_a4_2)??0)+(n(b.cta_a4_3)??0), bold: true },
      { grupo: "",        label: "   Vigentes",                      fn: b => n(b.cta_a4_1) },
      { grupo: "",        label: "   Refinanciados/Reestructurados", fn: b => n(b.cta_a4_2) },
      { grupo: "",        label: "   Vencidos y en Cobranza Jud.",   fn: b => n(b.cta_a4_3) },
      { grupo: "",        label: "   Provisiones (negativo)",        fn: b => n(b.cta_a4_4) },
      { grupo: "",        label: "Cartera Neta",                     fn: b => n(b.cta_a4), bold: true },
      { grupo: "",        label: "Disponible",                       fn: b => n(b.cta_a1) },
      { grupo: "",        label: "Inversiones",                      fn: b => n(b.cta_a3) },
      { grupo: "PASIVO",  label: "Obligaciones con el Público",      fn: b => n(b.cta_b1), bold: true },
      { grupo: "",        label: "Adeudos y Oblig. Financieras",     fn: b => n(b.cta_b4) },
    ];

    for (let di = 0; di < balDefs.length; di++) {
      const def   = balDefs[di]!;
      const isAlt = di % 2 === 0;
      const row   = ws.getRow(r);
      const gCell = row.getCell(1);
      gCell.value = def.grupo;
      fontBold(gCell, 9, C.blanco); fillSolid(gCell, def.grupo ? C.azul : C.grisClaro);
      gCell.alignment = { horizontal: "center", vertical: "middle" };
      const lCell = row.getCell(2);
      lCell.value = def.label;
      lCell.font  = { bold: !!def.bold, size: 10, color: { argb: C.negro } };
      fillSolid(lCell, def.bold ? C.doradoClaro : (isAlt ? C.grisClaro : C.blanco));
      border(lCell);
      for (let ei = 0; ei < entidades.length; ei++) {
        for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
          const col = 3 + ei * DIC_PERIODOS.length + pi;
          const c   = row.getCell(col);
          const bal = balIdx.get(`${entidades[ei]}__${DIC_PERIODOS[pi]}`);
          const v   = bal ? miles(def.fn(bal)) : null;
          c.value = v; c.numFmt = '#,##0';
          c.alignment = { horizontal: "right" };
          fillSolid(c, def.bold ? C.doradoClaro : (isAlt ? C.grisClaro : C.blanco));
          if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: "FFB91C1C" } };
          border(c);
        }
      }
      r++;
    }
  }

  // ── ESTADO DE RESULTADOS DICIEMBRES ───────────────────────────────────────
  if (secciones.includes("er")) {
    const ws = wb.addWorksheet("ER Dic");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];
    const nCols = entidades.length * DIC_PERIODOS.length;
    ws.columns = [{ width: 24 }, { width: 36 }, ...Array(nCols).fill({ width: 14 })];
    let r = 1;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = `Estado de Resultados — Diciembres YTD (Miles S/)`;
    t.font  = { bold: true, size: 14, color: { argb: C.blanco } };
    fillSolid(t, C.teal); ws.getRow(r).height = 28; r++;

    const h1 = ws.getRow(r);
    fillSolid(h1.getCell(1), C.teal); fillSolid(h1.getCell(2), C.teal);
    for (let ei = 0; ei < entidades.length; ei++) {
      const col = 3 + ei * DIC_PERIODOS.length;
      ws.mergeCells(r, col, r, col + DIC_PERIODOS.length - 1);
      const c = h1.getCell(col);
      c.value = entidades[ei]!; fontBold(c, 10, C.blanco);
      c.alignment = { horizontal: "center" }; fillSolid(c, C.teal);
    }
    h1.height = 20; r++;

    const h2 = ws.getRow(r);
    h2.getCell(1).value = "GRUPO"; fontBold(h2.getCell(1), 9, C.blanco); fillSolid(h2.getCell(1), C.grisOsc); h2.getCell(1).alignment = { horizontal: "center" };
    h2.getCell(2).value = "CUENTA"; fontBold(h2.getCell(2), 9, C.blanco); fillSolid(h2.getCell(2), C.grisOsc);
    for (let ei = 0; ei < entidades.length; ei++) {
      for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
        const col = 3 + ei * DIC_PERIODOS.length + pi;
        const c   = h2.getCell(col);
        c.value   = fmtDic(DIC_PERIODOS[pi]!);
        fontBold(c, 9, C.blanco); fillSolid(c, C.grisOsc);
        c.alignment = { horizontal: "center" }; border(c);
      }
    }
    h2.height = 18; r++;

    type ErDef = { grupo: string; label: string; fn: (e: ErRow) => number | null; bold?: boolean };
    const erDefs: ErDef[] = [
      { grupo: "INGRESOS",  label: "Ingresos por Créditos (1.4)",     fn: e => n(e.cta_1_4), bold: true },
      { grupo: "",          label: "Ing. Servicios Financieros (6)",   fn: e => n(e.cta_6) },
      { grupo: "",          label: "Otros Ingresos/Gastos (8+13)",     fn: e => (n(e.cta_8)??0)+(n(e.cta_13)??0) },
      { grupo: "COSTOS",    label: "Gastos Financieros (2)",           fn: e => n(e.cta_2), bold: true },
      { grupo: "",          label: "Gastos Servicios Financieros (7)", fn: e => n(e.cta_7) },
      { grupo: "",          label: "Provisiones (4)",                  fn: e => n(e.cta_4), bold: true },
      { grupo: "GASTOS OP", label: "Total Gastos Operacionales (10)", fn: e => n(e.cta_10), bold: true },
      { grupo: "",          label: "   Personal (10.1)",               fn: e => n(e.cta_10_1) },
      { grupo: "",          label: "   Directorio (10.2)",             fn: e => n(e.cta_10_2) },
      { grupo: "",          label: "   Servicios de Terceros (10.3)",  fn: e => n(e.cta_10_3) },
      { grupo: "",          label: "   Impuestos y Contrib. (10.4)",   fn: e => n(e.cta_10_4) },
      { grupo: "",          label: "   Depreciación (12.7)",           fn: e => n(e.cta_12_7) },
      { grupo: "",          label: "   Amortización (12.8)",           fn: e => n(e.cta_12_8) },
    ];

    for (let di = 0; di < erDefs.length; di++) {
      const def   = erDefs[di]!;
      const isAlt = di % 2 === 0;
      const row   = ws.getRow(r);
      const gCell = row.getCell(1);
      gCell.value = def.grupo;
      fontBold(gCell, 9, C.blanco); fillSolid(gCell, def.grupo ? C.teal : C.grisClaro);
      gCell.alignment = { horizontal: "center", vertical: "middle" };
      const lCell = row.getCell(2);
      lCell.value = def.label;
      lCell.font  = { bold: !!def.bold, size: 10, color: { argb: C.negro } };
      fillSolid(lCell, def.bold ? C.tealClaro : (isAlt ? C.grisClaro : C.blanco));
      border(lCell);
      for (let ei = 0; ei < entidades.length; ei++) {
        for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
          const col = 3 + ei * DIC_PERIODOS.length + pi;
          const c   = row.getCell(col);
          const er  = erIdx.get(`${entidades[ei]}__${DIC_PERIODOS[pi]}`);
          const v   = er ? miles(def.fn(er)) : null;
          c.value = v; c.numFmt = '#,##0';
          c.alignment = { horizontal: "right" };
          fillSolid(c, def.bold ? C.tealClaro : (isAlt ? C.grisClaro : C.blanco));
          if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: "FFB91C1C" } };
          border(c);
        }
      }
      r++;
    }
  }

  // ── CARTERA MENSUAL & VALIDACIÓN PE ──────────────────────────────────────
  if (secciones.includes("cartera")) {
    const ws = wb.addWorksheet("Cartera & PE");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 3 }];
    const COLS_PER_ENT = 5;
    const nCols = entidades.length * COLS_PER_ENT;
    ws.columns = [{ width: 12 }, { width: 10 }, ...Array(nCols).fill({ width: 14 })];
    let r = 1;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = `Cartera Bruta Mensual & Validación PE — ${desde}–${hasta} (Miles S/ y %)`;
    t.font  = { bold: true, size: 14, color: { argb: C.azul } };
    fillSolid(t, C.dorado); ws.getRow(r).height = 28; r++;

    const h1 = ws.getRow(r);
    fillSolid(h1.getCell(1), C.azul); fillSolid(h1.getCell(2), C.azul);
    h1.getCell(1).value = "PERIODO"; fontBold(h1.getCell(1), 9, C.blanco); h1.getCell(1).alignment = { horizontal: "center" };
    h1.getCell(2).value = "MES";     fontBold(h1.getCell(2), 9, C.blanco); h1.getCell(2).alignment = { horizontal: "center" };
    for (let ei = 0; ei < entidades.length; ei++) {
      const col = 3 + ei * COLS_PER_ENT;
      ws.mergeCells(r, col, r, col + COLS_PER_ENT - 1);
      const c = h1.getCell(col);
      c.value = entidades[ei]!; fontBold(c, 10, C.blanco);
      c.alignment = { horizontal: "center" }; fillSolid(c, C.azul);
    }
    h1.height = 20; r++;

    const h2 = ws.getRow(r);
    fillSolid(h2.getCell(1), C.grisOsc); fillSolid(h2.getCell(2), C.grisOsc);
    const subCols = ["Cart.Bruta\n(Miles S/)", "Prom.12M\n(Miles S/)", "Rend.\nCartera %", "Punto\nEquilib. %", "Margen\nNeto %"];
    for (let ei = 0; ei < entidades.length; ei++) {
      for (let ci = 0; ci < COLS_PER_ENT; ci++) {
        const col = 3 + ei * COLS_PER_ENT + ci;
        const c   = h2.getCell(col);
        c.value   = subCols[ci]!; fontBold(c, 8, C.blanco);
        fillSolid(c, ci < 2 ? C.grisOsc : C.teal);
        c.alignment = { horizontal: "center", wrapText: true }; border(c);
      }
    }
    h2.height = 30; r++;

    for (let yr = desde; yr <= hasta; yr++) {
      for (let m = 1; m <= 12; m++) {
        const periodo = yr * 100 + m;
        const esDic   = m === 12;
        const row     = ws.getRow(r);
        const bg      = esDic ? C.doradoClaro : (r % 2 === 0 ? C.grisClaro : C.blanco);

        const pCell = row.getCell(1);
        pCell.value = periodo; pCell.numFmt = "000000";
        pCell.alignment = { horizontal: "center" };
        fillSolid(pCell, esDic ? C.dorado : bg);
        if (esDic) fontBold(pCell, 10, C.azul);
        border(pCell);

        const mCell = row.getCell(2);
        mCell.value = fmtPeriodo(periodo);
        mCell.alignment = { horizontal: "center" };
        fillSolid(mCell, esDic ? C.dorado : bg);
        if (esDic) fontBold(mCell, 10, C.azul);
        border(mCell);

        for (let ei = 0; ei < entidades.length; ei++) {
          const ent   = entidades[ei]!;
          const serie = mesIdx.get(ent) ?? [];
          const mes   = serie.find(x => x.periodo === periodo);
          const cartBruta = mes ? miles((n(mes.cta_a4_1)??0)+(n(mes.cta_a4_2)??0)+(n(mes.cta_a4_3)??0)) : null;
          const prom12m   = esDic ? miles(carteraBruta12m(serie, periodo)) : null;
          const kpiMap    = esDic ? kpiIdx.get(`${ent}__${periodo}`) : undefined;
          const rendim    = esDic ? pct2(kpiMap?.get("pe_rendimiento_cartera") ?? null) : null;
          const pe        = esDic ? pct2(kpiMap?.get("pe_punto_equilibrio") ?? null)    : null;
          const margen    = esDic ? pct2(kpiMap?.get("pe_margen_neto") ?? null)         : null;

          const vals = [cartBruta, prom12m, rendim, pe, margen];
          for (let ci = 0; ci < COLS_PER_ENT; ci++) {
            const col = 3 + ei * COLS_PER_ENT + ci;
            const c   = row.getCell(col);
            c.value   = vals[ci] ?? null;
            c.alignment = { horizontal: "right" };
            border(c);
            if (ci < 2) {
              c.numFmt = '#,##0'; fillSolid(c, esDic ? C.doradoClaro : bg);
              if (esDic) fontBold(c, 10);
            } else {
              c.numFmt = '0.00"%"';
              fillSolid(c, vals[ci] == null ? bg : (esDic ? C.tealClaro : bg));
              if (esDic && vals[ci] != null) fontBold(c, 10);
              if (ci === 4 && typeof vals[ci] === "number") {
                c.font = { bold: esDic, size: 10, color: { argb: (vals[ci] as number) >= 0 ? C.verdeOsc : C.rojoOsc } };
              }
            }
          }
        }
        r++;
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Route handler ─────────────────────────────────────────────────────────────
// Nota: no usamos handleRoute porque devuelve un archivo binario, no JSON.
// handleRoute envuelve el return en un Response JSON y rompe la descarga.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!(await isAdmin(session.id))) {
      return Response.json({ error: "Solo admins pueden generar reportes EEFF" }, { status: 403 });
    }

    const body = await req.json() as unknown;
    if (typeof body !== "object" || body === null)
      return Response.json({ error: "Body inválido" }, { status: 400 });

    const { entidades, desde, hasta, secciones } = body as Record<string, unknown>;

    if (!Array.isArray(entidades) || entidades.length === 0)
      return Response.json({ error: "Selecciona al menos una entidad" }, { status: 400 });
    if (entidades.length > 30)
      return Response.json({ error: `Máximo 30 entidades por reporte (seleccionadas: ${entidades.length})` }, { status: 400 });
    if (!Array.isArray(secciones) || secciones.length === 0)
      return Response.json({ error: "Selecciona al menos una sección" }, { status: 400 });

    const desdeNum = Number(desde);
    const hastaNum = Number(hasta);
    if (!Number.isInteger(desdeNum) || desdeNum < 2009 || desdeNum > 2030)
      return Response.json({ error: "desde debe ser un año entre 2009 y 2030" }, { status: 400 });
    if (!Number.isInteger(hastaNum) || hastaNum < desdeNum || hastaNum > 2030)
      return Response.json({ error: "hasta debe ser mayor o igual a desde" }, { status: 400 });

    const entList = (entidades as unknown[]).map(String);
    const secList = (secciones as unknown[]).map(String).filter(s => ["balance","er","cartera"].includes(s));

    const buffer = await generarExcel({ entidades: entList, desde: desdeNum, hasta: hastaNum, secciones: secList });
    const filename = `Reporte_EEFF_${desdeNum}-${hastaNum}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    console.error("[reportes/eeff] Error generando reporte:", err);
    const msg = err instanceof Error ? err.message : "Error interno al generar el reporte";
    return Response.json({ error: msg }, { status: 500 });
  }
}
