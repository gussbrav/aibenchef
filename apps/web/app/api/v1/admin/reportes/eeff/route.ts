import "server-only";

import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";

import { db } from "@/lib/infrastructure/db";
import { requireSession } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";

// ── Paleta ────────────────────────────────────────────────────────────────────
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
  verdeMed:    "FF15803D",
  amarillo:    "FFFEF9C3",
  rojo:        "FFFEE2E2",
  rojoOsc:     "FF991B1B",
  rojoMed:     "FFB91C1C",
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

const MESES      = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const fmtDic     = (p: number) => `Dic ${Math.floor(p / 100)}`;
const fmtPeriodo = (p: number) => `${MESES[(p % 100) - 1]} ${Math.floor(p / 100)}`;
// Los valores en DB ya vienen en Miles S/ (unidad SBS).
// Solo redondeamos al entero más próximo; NO dividimos entre 1,000.
const miles      = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v);
const pct2       = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v * 10_000) / 100;

function n(v: string | null | undefined): number | null {
  if (v == null) return null;
  const x = parseFloat(String(v));
  return isNaN(x) ? null : x;
}
function nv(v: string | null | undefined): number { return n(v) ?? 0; }

function carteraBruta12m(serie: MesRow[], periodo: number): number | null {
  const mes  = periodo % 100;
  const anio = Math.floor(periodo / 100);
  let startMes = mes - 11;
  let startAnio = anio;
  if (startMes <= 0) { startMes += 12; startAnio -= 1; }
  const ini  = startAnio * 100 + startMes;
  const v    = serie.filter(x => x.periodo >= ini && x.periodo <= periodo);
  // cta_a4_3 = Atrasados (subtotal) para SF y COOPAC — semántica unificada en V203
  const vals = v.map(x => (n(x.cta_a4_1) ?? 0) + (n(x.cta_a4_2) ?? 0) + (n(x.cta_a4_3) ?? 0)).filter(x => x > 0);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
type BalRow = {
  periodo: number; nomb_correg: string;
  cta_a: string|null; cta_c: string|null;
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
  cta_10_3: string|null; cta_10_4: string|null; cta_10_5: string|null;
  cta_12_7: string|null; cta_12_8: string|null; cta_13: string|null;
};
type MesRow = {
  periodo: number; nomb_correg: string;
  cta_a4: string|null; cta_a4_1: string|null; cta_a4_2: string|null;
  cta_a4_3: string|null; cta_a4_4: string|null;
};
type KpiRow        = { periodo: number; nomb_correg: string; kpi_codigo: string; valor: string|null; };
type KpiAnualRow   = { periodo: number; nomb_correg: string; utilidad_ttm: string|null; activos_prom_12m: string|null; patrimonio_prom_12m: string|null; };
type BalDicRow     = { periodo: number; nomb_correg: string; cta_a4_1: string|null; cta_a4_2: string|null; cta_a4_3: string|null; cta_a4_4: string|null; };
type CoopacDupontRow = {
  periodo: number; nomb_correg: string;
  roa_pct: string|null; roe_pct: string|null;
  mora_pct: string|null; cobertura_car_pct: string|null;
};

async function generarExcel(opts: {
  entidades: string[];
  desde: number;
  hasta: number;
  secciones: string[];
}): Promise<Buffer> {
  const { entidades, desde, hasta, secciones } = opts;
  const DIC_PERIODOS = Array.from({ length: hasta - desde + 1 }, (_, i) => (desde + i) * 100 + 12);
  const MES_INICIO   = desde * 100 + 1;
  const MES_FIN      = hasta * 100 + 12;
  const entIn        = sql.join(entidades.map(e => sql`${e}`), sql`, `);

  const incBalance = secciones.includes("balance");
  const incEr      = secciones.includes("er");
  const incCartera = secciones.includes("cartera");

  // Consultas paralelas — balDicRows y erDicRows siempre se traen cuando
  // "cartera" está activo para garantizar que la hoja Validación PE tenga
  // todos los datos aunque el usuario no active Balance/ER.
  const [balRows, erRows, mesRows, kpiRows, kpiAnualRows, balDicRows, erDicRows, coopacDupontRows] = await Promise.all([
    incBalance ? db.execute<BalRow>(sql`
      SELECT periodo, nomb_correg,
        cta_a, cta_c, cta_a1, cta_a3,
        cta_a4, cta_a4_1, cta_a4_2, cta_a4_3, cta_a4_4,
        cta_b1, cta_b4
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([] as BalRow[]),

    incEr ? db.execute<ErRow>(sql`
      SELECT periodo, nomb_correg,
        cta_1_4, cta_2, cta_4, cta_6, cta_7, cta_8,
        cta_10, cta_10_1, cta_10_2, cta_10_3, cta_10_4, cta_10_5,
        cta_12_7, cta_12_8, cta_13
      FROM marts.mv_eeff_resultados_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([] as ErRow[]),

    incCartera ? db.execute<MesRow>(sql`
      SELECT periodo, nomb_correg, cta_a4, cta_a4_1, cta_a4_2, cta_a4_3, cta_a4_4
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo BETWEEN ${MES_INICIO} AND ${MES_FIN}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([] as MesRow[]),

    incCartera ? db.execute<KpiRow>(sql`
      SELECT periodo, nomb_correg, kpi_codigo, valor
      FROM marts.fact_kpis_mensuales
      WHERE nomb_correg IN (${entIn})
        AND kpi_codigo IN (
          'pe_rendimiento_cartera','pe_costo_fondeo','pe_costo_provisiones',
          'pe_gastos_operacionales','pe_gastos_personal','pe_gastos_generales',
          'pe_deprec_amortiz','pe_otros_ing_egr','pe_punto_equilibrio','pe_margen_neto'
        )
        AND moneda = 'TOTAL'
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
      ORDER BY nomb_correg, periodo, kpi_codigo
    `) : Promise.resolve([] as KpiRow[]),

    incCartera ? db.execute<KpiAnualRow>(sql`
      SELECT periodo, nomb_correg, utilidad_ttm, activos_prom_12m, patrimonio_prom_12m
      FROM marts.v_kpis_anuales_entidad
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([] as KpiAnualRow[]),

    incCartera ? db.execute<BalDicRow>(sql`
      SELECT periodo, nomb_correg, cta_a4_1, cta_a4_2, cta_a4_3, cta_a4_4
      FROM marts.v_eeff_balance_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([] as BalDicRow[]),

    incCartera ? db.execute<ErRow>(sql`
      SELECT periodo, nomb_correg,
        cta_1_4, cta_2, cta_4, cta_6, cta_7, cta_8,
        cta_10, cta_10_1, cta_10_2, cta_10_3, cta_10_4, cta_10_5,
        cta_12_7, cta_12_8, cta_13
      FROM marts.mv_eeff_resultados_ancho
      WHERE nomb_correg IN (${entIn})
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
        AND moneda = 'TOTAL'
      ORDER BY nomb_correg, periodo
    `) : Promise.resolve([] as ErRow[]),

    // ROA/ROE/Mora/Cobertura COOPAC: v_dupont_coopac (V193/V198) calcula desde raw.eeff_observacion.
    // Se corre siempre (no gateado por incCartera) porque la Portada y Balance Dic
    // también consumen mora/cobertura de COOPAC aunque el usuario no active "cartera".
    db.execute<CoopacDupontRow>(sql`
      SELECT periodo, nomb_correg, roa_pct, roe_pct, mora_pct, cobertura_car_pct
      FROM analytics.v_dupont_coopac
      WHERE nomb_correg IN (${entIn})
        AND moneda = 'TOTAL'
        AND periodo % 100 = 12
        AND periodo / 100 BETWEEN ${desde} AND ${hasta}
      ORDER BY nomb_correg, periodo
    `),
  ]);

  // ── Índices ───────────────────────────────────────────────────────────────
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

  const kpiAnualIdx = new Map<string, KpiAnualRow>();
  for (const r of kpiAnualRows) kpiAnualIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

  const balDicIdx = new Map<string, BalDicRow>();
  for (const r of balDicRows) balDicIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

  const erDicIdx = new Map<string, ErRow>();
  for (const r of erDicRows) erDicIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

  const coopacDupontIdx = new Map<string, CoopacDupontRow>();
  for (const r of coopacDupontRows) coopacDupontIdx.set(`${r.nomb_correg}__${r.periodo}`, r);

  // ── Helpers de calidad de cartera ─────────────────────────────────────────
  function getBalDic(ent: string, periodo: number): BalDicRow | BalRow | undefined {
    return balDicIdx.get(`${ent}__${periodo}`) ?? balIdx.get(`${ent}__${periodo}`);
  }
  function getMora(ent: string, periodo: number): number | null {
    // COOPAC: usar v_dupont_coopac que calcula Atrasados(A4.3)/bruta correctamente
    const cd = coopacDupontIdx.get(`${ent}__${periodo}`);
    if (cd && cd.mora_pct != null) {
      const v = n(cd.mora_pct);
      return v != null ? v / 100 : null;
    }
    // SF: A4.3 = Atrasados (Venc+CobranzaJud), A4.4 = Provisiones (negativo)
    const b = getBalDic(ent, periodo);
    if (!b) return null;
    const bruta = nv(b.cta_a4_1) + nv(b.cta_a4_2) + nv(b.cta_a4_3);
    return bruta > 0 ? nv(b.cta_a4_3) / bruta : null;
  }
  function getCobAtras(ent: string, periodo: number): number | null {
    // COOPAC: v_dupont_coopac calcula Prov(A4.4)/Atrasados(A4.3) correctamente
    const cd = coopacDupontIdx.get(`${ent}__${periodo}`);
    if (cd && cd.cobertura_car_pct != null) {
      const v = n(cd.cobertura_car_pct);
      return v != null ? v / 100 : null;
    }
    // SF: A4.4 = Provisiones, A4.3 = Atrasados
    const b = getBalDic(ent, periodo);
    if (!b) return null;
    const venc = nv(b.cta_a4_3);
    return venc > 0 ? Math.abs(nv(b.cta_a4_4)) / venc : null;
  }
  function getCobCar(ent: string, periodo: number): number | null {
    // COOPAC: usar misma cobertura (Prov/Atrasados) — v_dupont_coopac no tiene CAR separado
    const cd = coopacDupontIdx.get(`${ent}__${periodo}`);
    if (cd && cd.cobertura_car_pct != null) {
      const v = n(cd.cobertura_car_pct);
      return v != null ? v / 100 : null;
    }
    // SF: A4.4 = Provisiones, A4.2+A4.3 = CAR (Refi + Atrasados)
    const b = getBalDic(ent, periodo);
    if (!b) return null;
    const car = nv(b.cta_a4_2) + nv(b.cta_a4_3);
    return car > 0 ? Math.abs(nv(b.cta_a4_4)) / car : null;
  }
  function getRoa(ent: string, periodo: number): number | null {
    // SF (CMACs, financieras, bancos): v_kpis_anuales_entidad (V067) tiene utilidad_ttm
    const k = kpiAnualIdx.get(`${ent}__${periodo}`);
    if (k) {
      const util = n(k.utilidad_ttm); const act = n(k.activos_prom_12m);
      if (util != null && act != null && act !== 0) return util / act;
    }
    // COOPAC: v_dupont_coopac (V193) calcula desde raw.eeff_observacion.
    // roa_pct ya viene en % (ej: 1.36), convertir a decimal (0.0136).
    const cd = coopacDupontIdx.get(`${ent}__${periodo}`);
    const roa = cd ? n(cd.roa_pct) : null;
    return roa != null ? roa / 100 : null;
  }
  function getRoe(ent: string, periodo: number): number | null {
    const k = kpiAnualIdx.get(`${ent}__${periodo}`);
    if (k) {
      const util = n(k.utilidad_ttm); const pat = n(k.patrimonio_prom_12m);
      if (util != null && pat != null && pat !== 0) return util / pat;
    }
    const cd = coopacDupontIdx.get(`${ent}__${periodo}`);
    const roe = cd ? n(cd.roe_pct) : null;
    return roe != null ? roe / 100 : null;
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
    ws.columns = [
      { width: 32 }, { width: 11 }, { width: 11 },
      { width: 16 }, { width: 10 }, { width: 12 },
      { width: 11 }, { width: 11 }, { width: 10 }, { width: 10 },
    ];
    let r = 1;

    ws.mergeCells(r, 1, r, 10);
    const titleCell = ws.getRow(r).getCell(1);
    titleCell.value = `Reporte EEFF — ${entidades.length} entidad${entidades.length > 1 ? "es" : ""}`;
    titleCell.font  = { bold: true, size: 18, color: { argb: C.blanco } };
    titleCell.alignment = { horizontal: "left", vertical: "middle" };
    fillSolid(titleCell, C.azul); ws.getRow(r).height = 36; r++;

    ws.mergeCells(r, 1, r, 10);
    const sub = ws.getRow(r).getCell(1);
    sub.value = `Saldos en Miles S/ · SBS · Aibenchef · ${new Date().toLocaleDateString("es-PE")} · Rango: ${desde}–${hasta}`;
    sub.font  = { size: 10, color: { argb: C.blanco }, italic: true };
    fillSolid(sub, C.azul); ws.getRow(r).height = 18; r++;
    r++;

    // Cabeceras
    const hCols = [
      "Entidad",
      "Primer\nDic",
      "Último\nDic",
      `Cartera Bruta\nDic ${hasta} (Miles S/)`,
      "Mora\n%",
      "Cobertura\nAtrasados %",
      "PE\n%",
      "Margen\nNeto %",
      "ROA\n%",
      "ROE\n%",
    ];
    const hRow = ws.getRow(r);
    hRow.height = 32;
    hCols.forEach((h, i) => {
      const c = hRow.getCell(i + 1);
      c.value = h; fontBold(c, 9, C.blanco); fillSolid(c, C.azul);
      c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
      border(c);
    });
    r++;

    for (let ei = 0; ei < entidades.length; ei++) {
      const ent     = entidades[ei]!;
      const lastDic = DIC_PERIODOS[DIC_PERIODOS.length - 1]!;
      const kpiMap  = kpiIdx.get(`${ent}__${lastDic}`);
      const _peOtros    = kpiMap?.get("pe_otros_ing_egr") ?? null;
      const _peFondeo   = kpiMap?.get("pe_costo_fondeo") ?? null;
      const _peProv     = kpiMap?.get("pe_costo_provisiones") ?? null;
      const _peGastosOp = kpiMap?.get("pe_gastos_operacionales") ?? null;
      const pe = (_peOtros != null && _peFondeo != null && _peProv != null && _peGastosOp != null)
        ? Math.abs(_peOtros + _peFondeo + _peProv + _peGastosOp)
        : null;
      const margen  = kpiMap?.get("pe_margen_neto") ?? null;
      const balC    = getBalDic(ent, lastDic);
      const carBruta = balC ? miles(nv(balC.cta_a4_1)+nv(balC.cta_a4_2)+nv(balC.cta_a4_3)+Math.max(0,nv(balC.cta_a4_4))) : null;
      const firstDic = DIC_PERIODOS.find(p  => balIdx.has(`${ent}__${p}`) || balDicIdx.has(`${ent}__${p}`));
      const lastOk   = [...DIC_PERIODOS].reverse().find(p => balIdx.has(`${ent}__${p}`) || balDicIdx.has(`${ent}__${p}`));
      const mora     = getMora(ent, lastDic);
      const cob      = getCobAtras(ent, lastDic);
      const roa      = getRoa(ent, lastDic);
      const roe      = getRoe(ent, lastDic);
      const bg       = ei % 2 === 0 ? C.blanco : C.grisClaro;
      const row      = ws.getRow(r);
      row.height = 18;

      const vals: (string | number | null)[] = [
        ent,
        firstDic ? fmtDic(firstDic) : "—",
        lastOk   ? fmtDic(lastOk)   : "—",
        carBruta,
        pct2(mora),
        pct2(cob),
        pct2(pe),
        pct2(margen),
        pct2(roa),
        pct2(roe),
      ];

      vals.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
        border(c);

        switch (i) {
          case 0: fillSolid(c, bg); c.font = { size: 10, color: { argb: C.negro } }; break;
          case 1: case 2: fillSolid(c, bg); c.font = { size: 9, color: { argb: C.grisOsc } }; break;
          case 3:
            fillSolid(c, bg); c.numFmt = '#,##0';
            c.font = { bold: true, size: 10, color: { argb: C.azul } }; break;
          case 4: { // Mora — semáforo
            const mv = typeof v === "number" ? v : null;
            fillSolid(c, mv == null ? bg : mv < 5 ? C.verde : mv < 10 ? C.amarillo : C.rojo);
            c.numFmt = '0.00"%"';
            if (mv != null && mv >= 10) c.font = { bold: true, size: 10, color: { argb: C.rojoOsc } };
            break;
          }
          case 5: { // Cobertura — semáforo
            const cv = typeof v === "number" ? v : null;
            fillSolid(c, cv == null ? bg : cv >= 100 ? C.verde : cv >= 80 ? C.amarillo : C.rojo);
            c.numFmt = '0.00"%"';
            if (cv != null && cv < 80) c.font = { bold: true, size: 10, color: { argb: C.rojoOsc } };
            break;
          }
          case 6: fillSolid(c, bg); c.numFmt = '0.00"%"'; break;
          case 7: { // Margen — verde/rojo
            const mv = typeof v === "number" ? v : null;
            fillSolid(c, mv == null ? bg : mv >= 0 ? C.verde : C.rojo);
            c.numFmt = '0.00"%"';
            if (mv != null) c.font = { bold: true, size: 10, color: { argb: mv >= 0 ? C.verdeOsc : C.rojoOsc } };
            break;
          }
          default: fillSolid(c, bg); c.numFmt = '0.00"%"'; break;
        }
      });
      r++;
    }

    r++;
    ws.mergeCells(r, 1, r, 10);
    const nota = ws.getRow(r).getCell(1);
    nota.value = "Metodología · Cartera Bruta = cta_a4_1 + cta_a4_2 + cta_a4_3 (antes de provisiones) · Mora = Vencidos / Cartera Bruta · Cobertura Atrasados = |Provisiones| / Vencidos · PE = Costo Fondeo + Provisiones + Gastos Op sobre Cartera Bruta Prom.12M (12 meses exactos que terminan en Diciembre) · Margen Neto = Rendimiento − PE + Otros · ROA/ROE = Utilidad TTM / Activos o Patrimonio Prom.12M · Ver hoja «Validación PE» para el desglose completo verificable · Fuente: SBS vía Aibenchef";
    nota.font = { size: 9, italic: true, color: { argb: C.grisMed } };
    nota.alignment = { wrapText: true };
    ws.getRow(r).height = 36;
  }

  // ── BALANCE DICIEMBRES ────────────────────────────────────────────────────
  if (incBalance) {
    const ws = wb.addWorksheet("Balance Dic");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];
    const nCols = entidades.length * DIC_PERIODOS.length;
    ws.columns = [{ width: 24 }, { width: 40 }, ...Array(nCols).fill({ width: 16 }) ];
    let r = 1;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = "Balance — Saldos de Diciembre (Miles S/)";
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

    type BalDef = {
      grupo: string; label: string; bold?: boolean; pct?: boolean;
      fn: (b: BalRow | undefined, ent: string, periodo: number) => number | null;
    };
    const balDefs: BalDef[] = [
      { grupo: "ACTIVO",  label: "Total Activos",                                      bold: true,  fn: b => b ? n(b.cta_a) : null },
      { grupo: "",        label: "Cartera Bruta  [A4.1+A4.2+A4.3+max(0,A4.4)]",       bold: true,
        fn: b => b ? nv(b.cta_a4_1)+nv(b.cta_a4_2)+nv(b.cta_a4_3)+Math.max(0,nv(b.cta_a4_4)) : null },
      { grupo: "",        label: "   Vigentes (A4.1)",                                              fn: b => b ? n(b.cta_a4_1) : null },
      { grupo: "",        label: "   Refinanciados/Reestructurados (A4.2)",                         fn: b => b ? n(b.cta_a4_2) : null },
      { grupo: "",        label: "   Vencidos y Cobranza Judicial (A4.3)",                          fn: b => b ? n(b.cta_a4_3) : null },
      { grupo: "",        label: "   Prov. SF / CobranzaJud. COOPAC (A4.4)",                       fn: b => b ? n(b.cta_a4_4) : null },
      { grupo: "",        label: "Cartera Neta",                                        bold: true,  fn: b => b ? n(b.cta_a4) : null },
      { grupo: "",        label: "   Mora % = Atrasados / Cartera Bruta",               pct: true,
        fn: (_, ent, periodo) => getMora(ent, periodo) },
      { grupo: "",        label: "   Cobertura Atrasados %  =  |Prov| / Atrasados",    pct: true,
        fn: (_, ent, periodo) => getCobAtras(ent, periodo) },
      { grupo: "",        label: "   Cobertura CAR %  =  |Prov| / (Refi + Atrasados)", pct: true,
        fn: (_, ent, periodo) => getCobCar(ent, periodo) },
      { grupo: "",        label: "Disponible (A1)",                                                 fn: b => b ? n(b.cta_a1) : null },
      { grupo: "",        label: "Inversiones (A3)",                                                fn: b => b ? n(b.cta_a3) : null },
      { grupo: "PASIVO",  label: "Obligaciones con Socios / Público (B1)",             bold: true,  fn: b => b ? n(b.cta_b1) : null },
      { grupo: "",        label: "Adeudos y Oblig. Financieras (B4)",                               fn: b => b ? n(b.cta_b4) : null },
      { grupo: "PATRIM.", label: "Patrimonio",                                          bold: true,  fn: b => b ? n(b.cta_c) : null },
    ];

    for (let di = 0; di < balDefs.length; di++) {
      const def   = balDefs[di]!;
      const isAlt = di % 2 === 0;
      const bgBase = def.bold ? C.doradoClaro : def.pct ? C.azulClaro : (isAlt ? C.grisClaro : C.blanco);
      const row   = ws.getRow(r);

      const gCell = row.getCell(1);
      gCell.value = def.grupo;
      fontBold(gCell, 9, C.blanco); fillSolid(gCell, def.grupo ? C.azul : C.grisClaro);
      gCell.alignment = { horizontal: "center", vertical: "middle" };

      const lCell = row.getCell(2);
      lCell.value = def.label;
      lCell.font  = { bold: !!def.bold, size: 10, color: { argb: C.negro } };
      fillSolid(lCell, bgBase); border(lCell);

      for (let ei = 0; ei < entidades.length; ei++) {
        for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
          const col = 3 + ei * DIC_PERIODOS.length + pi;
          const c   = row.getCell(col);
          const bal = balIdx.get(`${entidades[ei]}__${DIC_PERIODOS[pi]}`);
          const raw = def.fn(bal, entidades[ei]!, DIC_PERIODOS[pi]!);
          const v   = def.pct ? pct2(raw) : miles(raw);
          c.value = v; c.numFmt = def.pct ? '0.00"%"' : '#,##0';
          c.alignment = { horizontal: "right" };
          fillSolid(c, bgBase);
          if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: C.rojoMed } };
          border(c);
        }
      }
      r++;
    }
  }

  // ── ESTADO DE RESULTADOS DICIEMBRES ───────────────────────────────────────
  if (incEr) {
    const ws = wb.addWorksheet("ER Dic");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];
    const nCols = entidades.length * DIC_PERIODOS.length;
    ws.columns = [{ width: 24 }, { width: 36 }, ...Array(nCols).fill({ width: 16 }) ];
    let r = 1;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = "Estado de Resultados — Diciembres YTD (Miles S/)";
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
      { grupo: "",          label: "Otros Ingresos/Gastos (8+13)",     fn: e => nv(e.cta_8)+nv(e.cta_13) },
      { grupo: "COSTOS",    label: "Gastos Financieros (2)",           fn: e => n(e.cta_2), bold: true },
      { grupo: "",          label: "Gastos Servicios Financieros (7)", fn: e => n(e.cta_7) },
      { grupo: "",          label: "Provisiones (4)",                  fn: e => n(e.cta_4), bold: true },
      { grupo: "GASTOS OP", label: "Total Gastos Operacionales (10)",  fn: e => n(e.cta_10), bold: true },
      { grupo: "",          label: "   Personal (10.1)",               fn: e => n(e.cta_10_1) },
      { grupo: "",          label: "   Directorio (10.2)",             fn: e => n(e.cta_10_2) },
      { grupo: "",          label: "   Servicios de Terceros (10.3)",  fn: e => n(e.cta_10_3) },
      { grupo: "",          label: "   Impuestos y Contrib. (10.4)",    fn: e => n(e.cta_10_4) },
      { grupo: "",          label: "   Act. Asociativas COOPAC (10.5)", fn: e => n(e.cta_10_5) },
      { grupo: "",          label: "   Depreciación (12.7)",            fn: e => n(e.cta_12_7) },
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
          if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: C.rojoMed } };
          border(c);
        }
      }
      r++;
    }
  }

  // ── VALIDACIÓN PE ─────────────────────────────────────────────────────────
  if (incCartera) {
    const ws = wb.addWorksheet("Validación PE");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }];
    const nCols = entidades.length * DIC_PERIODOS.length;
    ws.columns = [{ width: 22 }, { width: 44 }, ...Array(nCols).fill({ width: 16 }) ];
    let r = 1;

    // Título
    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = "Validación Punto de Equilibrio — Diciembres (Miles S/ y %)";
    t.font  = { bold: true, size: 14, color: { argb: C.azul } };
    fillSolid(t, C.dorado); ws.getRow(r).height = 28; r++;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const sub2 = ws.getRow(r).getCell(1);
    sub2.value = "Verificación: Monto TTM (Miles S/) ÷ Cartera Prom.12M (Miles S/) × 100 = Ratio %. Para Diciembre, YTD acumulado = TTM. Cartera Prom.12M = promedio simple de los 12 meses Ene–Dic del mismo año (12 meses exactos).";
    sub2.font = { size: 9, italic: true, color: { argb: C.grisOsc } };
    sub2.alignment = { wrapText: true }; ws.getRow(r).height = 24; r++;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const sub3 = ws.getRow(r).getCell(1);
    sub3.value = "Semáforos · Mora: verde <5% · amarillo <10% · rojo ≥10%  |  Cobertura: verde ≥100% · amarillo ≥80% · rojo <80%  |  Margen Neto: verde ≥0% · rojo <0%";
    sub3.font = { size: 9, italic: true, color: { argb: C.grisOsc } };
    ws.getRow(r).height = 16; r++;

    // Header entidades
    const h1 = ws.getRow(r);
    fillSolid(h1.getCell(1), C.azul); fillSolid(h1.getCell(2), C.azul);
    h1.getCell(1).value = "GRUPO"; fontBold(h1.getCell(1), 9, C.blanco); h1.getCell(1).alignment = { horizontal: "center" };
    h1.getCell(2).value = "MÉTRICA"; fontBold(h1.getCell(2), 9, C.blanco);
    for (let ei = 0; ei < entidades.length; ei++) {
      const col = 3 + ei * DIC_PERIODOS.length;
      ws.mergeCells(r, col, r, col + DIC_PERIODOS.length - 1);
      const c = h1.getCell(col);
      c.value = entidades[ei]!; fontBold(c, 9, C.blanco);
      c.alignment = { horizontal: "center" }; fillSolid(c, C.azul);
    }
    h1.height = 20; r++;

    // Header años
    const h2 = ws.getRow(r);
    fillSolid(h2.getCell(1), C.grisOsc); fillSolid(h2.getCell(2), C.grisOsc);
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

    // ── Definición de filas ───────────────────────────────────────────────
    type VCtx = { er: ErRow|undefined; kpi: Map<string,number|null>|undefined; prom12m: number|null; ent: string; periodo: number };
    type FmtV = "miles" | "pct" | "mora" | "cob" | "margen";
    type VRow =
      | { type: "sep" }
      | { type: "data"; grupo: string; label: string; fmt: FmtV; bold?: boolean;
          hl?: "pe" | "margen"; fn: (ctx: VCtx) => number | null };

    const vRows: VRow[] = [
      { type: "data", grupo: "DENOMIN.", label: "Cartera Bruta Prom.12M (S/ Miles) ← denominador de todos los ratios",
        fmt: "miles", bold: true,
        fn: ctx => { const s = mesIdx.get(ctx.ent)??[]; return carteraBruta12m(s, ctx.periodo); } },

      { type: "sep" },
      { type: "data", grupo: "RENDIM.", label: "Ingresos por Créditos TTM (S/ Miles)", fmt: "miles",
        fn: ctx => ctx.er ? n(ctx.er.cta_1_4) : null },
      { type: "data", grupo: "", label: "Rendimiento Cartera %  =  Ingresos / Cartera Prom", fmt: "pct", bold: true,
        fn: ctx => ctx.kpi?.get("pe_rendimiento_cartera") ?? null },

      { type: "sep" },
      { type: "data", grupo: "FONDEO", label: "Gastos Financieros TTM (S/ Miles)", fmt: "miles",
        fn: ctx => ctx.er ? -nv(ctx.er.cta_2) : null },
      { type: "data", grupo: "", label: "Costo de Fondeo %  =  Gastos Fin. / Cartera Prom", fmt: "pct", bold: true,
        fn: ctx => ctx.kpi?.get("pe_costo_fondeo") ?? null },

      { type: "sep" },
      { type: "data", grupo: "PROVISI.", label: "Provisiones TTM (S/ Miles)", fmt: "miles",
        fn: ctx => ctx.er ? -nv(ctx.er.cta_4) : null },
      { type: "data", grupo: "", label: "Costo Provisiones %  =  Prov. / Cartera Prom", fmt: "pct", bold: true,
        fn: ctx => ctx.kpi?.get("pe_costo_provisiones") ?? null },

      { type: "sep" },
      { type: "data", grupo: "GTOS.OP", label: "Total Gastos Operacionales TTM (S/ Miles)  [cta_10 + 12.7 + 12.8]", fmt: "miles", bold: true,
        fn: ctx => ctx.er ? -(nv(ctx.er.cta_10)+nv(ctx.er.cta_12_7)+nv(ctx.er.cta_12_8)) : null },
      { type: "data", grupo: "", label: "Gastos Operacionales %  =  Gastos Op / Cartera Prom", fmt: "pct", bold: true,
        fn: ctx => ctx.kpi?.get("pe_gastos_operacionales") ?? null },
      { type: "data", grupo: "", label: "   Personal TTM (S/ Miles)", fmt: "miles",
        fn: ctx => ctx.er ? -nv(ctx.er.cta_10_1) : null },
      { type: "data", grupo: "", label: "   Personal %", fmt: "pct",
        fn: ctx => ctx.kpi?.get("pe_gastos_personal") ?? null },
      { type: "data", grupo: "", label: "   Deprec. + Amort. TTM (S/ Miles)  [12.7 + 12.8]", fmt: "miles",
        fn: ctx => ctx.er ? -(nv(ctx.er.cta_12_7)+nv(ctx.er.cta_12_8)) : null },
      { type: "data", grupo: "", label: "   Deprec. + Amort. %", fmt: "pct",
        fn: ctx => ctx.kpi?.get("pe_deprec_amortiz") ?? null },

      { type: "sep" },
      { type: "data", grupo: "PE", label: "★  PUNTO DE EQUILIBRIO %  =  Otros + Fondeo + Provisiones + Gastos Op", fmt: "pct", bold: true, hl: "pe",
        fn: ctx => {
          const otros    = ctx.kpi?.get("pe_otros_ing_egr");
          const fondeo   = ctx.kpi?.get("pe_costo_fondeo");
          const prov     = ctx.kpi?.get("pe_costo_provisiones");
          const gastosOp = ctx.kpi?.get("pe_gastos_operacionales");
          if (otros == null || fondeo == null || prov == null || gastosOp == null) return null;
          return Math.abs(otros + fondeo + prov + gastosOp);
        } },
      { type: "sep" },

      { type: "data", grupo: "OTROS", label: "Otros Ing/Egr Netos TTM (S/ Miles)  [cta_6 − cta_7 + cta_8 + cta_13]", fmt: "miles",
        fn: ctx => ctx.er ? nv(ctx.er.cta_6)-nv(ctx.er.cta_7)+nv(ctx.er.cta_8)+nv(ctx.er.cta_13) : null },
      { type: "data", grupo: "", label: "Otros Ing/Egr Netos %", fmt: "pct",
        fn: ctx => ctx.kpi?.get("pe_otros_ing_egr") ?? null },

      { type: "sep" },
      { type: "data", grupo: "MARGEN", label: "★  MARGEN NETO %  =  Rendimiento − PE", fmt: "margen", bold: true, hl: "margen",
        fn: ctx => ctx.kpi?.get("pe_margen_neto") ?? null },
      { type: "sep" },

      { type: "data", grupo: "CALIDAD", label: "Mora %  =  Vencidos / Cartera Bruta", fmt: "mora",
        fn: ctx => getMora(ctx.ent, ctx.periodo) },
      { type: "data", grupo: "", label: "Cobertura Atrasados %  =  |Prov| / Vencidos", fmt: "cob",
        fn: ctx => getCobAtras(ctx.ent, ctx.periodo) },
      { type: "data", grupo: "", label: "Cobertura CAR %  =  |Prov| / (Venc + Refin)", fmt: "cob",
        fn: ctx => getCobCar(ctx.ent, ctx.periodo) },

      { type: "sep" },
      { type: "data", grupo: "RENTAB.", label: "ROA %  =  Utilidad TTM / Activos Prom.12M", fmt: "pct",
        fn: ctx => getRoa(ctx.ent, ctx.periodo) },
      { type: "data", grupo: "", label: "ROE %  =  Utilidad TTM / Patrimonio Prom.12M", fmt: "pct",
        fn: ctx => getRoe(ctx.ent, ctx.periodo) },
    ];

    for (const def of vRows) {
      const row = ws.getRow(r);

      if (def.type === "sep") {
        ws.mergeCells(r, 1, r, 2 + nCols);
        fillSolid(row.getCell(1), C.azulClaro);
        row.height = 5;
        r++; continue;
      }

      const isPe     = def.hl === "pe";
      const isMargen = def.hl === "margen";
      const bgLabel  = isPe ? C.dorado : isMargen ? C.teal : def.bold ? C.doradoClaro : C.blanco;
      const fgLabel  = isMargen ? C.blanco : C.negro;

      const gCell = row.getCell(1);
      gCell.value = def.grupo;
      fontBold(gCell, 9, C.blanco);
      fillSolid(gCell, def.grupo ? (isPe ? C.dorado : isMargen ? C.teal : C.azul) : C.grisClaro);
      if (def.grupo) gCell.font = { bold: true, size: 9, color: { argb: isMargen ? C.blanco : isPe ? C.azul : C.blanco } };
      gCell.alignment = { horizontal: "center", vertical: "middle" };
      border(gCell);

      const lCell = row.getCell(2);
      lCell.value = def.label;
      lCell.font  = { bold: !!def.bold, size: isPe || isMargen ? 11 : 10, color: { argb: fgLabel } };
      fillSolid(lCell, bgLabel); border(lCell);

      for (let ei = 0; ei < entidades.length; ei++) {
        for (let pi = 0; pi < DIC_PERIODOS.length; pi++) {
          const col     = 3 + ei * DIC_PERIODOS.length + pi;
          const c       = row.getCell(col);
          const ent     = entidades[ei]!;
          const periodo = DIC_PERIODOS[pi]!;
          const ctx: VCtx = {
            er:     erDicIdx.get(`${ent}__${periodo}`),
            kpi:    kpiIdx.get(`${ent}__${periodo}`),
            prom12m: null,
            ent,
            periodo,
          };
          const rawVal = def.fn(ctx);
          c.alignment  = { horizontal: "right" };
          border(c);

          if (def.fmt === "miles") {
            const v = miles(rawVal);
            c.value  = v; c.numFmt = '#,##0';
            fillSolid(c, isPe ? C.doradoClaro : isMargen ? C.tealClaro : def.bold ? C.doradoClaro : C.blanco);
            if (typeof v === "number" && v < 0) c.font = { size: 10, color: { argb: C.rojoMed } };
          } else {
            const v = pct2(rawVal);
            c.value  = v; c.numFmt = '0.00"%"';
            c.alignment = { horizontal: "center" };

            if (def.fmt === "mora") {
              const mv = typeof v === "number" ? v : null;
              fillSolid(c, mv == null ? C.blanco : mv < 5 ? C.verde : mv < 10 ? C.amarillo : C.rojo);
              if (mv != null && mv >= 10) c.font = { bold: true, size: 10, color: { argb: C.rojoOsc } };
            } else if (def.fmt === "cob") {
              const cv = typeof v === "number" ? v : null;
              fillSolid(c, cv == null ? C.blanco : cv >= 100 ? C.verde : cv >= 80 ? C.amarillo : C.rojo);
              if (cv != null && cv < 80) c.font = { bold: true, size: 10, color: { argb: C.rojoOsc } };
            } else if (def.fmt === "margen") {
              const mv = typeof v === "number" ? v : null;
              fillSolid(c, mv == null ? C.tealClaro : mv >= 0 ? C.verde : C.rojo);
              if (mv != null) c.font = { bold: true, size: 11, color: { argb: mv >= 0 ? C.verdeMed : C.rojoOsc } };
            } else if (isPe) {
              fillSolid(c, C.dorado);
              if (v != null) c.font = { bold: true, size: 11, color: { argb: C.azul } };
            } else {
              fillSolid(c, def.bold ? C.doradoClaro : C.blanco);
            }
          }
        }
      }
      r++;
    }

    r++;
    ws.mergeCells(r, 1, r, 2 + nCols);
    const nota2 = ws.getRow(r).getCell(1);
    nota2.value = "Fuente: SBS vía Aibenchef · KPIs PE: marts.fact_kpis_mensuales (V034/V078/V197/V199) · ROA/ROE SF: v_kpis_anuales_entidad (V067) · ROA/ROE+Mora+Cobertura COOPAC: analytics.v_dupont_coopac (V193/V198) · Nota: para COOPAC, A4.3=Vencidos y A4.4=CobranzaJudicial; para SF, A4.3=Atrasados y A4.4=Provisiones · Cartera Bruta = A4.1+A4.2+A4.3+max(0,A4.4)";
    nota2.font = { size: 9, italic: true, color: { argb: C.grisMed } };
    nota2.alignment = { wrapText: true }; ws.getRow(r).height = 36;
  }

  // ── CARTERA MENSUAL ───────────────────────────────────────────────────────
  if (incCartera) {
    const ws = wb.addWorksheet("Cartera Mensual");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 3 }];
    const COLS_PER_ENT = 5;
    const nCols = entidades.length * COLS_PER_ENT;
    ws.columns = [{ width: 12 }, { width: 10 }, ...Array(nCols).fill({ width: 16 }) ];
    let r = 1;

    ws.mergeCells(r, 1, r, 2 + nCols);
    const t = ws.getRow(r).getCell(1);
    t.value = `Cartera Bruta Mensual — ${desde}–${hasta} (Miles S/ y %)`;
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
          const cartBruta = mes ? miles((n(mes.cta_a4_1)??0)+(n(mes.cta_a4_2)??0)+(n(mes.cta_a4_3)??0)+Math.max(0,n(mes.cta_a4_4)??0)) : null;
          const prom12m   = esDic ? miles(carteraBruta12m(serie, periodo)) : null;
          const kpiMap    = esDic ? kpiIdx.get(`${ent}__${periodo}`) : undefined;
          const rendim    = esDic ? pct2(kpiMap?.get("pe_rendimiento_cartera") ?? null) : null;
          const pe = esDic ? (() => {
            const otros    = kpiMap?.get("pe_otros_ing_egr");
            const fondeo   = kpiMap?.get("pe_costo_fondeo");
            const prov     = kpiMap?.get("pe_costo_provisiones");
            const gastosOp = kpiMap?.get("pe_gastos_operacionales");
            if (otros == null || fondeo == null || prov == null || gastosOp == null) return null;
            return pct2(Math.abs(otros + fondeo + prov + gastosOp));
          })() : null;
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

    const buffer   = await generarExcel({ entidades: entList, desde: desdeNum, hasta: hastaNum, secciones: secList });
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
