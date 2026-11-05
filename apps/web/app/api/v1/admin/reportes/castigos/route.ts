import { NextResponse } from "next/server";
import { headers } from "next/headers";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { db } from "@/lib/infrastructure/db";

const ENT_PALETTE = [
  "FF1E3A5F", "FF0F766E", "FF7C3AED", "FFB45309",
  "FF0369A1", "FF047857", "FFB91C1C", "FF6D28D9",
] as const;

const C = {
  blanco:   "FFFFFFFF",
  negro:    "FF111827",
  gris:     "FFF1F5F9",
  grisMed:  "FFE2E8F0",
  grisDark: "FF64748B",
  dorado:   "FFFFF3CD",
  doradoFg: "FF92400E",
  azul:     "FF1E3A5F",
  azulMed:  "FF334155",
};

// Orden y nombres idénticos al Reporte SBS N.° 25 (castigos y condonaciones)
const PROD_LABELS = [
  "Corporativos", "Grandes Emp.", "Medianas Emp.",
  "Pequeñas Emp.", "Microempresas", "Consumo",
  "Hipotecario", "Total",
] as const;
const PROD_KEYS = [
  "corporativo", "grandes", "medianas",
  "pequena", "micro", "consumo",
  "hipotecario", "total",
] as const;
type ProdKey = typeof PROD_KEYS[number];
const COLS_PER_ENT = PROD_KEYS.length;

type PivotRow = Record<ProdKey, number | null> & { periodo: number; entidad: string; tipo: string };

