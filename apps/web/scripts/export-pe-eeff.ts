/**
 * export-pe-eeff.ts — Excel de validación PE por tipo de entidad.
 *
 * Genera un workbook profesional con 4 hojas:
 *   📋 Portada       — resumen ejecutivo con semáforos por entidad
 *   📊 Balance Dic   — saldos de balance en diciembres (cuentas × entidades)
 *   📊 ER Dic        — estado de resultados acumulado en diciembres
 *   📊 Cartera & PE  — cartera bruta mensual + prom 12M calculado vs KPI
 *
 * Uso:
 *   cd apps/web
 *   DATABASE_URL=postgres://... pnpm tsx scripts/export-pe-eeff.ts
 *   DATABASE_URL=postgres://... pnpm tsx scripts/export-pe-eeff.ts --tipo CMAC --desde 2015 --hasta 2025
 *   DATABASE_URL=postgres://... pnpm tsx scripts/export-pe-eeff.ts --tipo CRAC --desde 2018 --hasta 2025
 *
 * Parámetros:
 *   --tipo   Tipo de entidad en entidad_maestra (default: CMAC)
 *   --desde  Año inicial (default: 2015)
 *   --hasta  Año final   (default: 2025)
 *
 * Salida:
 *   exports/PE_EEFF_{TIPO}_{DESDE}_{HASTA}.xlsx
 */

import path from "node:path";
import fs   from "node:fs";
import postgres from "postgres";
import ExcelJS  from "exceljs";

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const TIPO  = getArg("--tipo")  ?? "CMAC";
const DESDE = parseInt(getArg("--desde") ?? "2015", 10);
const HASTA = parseInt(getArg("--hasta") ?? "2025", 10);