function fillSolid(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function periodoLabel(p: number): string {
  const año = Math.floor(p / 100);
  const mes = p % 100;
  const nombres = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Set","Oct","Nov","Dic"];
  return `${nombres[(mes - 1)] ?? "?"} ${año}`;
}

function nv(v: number | null): number { return v ?? 0; }

// Quita sufijos SBS de ciclo de vida: *, **, (*), (**), 1/, 3/, etc.
// No toca "Interbank (con sucursales en el exterior)" porque \( requiere solo asteriscos.
function normalizeSbs(name: string): string {
  return name.replace(/\s*(\(\*+\)|\*+|\d+\/)\s*$/, "").trim();
}

function classifyProducto(producto: string): ProdKey | null {
  const p = producto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (p.includes("total"))    return "total";
  if (p.includes("corporat")) return "corporativo";
  if (p.includes("grandes"))  return "grandes";
  if (p.includes("median"))   return "medianas";
  if (p.includes("pequ"))     return "pequena";
  if (p.includes("micro"))    return "micro";
  if (p.includes("consumo"))  return "consumo";
  if (p.includes("hipotec"))  return "hipotecario";
  // "comerci" genérico: skip — evita doble conteo si el raw tiene el agregado
  // además de los sub-tipos Corporativo/Grandes/Medianas
  return null;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const admin = await isAdmin(session.user.id).catch(() => false);
  if (!admin) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  let body: { entidades: string[]; desde: number; hasta: number };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { entidades, desde, hasta } = body;
  if (!entidades?.length) return NextResponse.json({ error: "Selecciona al menos una entidad" }, { status: 400 });
  if (!desde || !hasta || desde > hasta) return NextResponse.json({ error: "Rango de períodos inválido" }, { status: 400 });

  // ── Consulta ─────────────────────────────────────────────────────────────────
  // Consulta simple sin REGEXP_REPLACE en SQL — la normalización de sufijos SBS
  // (*, **, (*), 1/, etc.) se aplica en JS con normalizeSbs() en el loop de pivot.
  // Se filtra por periodo en SQL; el filtro por entidad se aplica en JS tras
  // normalizar, para que "B. BBVA Perú*" quede agrupado con "B. BBVA Perú".
  const rawRows = await db.execute<{
    periodo: number;
    entidad_key: string;
    tipo_entidad: string;
    producto: string;
    valor: number;
  }>(sql`
    SELECT
      periodo,
      COALESCE(entidad_final, entidad) AS entidad_key,
      tipo_entidad,
      producto,
      SUM(saldo_castigos) AS valor
    FROM raw.castigos_observacion
    WHERE periodo BETWEEN ${desde} AND ${hasta}
    GROUP BY periodo, COALESCE(entidad_final, entidad), tipo_entidad, producto
    ORDER BY periodo, entidad_key, producto
  `);

  // ── Pivot ─────────────────────────────────────────────────────────────────────
  // Normaliza en JS y filtra por entidades solicitadas.
  // "B. BBVA Perú*" normaliza a "B. BBVA Perú" → se agrupa con filas limpias.
  const entSet = new Set(entidades);
  const dataMap = new Map<string, PivotRow>();
  const tipoMap = new Map<string, string>();

  for (const r of rawRows) {
    const nombre = normalizeSbs(String(r.entidad_key));
    if (!entSet.has(nombre)) continue; // descarta entidades no solicitadas
    tipoMap.set(nombre, r.tipo_entidad);
    const key = `${r.periodo}|${nombre}`;
    if (!dataMap.has(key)) {
      dataMap.set(key, {
        periodo: r.periodo,
        entidad: nombre,
        tipo:    r.tipo_entidad,
        corporativo: null, grandes: null, medianas: null,
        pequena: null, micro: null, consumo: null,
        hipotecario: null, total: null,
      });
    }
    const row = dataMap.get(key)!;
    const cat = classifyProducto(r.producto ?? "");
    if (cat) row[cat] = (row[cat] ?? 0) + Number(r.valor);
  }

  // Si no hay fila "Total" del SBS, derivar sumando los 7 sub-productos
  for (const row of dataMap.values()) {
    if (row.total === null) {
      const sub = nv(row.corporativo) + nv(row.grandes) + nv(row.medianas) +
                  nv(row.pequena) + nv(row.micro) + nv(row.consumo) + nv(row.hipotecario);
      if (sub > 0) row.total = sub;
    }
  }

  // Períodos con data, ordenados
  const periodos = [...new Set([...dataMap.values()].map(r => r.periodo))].sort((a, b) => a - b);

  // ── Excel ─────────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Aibenchef";
  wb.created = new Date();

  // ═══════════════════════════════════════════════════════════════════════
  // Hoja 1: Portada
  // ═══════════════════════════════════════════════════════════════════════
  const portada = wb.addWorksheet("Portada");
  portada.pageSetup = { paperSize: 9, orientation: "portrait" };
  portada.views = [{ showGridLines: false }];

  portada.getColumn("A").width = 42;
  portada.getColumn("B").width = 18;
  portada.getColumn("C").width = 12;
  portada.getColumn("D").width = 12;
  portada.getColumn("E").width = 24;

  // Título
  portada.mergeCells(1, 1, 1, 5);
  const pt1 = portada.getCell(1, 1);
  pt1.value = "Reporte de Castigos — Sistema Financiero";
  pt1.font  = { bold: true, size: 16, color: { argb: C.blanco } };
  fillSolid(pt1, C.azul);
  pt1.alignment = { horizontal: "left", vertical: "middle", indent: 2 };
  portada.getRow(1).height = 36;

  portada.mergeCells(2, 1, 2, 5);
  const pt2 = portada.getCell(2, 1);
  pt2.value = `Generado: ${new Date().toLocaleDateString("es-PE", { year: "numeric", month: "long", day: "numeric" })}   ·   Período: ${desde} – ${hasta}   ·   Fuente: SBS`;
  pt2.font  = { size: 10, color: { argb: C.blanco }, italic: true };
  fillSolid(pt2, C.azulMed);
  pt2.alignment = { horizontal: "left", vertical: "middle", indent: 2 };
  portada.getRow(2).height = 22;

  portada.addRow([]);

  // Cabecera de tabla
  const hdrLabels = ["Entidad", "Tipo", "Desde", "Hasta", "Total Castigos (S/ Miles)"];
  const hdrRow = portada.addRow(hdrLabels);
  for (let c = 1; c <= 5; c++) {
    const cell = portada.getCell(hdrRow.number, c);
    cell.font  = { bold: true, size: 10, color: { argb: C.blanco } };
    fillSolid(cell, C.azul);
    cell.alignment = { horizontal: c === 5 ? "right" : "left", vertical: "middle" };
  }
  portada.getRow(hdrRow.number).height = 20;

  // Filas de resumen por entidad
  for (let ei = 0; ei < entidades.length; ei++) {
    const ent = entidades[ei]!;
    const entRows = [...dataMap.values()].filter(r => r.entidad === ent);
    const minPer  = entRows.length ? Math.min(...entRows.map(r => r.periodo)) : null;
    const maxPer  = entRows.length ? Math.max(...entRows.map(r => r.periodo)) : null;
    const totalSum = entRows.reduce((s, r) => s + nv(r.total), 0);
    const bgRow = ei % 2 === 0 ? C.gris : C.blanco;

    const sumRow = portada.addRow([ent, tipoMap.get(ent) ?? "", minPer ?? "—", maxPer ?? "—", totalSum || null]);
    for (let c = 1; c <= 5; c++) {
      const cell = portada.getCell(sumRow.number, c);
      fillSolid(cell, bgRow);
      cell.alignment = { horizontal: c === 5 ? "right" : "left", vertical: "middle" };
      cell.font = { size: 10 };
      if (c === 5 && totalSum) cell.numFmt = "#,##0.00";
    }
  }

  portada.addRow([]);
  const noteRow = portada.addRow([
    "Unidades: miles de soles. Castigos acumulados en el período indicado por entidad y línea de producto. " +
    "Fuente: raw.castigos_observacion (SBS). " +
    "Diseñado para incluir COOPAC cuando SBS los publique.",
  ]);
  portada.mergeCells(noteRow.number, 1, noteRow.number, 5);
  const noteCell = portada.getCell(noteRow.number, 1);
  noteCell.font  = { size: 9, italic: true, color: { argb: C.grisDark } };
  noteCell.alignment = { wrapText: true };
  portada.getRow(noteRow.number).height = 32;

  // ═══════════════════════════════════════════════════════════════════════
  // Hoja 2: Castigos Mensual
  // ═══════════════════════════════════════════════════════════════════════
  const ws = wb.addWorksheet("Castigos Mensual");
  ws.pageSetup = { paperSize: 9, orientation: "landscape" };
  ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4 }];

  const totalCols = 2 + entidades.length * COLS_PER_ENT;

  // Anchos de columna
  ws.getColumn(1).width = 10; // Periodo
  ws.getColumn(2).width = 12; // Mes
  for (let ei = 0; ei < entidades.length; ei++) {
    for (let pi = 0; pi < COLS_PER_ENT; pi++) {
      // Total (último, pi === 7) más ancho; sub-tipos algo más ajustados
      ws.getColumn(3 + ei * COLS_PER_ENT + pi).width = pi === COLS_PER_ENT - 1 ? 15 : 13;
    }
  }

  // ── Fila 1: Título
  ws.mergeCells(1, 1, 1, totalCols);
  const h1 = ws.getCell(1, 1);
  h1.value = "Reporte de Castigos — Sistema Financiero";
  h1.font  = { bold: true, size: 14, color: { argb: C.blanco } };
  fillSolid(h1, C.azul);
  h1.alignment = { horizontal: "left", vertical: "middle", indent: 2 };
  ws.getRow(1).height = 32;

  // ── Fila 2: Subtítulo
  ws.mergeCells(2, 1, 2, totalCols);
  const h2 = ws.getCell(2, 1);
  h2.value = `Período: ${periodoLabel(desde)} – ${periodoLabel(hasta)}   ·   Fuente: SBS   ·   Unidades: Miles S/`;
  h2.font  = { size: 10, color: { argb: C.blanco }, italic: true };
  fillSolid(h2, C.azulMed);
  h2.alignment = { horizontal: "left", vertical: "middle", indent: 2 };
  ws.getRow(2).height = 20;

  // ── Fila 3: Cabecera entidades
  fillSolid(ws.getCell(3, 1), C.grisMed);
  fillSolid(ws.getCell(3, 2), C.grisMed);
  for (let ei = 0; ei < entidades.length; ei++) {
    const startCol = 3 + ei * COLS_PER_ENT;
    ws.mergeCells(3, startCol, 3, startCol + COLS_PER_ENT - 1);
    const cell  = ws.getCell(3, startCol);
    const argb  = ENT_PALETTE[ei % ENT_PALETTE.length]!;
    cell.value  = entidades[ei]!;
    fillSolid(cell, argb);
    cell.font      = { bold: true, size: 10, color: { argb: C.blanco } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  ws.getRow(3).height = 22;

  // ── Fila 4: Cabecera productos
  const ph1 = ws.getCell(4, 1);
  ph1.value  = "Periodo";
  fillSolid(ph1, C.azul);
  ph1.font      = { bold: true, size: 10, color: { argb: C.blanco } };
  ph1.alignment = { horizontal: "center", vertical: "middle" };

  const ph2 = ws.getCell(4, 2);
  ph2.value  = "Mes";
  fillSolid(ph2, C.azul);
  ph2.font      = { bold: true, size: 10, color: { argb: C.blanco } };
  ph2.alignment = { horizontal: "left", vertical: "middle" };

  for (let ei = 0; ei < entidades.length; ei++) {
    const argb = ENT_PALETTE[ei % ENT_PALETTE.length]!;
    for (let pi = 0; pi < COLS_PER_ENT; pi++) {
      const col  = 3 + ei * COLS_PER_ENT + pi;
      const cell = ws.getCell(4, col);
      cell.value = PROD_LABELS[pi]!;
      fillSolid(cell, argb);
      cell.font      = { bold: true, size: 9, color: { argb: C.blanco } };
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
  }
  ws.getRow(4).height = 20;

  // ── Filas de datos
  const accumTotals = new Array<number>(entidades.length * COLS_PER_ENT).fill(0);

  for (let rowIdx = 0; rowIdx < periodos.length; rowIdx++) {
    const periodo = periodos[rowIdx]!;
    const isDic   = periodo % 100 === 12;
    const bgRow   = isDic ? C.dorado : (rowIdx % 2 === 0 ? C.gris : C.blanco);
    const fgRow   = isDic ? C.doradoFg : C.negro;

    const dataRow = ws.addRow([]);
    const rn      = dataRow.number;
    ws.getRow(rn).height = 16;

    const pc = ws.getCell(rn, 1);
    pc.value     = periodo;
    pc.font      = { size: 10, color: { argb: fgRow }, bold: isDic };
    pc.alignment = { horizontal: "center", vertical: "middle" };
    fillSolid(pc, bgRow);

    const mc = ws.getCell(rn, 2);
    mc.value     = periodoLabel(periodo);
    mc.font      = { size: 10, color: { argb: fgRow }, bold: isDic };
    mc.alignment = { horizontal: "left", vertical: "middle" };
    fillSolid(mc, bgRow);

    for (let ei = 0; ei < entidades.length; ei++) {
      const pivotRow = dataMap.get(`${periodo}|${entidades[ei]!}`);
      for (let pi = 0; pi < COLS_PER_ENT; pi++) {
        const col  = 3 + ei * COLS_PER_ENT + pi;
        const cell = ws.getCell(rn, col);
        const val  = pivotRow ? nv(pivotRow[PROD_KEYS[pi]!]) : 0;
        const isTotal = pi === COLS_PER_ENT - 1;
        cell.value     = val || null;
        cell.numFmt    = "#,##0.00";
        cell.font      = { size: 10, color: { argb: fgRow }, bold: isDic || isTotal };
        cell.alignment = { horizontal: "right", vertical: "middle" };
        fillSolid(cell, bgRow);
        if (val) accumTotals[ei * COLS_PER_ENT + pi]! += val;
      }
    }
  }

  // ── Fila TOTAL ACUMULADO
  const totRow = ws.addRow([]);
  ws.getRow(totRow.number).height = 20;

  const tpc = ws.getCell(totRow.number, 1);
  tpc.value     = "TOTAL";
  tpc.font      = { bold: true, size: 10, color: { argb: C.blanco } };
  tpc.alignment = { horizontal: "center", vertical: "middle" };
  fillSolid(tpc, C.azul);

  const tmc = ws.getCell(totRow.number, 2);
  tmc.value     = "ACUMULADO";
  tmc.font      = { bold: true, size: 10, color: { argb: C.blanco } };
  tmc.alignment = { horizontal: "left", vertical: "middle" };
  fillSolid(tmc, C.azul);

  for (let ei = 0; ei < entidades.length; ei++) {
    for (let pi = 0; pi < COLS_PER_ENT; pi++) {
      const col  = 3 + ei * COLS_PER_ENT + pi;
      const cell = ws.getCell(totRow.number, col);
      const val  = accumTotals[ei * COLS_PER_ENT + pi]!;
      cell.value     = val || null;
      if (val) cell.numFmt = "#,##0.00";
      cell.font      = { bold: true, size: 10, color: { argb: C.blanco } };
      cell.alignment = { horizontal: "right", vertical: "middle" };
      fillSolid(cell, C.azul);
    }
  }

  // ── Respuesta
  const buffer   = await wb.xlsx.writeBuffer();
  const fileName = `Castigos_SF_${desde}-${hasta}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