const DIC_PERIODOS = Array.from({ length: HASTA - DESDE + 1 }, (_, i) => (DESDE + i) * 100 + 12);
const MES_INICIO   = DESDE * 100 + 1;
const MES_FIN      = HASTA * 100 + 12;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("❌  DATABASE_URL no definida."); process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────
const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const fmtPeriodo  = (p: number) => `${MESES[(p % 100) - 1]} ${Math.floor(p / 100)}`;
const fmtDic      = (p: number) => `Dic ${Math.floor(p / 100)}`;
const miles       = (v: number | null | undefined): number | null => v == null ? null : Math.round(v / 1_000);
const pct2        = (v: number | null | undefined): number | null => v == null ? null : Math.round(v * 10_000) / 100; // decimal → %

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
function border(cell: ExcelJS.Cell, style: ExcelJS.BorderStyle = "thin") {
  const s = { style, color: { argb: "FFE2E8F0" } };
  cell.border = { top: s, left: s, bottom: s, right: s };
}
function fmt(cell: ExcelJS.Cell, numFmt: string) { cell.numFmt = numFmt; }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const sql = postgres(DB_URL!, { max: 1 });

  try {
    console.log(`\n📊  Generando reporte PE EEFF — tipo: ${TIPO} | ${DESDE}–${HASTA}\n`);

    // ── 1. Entidades activas ─────────────────────────────────────────────────
    const entRows = await sql<{ nombre: string }[]>`
      SELECT nomb_correg_canonico AS nombre
      FROM dw.entidad_maestra
      WHERE tipo_entidad_actual = ${TIPO} AND activa = TRUE
      ORDER BY nomb_correg_canonico
    `;
    const entidades = entRows.map(r => r.nombre);
    if (entidades.length === 0) {
      console.error(`❌  No se encontraron entidades activas de tipo "${TIPO}".`);
      process.exit(1);
    }
    console.log(`   ${entidades.length} entidades: ${entidades.join(" · ")}`);

    // ── 2. Saldos de Balance en Diciembres ───────────────────────────────────
    console.log("   Consultando balance...");
    type BalRow = {
      periodo: number; nomb_correg: string;
      cta_a1: number|null; cta_a3: number|null;
      cta_a4: number|null;   // cartera neta (después de provisiones)
      cta_a4_1: number|null; // vigentes
      cta_a4_2: number|null; // refinanciados/reestructurados
      cta_a4_3: number|null; // vencidos/judicial
      cta_a4_4: number|null; // provisiones (negativo)
      cta_b1: number|null;   // obligaciones con el público
      cta_b4: number|null;   // adeudos y obligaciones financieras
    };
    const balRows = await sql<BalRow[]>`
      SELECT periodo, nomb_correg,
        cta_a1, cta_a3,
        cta_a4, cta_a4_1, cta_a4_2, cta_a4_3, cta_a4_4,
        cta_b1, cta_b4
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg = ANY(${entidades})
        AND periodo = ANY(${DIC_PERIODOS})
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `;
    const balIdx = new Map<string, BalRow>();
    for (const r of balRows) balIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

    // ── 3. Estado de Resultados en Diciembres (YTD acumulado = año completo) ─
    console.log("   Consultando estado de resultados...");
    type ErRow = {
      periodo: number; nomb_correg: string;
      cta_1_4: number|null;  // ingresos por créditos (rendimiento)
      cta_2: number|null;    // gastos financieros
      cta_4: number|null;    // provisiones
      cta_6: number|null;    // ingresos por servicios financieros
      cta_7: number|null;    // gastos por servicios financieros
      cta_8: number|null;    // ganancia por venta de cartera
      cta_10: number|null;   // gastos operacionales
      cta_10_1: number|null; // personal
      cta_10_2: number|null; // directorio
      cta_10_3: number|null; // servicios de terceros
      cta_10_4: number|null; // impuestos y contribuciones
      cta_12_7: number|null; // depreciación
      cta_12_8: number|null; // amortización
      cta_13: number|null;   // otros ingresos/gastos
    };
    const erRows = await sql<ErRow[]>`
      SELECT periodo, nomb_correg,
        cta_1_4, cta_2, cta_4,
        cta_6, cta_7, cta_8,
        cta_10, cta_10_1, cta_10_2, cta_10_3, cta_10_4,
        cta_12_7, cta_12_8, cta_13
      FROM marts.mv_eeff_resultados_ancho
      WHERE nomb_correg = ANY(${entidades})
        AND periodo = ANY(${DIC_PERIODOS})
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `;
    const erIdx = new Map<string, ErRow>();
    for (const r of erRows) erIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

    // ── 4. Cartera bruta mensual (todos los meses → rolling 12M) ────────────
    console.log("   Consultando cartera mensual...");
    type MesRow = { periodo: number; nomb_correg: string; cta_a4: number|null; cta_a4_1: number|null; cta_a4_2: number|null; cta_a4_3: number|null; };
    const mesRows = await sql<MesRow[]>`
      SELECT periodo, nomb_correg, cta_a4, cta_a4_1, cta_a4_2, cta_a4_3
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg = ANY(${entidades})
        AND periodo BETWEEN ${MES_INICIO} AND ${MES_FIN}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `;
    const mesIdx = new Map<string, MesRow[]>();
    for (const r of mesRows) {
      if (!mesIdx.has(r.nomb_correg)) mesIdx.set(r.nomb_correg, []);
      mesIdx.get(r.nomb_correg)!.push(r);
    }

    // ── 5. KPIs PE almacenados (diciembres) ──────────────────────────────────
    console.log("   Consultando KPIs PE...");
    type KpiRow = { periodo: number; nomb_correg: string; kpi_codigo: string; valor: number|null; };
    const kpiRows = await sql<KpiRow[]>`
      SELECT periodo, nomb_correg, kpi_codigo, valor
      FROM marts.fact_kpis_mensuales
      WHERE nomb_correg = ANY(${entidades})
        AND kpi_codigo IN (
          'pe_rendimiento_cartera','pe_costo_fondeo','pe_costo_provisiones',
          'pe_gastos_operacionales','pe_punto_equilibrio','pe_margen_neto'
        )
        AND moneda = 'TOTAL'
        AND periodo = ANY(${DIC_PERIODOS})
      ORDER BY nomb_correg, periodo, kpi_codigo
    `;
    type KpiMap = Map<string, number|null>;
    const kpiIdx = new Map<string, KpiMap>(); // `${ent}__${periodo}` -> { kpi_codigo: valor }
    for (const r of kpiRows) {
      const key = `${r.nomb_correg}__${r.periodo}`;
      if (!kpiIdx.has(key)) kpiIdx.set(key, new Map());
      kpiIdx.get(key)!.set(r.kpi_codigo, r.valor == null ? null : Number(r.valor));
    }

    // ── Cartera prom 12M (misma ventana que V196: mismo mes año anterior → periodo) ──
    function carteraBruta12m(ent: string, periodo: number): number | null {
      const serie = mesIdx.get(ent);
      if (!serie) return null;
      const mes  = periodo % 100;
      const anio = Math.floor(periodo / 100);
      const ini  = (anio - 1) * 100 + mes;
      const v    = serie.filter(x => x.periodo >= ini && x.periodo <= periodo);
      const vals = v.map(x => (x.cta_a4_1 ?? 0) + (x.cta_a4_2 ?? 0) + (x.cta_a4_3 ?? 0)).filter(x => x > 0);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    // ── Generar todos los periodos mensuales disponibles ─────────────────────
    const todosPeriodos: number[] = [];
    for (let yr = DESDE; yr <= HASTA; yr++) {
      for (let m = 1; m <= 12; m++) {
        const p = yr * 100 + m;
        if (p >= MES_INICIO && p <= MES_FIN) todosPeriodos.push(p);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CONSTRUCCIÓN DEL EXCEL
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n📝  Construyendo Excel...");
    const wb = new ExcelJS.Workbook();
    wb.creator  = "Aibenchef";
    wb.created  = new Date();
    wb.modified = new Date();

    // ── SHEET 1: PORTADA ──────────────────────────────────────────────────────
    {
      const ws = wb.addWorksheet("Portada");
      ws.views = [{ showGridLines: false }];
      ws.columns = [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];

      let r = 1;

      // Título
      ws.mergeCells(r, 1, r, 7);
      const titleCell = ws.getRow(r).getCell(1);
      titleCell.value = `Validación Punto de Equilibrio — ${TIPO}`;
      titleCell.font  = { bold: true, size: 18, color: { argb: C.blanco } };
      titleCell.alignment = { horizontal: "left", vertical: "middle" };
      fillSolid(titleCell, C.azul);
      ws.getRow(r).height = 36; r++;

      ws.mergeCells(r, 1, r, 7);
      const sub = ws.getRow(r).getCell(1);
      sub.value = `% sobre Cartera Bruta Promedio 12 meses · SBS · Aibenchef · Generado: ${new Date().toLocaleDateString("es-PE")}`;
      sub.font  = { size: 10, color: { argb: C.blanco }, italic: true };
      fillSolid(sub, C.azul); ws.getRow(r).height = 18; r++;

      r++; // espacio

      // Header tabla
      const headers = ["Entidad", "Primer Dic", "Último Dic", "Cartera Bruta Dic " + HASTA + " (Miles S/)", "PE Dic " + HASTA + " (%)", "Rend. Dic " + HASTA + " (%)", "Status"];
      const hRow = ws.getRow(r);
      headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h; fontBold(c, 10, C.blanco); fillSolid(c, C.azul);
        c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
        border(c);
      });
      hRow.height = 20; r++;

      // Filas por entidad
      for (let ei = 0; ei < entidades.length; ei++) {
        const ent      = entidades[ei];
        const lastDic  = DIC_PERIODOS[DIC_PERIODOS.length - 1];
        const bal      = balIdx.get(`${ent}__${lastDic}`);
        const kpi      = kpiIdx.get(`${ent}__${lastDic}`);
        const pe       = kpi?.get("pe_punto_equilibrio");
        const rend     = kpi?.get("pe_rendimiento_cartera");
        const carBruta = bal ? miles((bal.cta_a4_1 ?? 0) + (bal.cta_a4_2 ?? 0) + (bal.cta_a4_3 ?? 0)) : null;

        const firstDic = DIC_PERIODOS.find(p => balIdx.has(`${ent}__${p}`));
        const lastDicOk = [...DIC_PERIODOS].reverse().find(p => balIdx.has(`${ent}__${p}`));

        const statusOk = pe != null && rend != null;
        const statusTxt = statusOk ? "✓  Con KPI" : "—  Sin KPI";
        const statusBg  = statusOk ? C.verde : C.amarillo;

        const row = ws.getRow(r);
        const bg  = ei % 2 === 0 ? C.blanco : C.grisClaro;

        const vals: (string | number | null)[] = [
          ent,
          firstDic   ? fmtDic(firstDic)   : "—",
          lastDicOk  ? fmtDic(lastDicOk)  : "—",
          carBruta,
          rend  != null ? pct2(rend)  : null,
          pe    != null ? pct2(pe)    : null,
          statusTxt,
        ];
        vals.forEach((v, i) => {
          const c = row.getCell(i + 1);
          c.value = v;
          c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
          fillSolid(c, i === 6 ? statusBg : bg);
          border(c);
          if (i === 3 && typeof v === "number") fmt(c, '#,##0');
          if ((i === 4 || i === 5) && typeof v === "number") fmt(c, '0.00"%"');
          if (i === 6) c.font = { bold: true, size: 10, color: { argb: statusOk ? C.verdeOsc : C.grisOsc } };
        });
        r++;
      }

      r++; // espacio

      // Nota metodológica
      ws.mergeCells(r, 1, r, 7);
      const nota = ws.getRow(r).getCell(1);
      nota.value = "Metodología: Cartera bruta = cta_a4_1 + cta_a4_2 + cta_a4_3 (antes de provisiones). Cartera prom 12M = promedio de los 13 meses desde mismo mes del año anterior hasta el periodo objetivo. PE = Costo Fondeo + Provisiones + Gastos Operacionales (% sobre Cartera Prom). Fuente: marts.v_eeff_balance_ancho, marts.mv_eeff_resultados_ancho, marts.fact_kpis_mensuales.";
      nota.font = { size: 9, italic: true, color: { argb: C.grisMed } };
      nota.alignment = { wrapText: true };
      ws.getRow(r).height = 36;
    }

    // ── SHEET 2: BALANCE DICIEMBRES ───────────────────────────────────────────
    {
      const ws = wb.addWorksheet("Balance Dic");
      ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];
      // col 1: grupo, col 2: cuenta, col 3..N: entidad×año
      const nCols = entidades.length * DIC_PERIODOS.length;
      ws.columns = [{ width: 24 }, { width: 36 }, ...Array(nCols).fill({ width: 14 })];

      let r = 1;

      // Título
      ws.mergeCells(r, 1, r, 2 + nCols);
      const t = ws.getRow(r).getCell(1);
      t.value = `Balance — ${TIPO} · Saldos de Diciembre (Miles S/)`;
      t.font  = { bold: true, size: 14, color: { argb: C.blanco } };
      fillSolid(t, C.azul); ws.getRow(r).height = 28; r++;

      // Header fila 1: nombre de entidad (merged sobre años)
      const h1 = ws.getRow(r);
      h1.getCell(1).value = ""; h1.getCell(2).value = "";
      fillSolid(h1.getCell(1), C.azul); fillSolid(h1.getCell(2), C.azul);
      for (let ei = 0; ei < entidades.length; ei++) {
        const col = 3 + ei * DIC_PERIODOS.length;
        ws.mergeCells(r, col, r, col + DIC_PERIODOS.length - 1);
        const c = h1.getCell(col);
        c.value = entidades[ei]; fontBold(c, 10, C.blanco);
        c.alignment = { horizontal: "center" }; fillSolid(c, C.azul);
      }
      h1.height = 20; r++;

      // Header fila 2: años (Dic YYYY)
      const h2 = ws.getRow(r);
      const hGrp = h2.getCell(1); hGrp.value = "GRUPO"; fontBold(hGrp, 9, C.blanco); fillSolid(hGrp, C.grisOsc); h2.getCell(1).alignment = { horizontal: "center" };
      const hCta = h2.getCell(2); hCta.value = "CUENTA"; fontBold(hCta, 9, C.blanco); fillSolid(hCta, C.grisOsc);
      for (let ei = 0; ei < entidades.length; ei++) {
        for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
          const col = 3 + ei * DIC_PERIODOS.length + pi;
          const c   = h2.getCell(col);
          c.value   = fmtDic(DIC_PERIODOS[pi]);
          fontBold(c, 9, C.blanco); fillSolid(c, C.grisOsc);
          c.alignment = { horizontal: "center" };
          border(c);
        }
      }
      h2.height = 18; r++;

      // Definición de filas de balance (grupo, label, getter)
      type BalDef = { grupo: string; label: string; fn: (b: BalRow) => number | null; bold?: boolean; indent?: number };
      const balDefs: BalDef[] = [
        { grupo: "ACTIVO",   label: "Cartera Bruta",                  fn: b => (b.cta_a4_1??0)+(b.cta_a4_2??0)+(b.cta_a4_3??0), bold: true },
        { grupo: "",         label: "   Vigentes",                     fn: b => b.cta_a4_1, indent: 1 },
        { grupo: "",         label: "   Refinanciados/Reestructurados", fn: b => b.cta_a4_2, indent: 1 },
        { grupo: "",         label: "   Vencidos y en Cobranza Jud.",  fn: b => b.cta_a4_3, indent: 1 },
        { grupo: "",         label: "   Provisiones (negativo)",       fn: b => b.cta_a4_4, indent: 1 },
        { grupo: "",         label: "Cartera Neta",                    fn: b => b.cta_a4,   bold: true },
        { grupo: "",         label: "Disponible",                      fn: b => b.cta_a1 },
        { grupo: "",         label: "Inversiones",                     fn: b => b.cta_a3 },
        { grupo: "PASIVO",   label: "Obligaciones con el Público",     fn: b => b.cta_b1,   bold: true },
        { grupo: "",         label: "Adeudos y Oblig. Financieras",    fn: b => b.cta_b4 },
      ];

      for (let di = 0; di < balDefs.length; di++) {
        const def  = balDefs[di];
        const isAlt = di % 2 === 0;
        const row  = ws.getRow(r);

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
          const ent = entidades[ei];
          for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
            const col  = 3 + ei * DIC_PERIODOS.length + pi;
            const c    = row.getCell(col);
            const bal  = balIdx.get(`${ent}__${DIC_PERIODOS[pi]}`);
            const v    = bal ? miles(def.fn(bal)) : null;
            c.value = v;
            c.numFmt = '#,##0';
            c.alignment = { horizontal: "right" };
            fillSolid(c, def.bold ? C.doradoClaro : (isAlt ? C.grisClaro : C.blanco));
            if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: "FFB91C1C" } };
            border(c);
          }
        }
        r++;
      }
    }

    // ── SHEET 3: ESTADO DE RESULTADOS DICIEMBRES ──────────────────────────────
    {
      const ws = wb.addWorksheet("ER Dic");
      ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];
      const nCols = entidades.length * DIC_PERIODOS.length;
      ws.columns = [{ width: 24 }, { width: 36 }, ...Array(nCols).fill({ width: 14 })];

      let r = 1;
      ws.mergeCells(r, 1, r, 2 + nCols);
      const t = ws.getRow(r).getCell(1);
      t.value = `Estado de Resultados — ${TIPO} · Diciembres YTD (Miles S/)`;
      t.font  = { bold: true, size: 14, color: { argb: C.blanco } };
      fillSolid(t, C.teal); ws.getRow(r).height = 28; r++;

      // Headers entidades
      const h1 = ws.getRow(r);
      fillSolid(h1.getCell(1), C.teal); fillSolid(h1.getCell(2), C.teal);
      for (let ei = 0; ei < entidades.length; ei++) {
        const col = 3 + ei * DIC_PERIODOS.length;
        ws.mergeCells(r, col, r, col + DIC_PERIODOS.length - 1);
        const c = h1.getCell(col);
        c.value = entidades[ei]; fontBold(c, 10, C.blanco);
        c.alignment = { horizontal: "center" }; fillSolid(c, C.teal);
      }
      h1.height = 20; r++;

      // Headers años
      const h2 = ws.getRow(r);
      h2.getCell(1).value = "GRUPO"; fontBold(h2.getCell(1), 9, C.blanco); fillSolid(h2.getCell(1), C.grisOsc); h2.getCell(1).alignment = { horizontal: "center" };
      h2.getCell(2).value = "CUENTA"; fontBold(h2.getCell(2), 9, C.blanco); fillSolid(h2.getCell(2), C.grisOsc);
      for (let ei = 0; ei < entidades.length; ei++) {
        for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
          const col = 3 + ei * DIC_PERIODOS.length + pi;
          const c   = h2.getCell(col);
          c.value   = fmtDic(DIC_PERIODOS[pi]);
          fontBold(c, 9, C.blanco); fillSolid(c, C.grisOsc);
          c.alignment = { horizontal: "center" }; border(c);
        }
      }
      h2.height = 18; r++;

      type ErDef = { grupo: string; label: string; fn: (e: ErRow) => number | null; bold?: boolean };
      const erDefs: ErDef[] = [
        { grupo: "INGRESOS",    label: "Ingresos por Créditos (1.4)",    fn: e => e.cta_1_4,  bold: true },
        { grupo: "",            label: "Ing. por Servicios Financ. (6)",  fn: e => e.cta_6 },
        { grupo: "",            label: "Otros Ingresos/Gastos (8+13)",    fn: e => (e.cta_8??0)+(e.cta_13??0) },
        { grupo: "COSTOS",      label: "Gastos Financieros (2)",          fn: e => e.cta_2,    bold: true },
        { grupo: "",            label: "Gastos por Servicios Financ. (7)",fn: e => e.cta_7 },
        { grupo: "",            label: "Provisiones (4)",                  fn: e => e.cta_4,    bold: true },
        { grupo: "GASTOS OP",   label: "Total Gastos Operacionales (10)", fn: e => e.cta_10,   bold: true },
        { grupo: "",            label: "   Personal (10.1)",              fn: e => e.cta_10_1 },
        { grupo: "",            label: "   Directorio (10.2)",            fn: e => e.cta_10_2 },
        { grupo: "",            label: "   Servicios de Terceros (10.3)", fn: e => e.cta_10_3 },
        { grupo: "",            label: "   Impuestos y Contrib. (10.4)",  fn: e => e.cta_10_4 },
        { grupo: "",            label: "   Depreciación (12.7)",          fn: e => e.cta_12_7 },
        { grupo: "",            label: "   Amortización (12.8)",          fn: e => e.cta_12_8 },
      ];

      for (let di = 0; di < erDefs.length; di++) {
        const def = erDefs[di];
        const isAlt = di % 2 === 0;
        const row = ws.getRow(r);

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
          const ent = entidades[ei];
          for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
            const col = 3 + ei * DIC_PERIODOS.length + pi;
            const c   = row.getCell(col);
            const er  = erIdx.get(`${ent}__${DIC_PERIODOS[pi]}`);
            const v   = er ? miles(def.fn(er)) : null;
            c.value = v;
            c.numFmt = '#,##0';
            c.alignment = { horizontal: "right" };
            fillSolid(c, def.bold ? C.tealClaro : (isAlt ? C.grisClaro : C.blanco));
            if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: "FFB91C1C" } };
            border(c);
          }
        }
        r++;
      }
    }

    // ── SHEET 4: CARTERA MENSUAL & VALIDACIÓN PE ─────────────────────────────
    {
      const ws = wb.addWorksheet("Cartera & PE");
      ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 3 }];
      // col 1: periodo label, col 2: mes año, luego 5 cols por entidad
      const COLS_PER_ENT = 5; // cartera bruta | prom 12M | PE rendim | PE punt.eq | PE margen
      const nCols = entidades.length * COLS_PER_ENT;
      ws.columns = [{ width: 12 }, { width: 10 }, ...Array(nCols).fill({ width: 14 })];

      let r = 1;
      ws.mergeCells(r, 1, r, 2 + nCols);
      const t = ws.getRow(r).getCell(1);
      t.value = `Cartera Bruta Mensual & Validación PE — ${TIPO} · ${DESDE}–${HASTA} (Miles S/ y %)`;
      t.font  = { bold: true, size: 14, color: { argb: C.blanco } };
      fillSolid(t, C.dorado); t.font.color = { argb: C.azul };
      ws.getRow(r).height = 28; r++;

      // Header fila 1: nombre entidad
      const h1 = ws.getRow(r);
      fillSolid(h1.getCell(1), C.azul); fillSolid(h1.getCell(2), C.azul);
      h1.getCell(1).value = "PERIODO"; fontBold(h1.getCell(1), 9, C.blanco); h1.getCell(1).alignment = { horizontal: "center" };
      h1.getCell(2).value = "MES";     fontBold(h1.getCell(2), 9, C.blanco); h1.getCell(2).alignment = { horizontal: "center" };
      for (let ei = 0; ei < entidades.length; ei++) {
        const col = 3 + ei * COLS_PER_ENT;
        ws.mergeCells(r, col, r, col + COLS_PER_ENT - 1);
        const c = h1.getCell(col);
        c.value = entidades[ei]; fontBold(c, 10, C.blanco);
        c.alignment = { horizontal: "center" }; fillSolid(c, C.azul);
      }
      h1.height = 20; r++;

      // Header fila 2: sub-columnas
      const h2 = ws.getRow(r);
      fillSolid(h2.getCell(1), C.grisOsc); fillSolid(h2.getCell(2), C.grisOsc);
      const subCols = ["Cart.Bruta\n(Miles S/)", "Prom.12M\n(Miles S/)", "Rend.\nCartera %", "Punto\nEquilib. %", "Margen\nNeto %"];
      for (let ei = 0; ei < entidades.length; ei++) {
        for (let ci = 0; ci < COLS_PER_ENT; ci++) {
          const col = 3 + ei * COLS_PER_ENT + ci;
          const c   = h2.getCell(col);
          c.value   = subCols[ci]; fontBold(c, 8, C.blanco);
          fillSolid(c, ci < 2 ? C.grisOsc : C.teal);
          c.alignment = { horizontal: "center", wrapText: true }; border(c);
        }
      }
      h2.height = 30; r++;

      // Filas mensuales
      for (const periodo of todosPeriodos) {
        const esDic = (periodo % 100) === 12;
        const row   = ws.getRow(r);
        const bg    = esDic ? C.doradoClaro : (r % 2 === 0 ? C.grisClaro : C.blanco);

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
          const ent  = entidades[ei];
          const serie = mesIdx.get(ent);
          const mes   = serie?.find(x => x.periodo === periodo);
          const cartBruta = mes ? miles((mes.cta_a4_1??0)+(mes.cta_a4_2??0)+(mes.cta_a4_3??0)) : null;
          const prom12m   = esDic ? miles(carteraBruta12m(ent, periodo)) : null;
          const kpiMap    = esDic ? kpiIdx.get(`${ent}__${periodo}`) : undefined;
          const rendim    = esDic ? pct2(kpiMap?.get("pe_rendimiento_cartera")) : null;
          const pe        = esDic ? pct2(kpiMap?.get("pe_punto_equilibrio"))    : null;
          const margen    = esDic ? pct2(kpiMap?.get("pe_margen_neto"))         : null;

          const vals = [cartBruta, prom12m, rendim, pe, margen];
          for (let ci = 0; ci < COLS_PER_ENT; ci++) {
            const col = 3 + ei * COLS_PER_ENT + ci;
            const c   = row.getCell(col);
            c.value   = vals[ci];
            c.alignment = { horizontal: "right" };
            border(c);

            if (ci < 2) {
              c.numFmt = '#,##0'; fillSolid(c, esDic ? C.doradoClaro : bg);
              if (esDic) fontBold(c, 10);
            } else {
              c.numFmt = '0.00"%"';
              const bgKpi = vals[ci] == null ? bg : (esDic ? C.tealClaro : bg);
              fillSolid(c, bgKpi);
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

    // ── Guardar ──────────────────────────────────────────────────────────────
    const outDir = path.resolve(process.cwd(), "exports");
    fs.mkdirSync(outDir, { recursive: true });
    const filename = `PE_EEFF_${TIPO}_${DESDE}_${HASTA}.xlsx`;
    const outPath  = path.join(outDir, filename);
    await wb.xlsx.writeFile(outPath);

    console.log(`\n✅  Listo: ${outPath}`);
    console.log(`   ${entidades.length} entidades | ${DIC_PERIODOS.length} diciembres | ${todosPeriodos.length} meses\n`);

  } finally {
    await sql.end();
  }
}

main().catch(err => {
  console.error("\n❌  Error fatal:", err.message ?? err);
  process.exit(1);
});
