// Fixture: benchmark Caja Arequipa Abr-2020 (basado en el PDF de referencia
// que el cliente comparte como deliverable estandar).
//
// Este dataset se usa para arrancar el dashboard sin esperar a que las
// migraciones V033/V034 esten corridas en la base productiva. Una vez
// que la function marts.compute_kpis_punto_equilibrio() popule la tabla,
// el page.tsx pasa a leer de ahi en lugar de este archivo.

export type Cliente = {
  slug: string;
  nombre: string;
  nombreCorto: string;
  entidadPropia: string;
  brand: { primary: string; secondary: string; acento: string };
};

export type Competidor = {
  nombCorreg: string;
  labelCorto: string;
  color: string;
  esPropio: boolean;
};

export type KpiValor = {
  competidor: string;
  valor: number | null;
  rank?: number;
};

export type Kpi = {
  codigo: string;
  nombre: string;
  unidad: "pct" | "numero" | "numero_miles" | "moneda_mm" | "moneda_miles";
  signo: 1 | -1;
  seccion: "datos_generales" | "cartera" | "eficiencia" | "rentabilidad";
  valores: KpiValor[];
};

export type PuntoEquilibrioRow = {
  label: string;
  valores: Record<string, number>;
  esTotal?: boolean;
  esSubtotal?: boolean;
  indentado?: boolean;
};

export type WaterfallData = {
  competidor: string;
  base: number;
  componentes: { label: string; bps: number }[];
  final: number;
  totalBps: number;
};

export type InformeData = {
  cliente: Cliente;
  periodo: { codigo: number; label: string };
  competidores: Competidor[];
  cuadroResumen: Kpi[];
  puntoEquilibrio: PuntoEquilibrioRow[];
  margenNetoBubble: { competidor: string; rendimiento: number; puntoEq: number; margenNeto: number; deltaPp: number }[];
  margenNetoWaterfallVsAbr19: WaterfallData[];
  comentarios: Record<string, string>;
};

const competidores: Competidor[] = [
  { nombCorreg: "Financiera Compartamos", labelCorto: "Compartamos", color: "#E91E63", esPropio: false },
  { nombCorreg: "Mibanco",                labelCorto: "Mibanco",     color: "#4CAF50", esPropio: false },
  { nombCorreg: "CMAC Arequipa",          labelCorto: "Caja Arequipa", color: "#0F2A5E", esPropio: true },
  { nombCorreg: "CMAC Huancayo",          labelCorto: "CMAC Huancayo", color: "#F44336", esPropio: false },
  { nombCorreg: "CMAC Cusco",             labelCorto: "CMAC Cusco",  color: "#8D6E63", esPropio: false },
  { nombCorreg: "CMAC Piura",             labelCorto: "CMAC Piura",  color: "#42A5F5", esPropio: false },
];

// Helper: construir KpiValor[] desde un objeto literal por entidad
function v(obj: Record<string, number | null>): KpiValor[] {
  return competidores.map((c) => ({ competidor: c.labelCorto, valor: obj[c.labelCorto] }));
}

export const CAJA_AREQUIPA_ABR_2020: InformeData = {
  cliente: {
    slug: "caja-arequipa",
    nombre: "Caja Municipal de Ahorro y Credito Arequipa",
    nombreCorto: "Caja Arequipa",
    entidadPropia: "CMAC Arequipa",
    brand: { primary: "#0F2A5E", secondary: "#FFB300", acento: "#2563EB" },
  },
  periodo: { codigo: 202004, label: "Abril 2020" },
  competidores,

  // Datos del slide 5 del PDF Caja Arequipa (todos los valores son reales)
  cuadroResumen: [
    // Datos generales
    {
      codigo: "cr_n_oficinas", nombre: "N de agencias", unidad: "numero", signo: 1, seccion: "datos_generales",
      valores: v({ Compartamos: 109, Mibanco: 330, "Caja Arequipa": 180, "CMAC Huancayo": 174, "CMAC Cusco": 105, "CMAC Piura": 191 }),
    },
    {
      codigo: "cr_n_clientes", nombre: "N de Clientes (Miles)", unidad: "numero_miles", signo: 1, seccion: "datos_generales",
      valores: v({ Compartamos: 740, Mibanco: 963, "Caja Arequipa": 409, "CMAC Huancayo": 405, "CMAC Cusco": 302, "CMAC Piura": 287 }),
    },
    {
      codigo: "cr_clientes_exclusivos", nombre: "% Clientes Exclusivos", unidad: "pct", signo: 1, seccion: "datos_generales",
      valores: v({ Compartamos: 0.522, Mibanco: 0.443, "Caja Arequipa": 0.360, "CMAC Huancayo": 0.449, "CMAC Cusco": 0.502, "CMAC Piura": 0.366 }),
    },
    {
      codigo: "cr_n_personal", nombre: "N de personal", unidad: "numero", signo: 1, seccion: "datos_generales",
      valores: v({ Compartamos: 5485, Mibanco: 11699, "Caja Arequipa": 4176, "CMAC Huancayo": 4200, "CMAC Cusco": 2733, "CMAC Piura": 3695 }),
    },
    {
      codigo: "cr_part_colocaciones", nombre: "% Part. Colocaciones en SMF", unidad: "pct", signo: 1, seccion: "datos_generales",
      valores: v({ Compartamos: 0.061, Mibanco: 0.253, "Caja Arequipa": 0.119, "CMAC Huancayo": 0.101, "CMAC Cusco": 0.072, "CMAC Piura": 0.088 }),
    },
    {
      codigo: "cr_part_depositos", nombre: "% Part. Depositos en SMF", unidad: "pct", signo: 1, seccion: "datos_generales",
      valores: v({ Compartamos: 0.049, Mibanco: 0.218, "Caja Arequipa": 0.124, "CMAC Huancayo": 0.105, "CMAC Cusco": 0.082, "CMAC Piura": 0.121 }),
    },
    // Cartera
    {
      codigo: "cr_cartera_bruta", nombre: "Cartera Bruta (MM S/)", unidad: "moneda_mm", signo: 1, seccion: "cartera",
      valores: v({ Compartamos: 2593, Mibanco: 10829, "Caja Arequipa": 5111, "CMAC Huancayo": 4324, "CMAC Cusco": 3089, "CMAC Piura": 3749 }),
    },
    {
      codigo: "cr_crec_cartera_bruta", nombre: "Crec. Cartera Bruta (%)", unidad: "pct", signo: 1, seccion: "cartera",
      valores: v({ Compartamos: 0.249, Mibanco: 0.069, "Caja Arequipa": 0.064, "CMAC Huancayo": 0.099, "CMAC Cusco": 0.091, "CMAC Piura": 0.004 }),
    },
    {
      codigo: "cr_cartera_mype", nombre: "Cartera MYPE (%)", unidad: "pct", signo: 1, seccion: "cartera",
      valores: v({ Compartamos: 0.944, Mibanco: 0.859, "Caja Arequipa": 0.666, "CMAC Huancayo": 0.615, "CMAC Cusco": 0.576, "CMAC Piura": 0.614 }),
    },
    {
      codigo: "cr_credito_prom", nombre: "Credito Prom. por Cliente (Miles S/)", unidad: "moneda_miles", signo: 1, seccion: "cartera",
      valores: v({ Compartamos: 3.5, Mibanco: 11.2, "Caja Arequipa": 12.5, "CMAC Huancayo": 10.7, "CMAC Cusco": 10.2, "CMAC Piura": 13.1 }),
    },
    {
      codigo: "cr_mora_global", nombre: "% Mora Global (sin v/c)", unidad: "pct", signo: -1, seccion: "cartera",
      valores: v({ Compartamos: 0.0718, Mibanco: 0.0936, "Caja Arequipa": 0.0951, "CMAC Huancayo": 0.0467, "CMAC Cusco": 0.0745, "CMAC Piura": 0.1241 }),
    },
    {
      codigo: "cr_cobertura_car", nombre: "Cobertura Cartera Alto Riesgo (%)", unidad: "pct", signo: 1, seccion: "cartera",
      valores: v({ Compartamos: 1.63, Mibanco: 1.68, "Caja Arequipa": 1.25, "CMAC Huancayo": 1.13, "CMAC Cusco": 1.26, "CMAC Piura": 0.98 }),
    },
    // Eficiencia
    {
      codigo: "cr_gastos_op_mg", nombre: "Gastos Oper./ Margen Bruto", unidad: "pct", signo: -1, seccion: "eficiencia",
      valores: v({ Compartamos: 0.656, Mibanco: 0.528, "Caja Arequipa": 0.554, "CMAC Huancayo": 0.627, "CMAC Cusco": 0.622, "CMAC Piura": 0.621 }),
    },
    {
      codigo: "cr_inof_neto", nombre: "% INOF Neto/ Ingreso Financiero", unidad: "pct", signo: 1, seccion: "eficiencia",
      valores: v({ Compartamos: 0.014, Mibanco: 0.032, "Caja Arequipa": 0.029, "CMAC Huancayo": 0.025, "CMAC Cusco": 0.022, "CMAC Piura": 0.049 }),
    },
    {
      codigo: "cr_cartera_x_agencia", nombre: "Cartera x Agencia (Miles S/)", unidad: "moneda_miles", signo: 1, seccion: "eficiencia",
      valores: v({ Compartamos: 23791, Mibanco: 32814, "Caja Arequipa": 33625, "CMAC Huancayo": 24849, "CMAC Cusco": 29420, "CMAC Piura": 19628 }),
    },
    {
      codigo: "cr_cartera_x_empleado", nombre: "Cartera x Empleado (Miles S/)", unidad: "moneda_miles", signo: 1, seccion: "eficiencia",
      valores: v({ Compartamos: 528, Mibanco: 1018, "Caja Arequipa": 1304, "CMAC Huancayo": 1100, "CMAC Cusco": 1272, "CMAC Piura": 1165 }),
    },
    {
      codigo: "cr_n_clientes_x_empl", nombre: "N Clientes x Empleado", unidad: "numero", signo: 1, seccion: "eficiencia",
      valores: v({ Compartamos: 151, Mibanco: 91, "Caja Arequipa": 104, "CMAC Huancayo": 103, "CMAC Cusco": 124, "CMAC Piura": 89 }),
    },
    // Rentabilidad
    {
      codigo: "cr_utilidad", nombre: "Utilidad (MM S/)", unidad: "moneda_mm", signo: 1, seccion: "rentabilidad",
      valores: v({ Compartamos: 89.1, Mibanco: 338.5, "Caja Arequipa": 123.6, "CMAC Huancayo": 96.4, "CMAC Cusco": 54.8, "CMAC Piura": 66.2 }),
    },
    {
      codigo: "cr_roe", nombre: "ROE (%)", unidad: "pct", signo: 1, seccion: "rentabilidad",
      valores: v({ Compartamos: 0.179, Mibanco: 0.172, "Caja Arequipa": 0.164, "CMAC Huancayo": 0.160, "CMAC Cusco": 0.103, "CMAC Piura": 0.121 }),
    },
    {
      codigo: "cr_roa", nombre: "ROA (%)", unidad: "pct", signo: 1, seccion: "rentabilidad",
      valores: v({ Compartamos: 0.031, Mibanco: 0.026, "Caja Arequipa": 0.020, "CMAC Huancayo": 0.020, "CMAC Cusco": 0.015, "CMAC Piura": 0.012 }),
    },
  ],

  // Datos del slide 6 del PDF: Punto de Equilibrio anualizado Abr-2020
  puntoEquilibrio: [
    {
      label: "%Rendimiento de Cartera",
      valores: { Compartamos: 0.3377, Mibanco: 0.2276, "Caja Arequipa": 0.2009, "CMAC Huancayo": 0.2028, "CMAC Cusco": 0.1747, "CMAC Piura": 0.2048 },
    },
    {
      label: "%Costo Fondeo",
      valores: { Compartamos: -0.0500, Mibanco: -0.0454, "Caja Arequipa": -0.0447, "CMAC Huancayo": -0.0507, "CMAC Cusco": -0.0492, "CMAC Piura": -0.0591 },
    },
    {
      label: "%Costo Provisiones Creditos",
      valores: { Compartamos: -0.0477, Mibanco: -0.0462, "Caja Arequipa": -0.0358, "CMAC Huancayo": -0.0296, "CMAC Cusco": -0.0257, "CMAC Piura": -0.0345 },
    },
    {
      label: "%Gastos Operacionales", esSubtotal: true,
      valores: { Compartamos: -0.1941, Mibanco: -0.1057, "Caja Arequipa": -0.0931, "CMAC Huancayo": -0.1010, "CMAC Cusco": -0.0843, "CMAC Piura": -0.1029 },
    },
    {
      label: "%Gastos de Personal", indentado: true,
      valores: { Compartamos: -0.1415, Mibanco: -0.0784, "Caja Arequipa": -0.0564, "CMAC Huancayo": -0.0692, "CMAC Cusco": -0.0575, "CMAC Piura": -0.0594 },
    },
    {
      label: "%Gastos Generales", indentado: true,
      valores: { Compartamos: -0.0438, Mibanco: -0.0234, "Caja Arequipa": -0.0305, "CMAC Huancayo": -0.0283, "CMAC Cusco": -0.0232, "CMAC Piura": -0.0385 },
    },
    {
      label: "%Deprec. y Amortiz.", indentado: true,
      valores: { Compartamos: -0.0088, Mibanco: -0.0039, "Caja Arequipa": -0.0062, "CMAC Huancayo": -0.0035, "CMAC Cusco": -0.0036, "CMAC Piura": -0.0050 },
    },
    {
      label: "%Otros Ingresos (Egresos)",
      valores: { Compartamos: 0.0079, Mibanco: 0.0160, "Caja Arequipa": 0.0096, "CMAC Huancayo": 0.0107, "CMAC Cusco": 0.0084, "CMAC Piura": 0.0175 },
    },
    {
      label: "%Punto de Equilibrio", esTotal: true,
      valores: { Compartamos: -0.2839, Mibanco: -0.1813, "Caja Arequipa": -0.1639, "CMAC Huancayo": -0.1706, "CMAC Cusco": -0.1507, "CMAC Piura": -0.1791 },
    },
    {
      label: "%Margen Neto", esTotal: true,
      valores: { Compartamos: 0.0538, Mibanco: 0.0464, "Caja Arequipa": 0.0369, "CMAC Huancayo": 0.0322, "CMAC Cusco": 0.0240, "CMAC Piura": 0.0257 },
    },
  ],

  // Slide 7 — bubble chart Abr.20 vs Abr.19
  margenNetoBubble: [
    { competidor: "Compartamos",   rendimiento: -2.1, puntoEq:  1.5, margenNeto: 0.0538, deltaPp: -0.89 },
    { competidor: "Mibanco",       rendimiento: -1.5, puntoEq:  0.0, margenNeto: 0.0464, deltaPp: -1.32 },
    { competidor: "Caja Arequipa", rendimiento: -1.2, puntoEq:  0.0, margenNeto: 0.0369, deltaPp: -0.45 },
    { competidor: "CMAC Huancayo", rendimiento: -0.4, puntoEq: -0.3, margenNeto: 0.0322, deltaPp: -0.70 },
    { competidor: "CMAC Cusco",    rendimiento: -1.6, puntoEq:  0.1, margenNeto: 0.0240, deltaPp: -1.58 },
    { competidor: "CMAC Piura",    rendimiento: -0.7, puntoEq:  0.7, margenNeto: 0.0257, deltaPp:  0.22 },
  ],

  // Slide 8 — waterfall por entidad: Abr.20 vs Abr.19 en bps
  margenNetoWaterfallVsAbr19: [
    {
      competidor: "Compartamos", base: 6.27, final: 5.38, totalBps: -89,
      componentes: [
        { label: "RC", bps: -246 },
        { label: "CF", bps: 39 },
        { label: "CP", bps: 38 },
        { label: "GO", bps: 52 },
        { label: "Ot", bps: 27 },
      ],
    },
    {
      competidor: "Mibanco", base: 5.96, final: 4.64, totalBps: -132,
      componentes: [
        { label: "RC", bps: -147 },
        { label: "CF", bps: -4 },
        { label: "CP", bps: 2 },
        { label: "GO", bps: -24 },
        { label: "Ot", bps: 41 },
      ],
    },
    {
      competidor: "Caja Arequipa", base: 4.14, final: 3.69, totalBps: -45,
      componentes: [
        { label: "RC", bps: -120 },
        { label: "CF", bps: -7 },
        { label: "CP", bps: 50 },
        { label: "GO", bps: 41 },
        { label: "Ot", bps: -9 },
      ],
    },
    {
      competidor: "CMAC Huancayo", base: 3.92, final: 3.22, totalBps: -70,
      componentes: [
        { label: "RC", bps: -37 },
        { label: "CF", bps: -3 },
        { label: "CP", bps: -72 },
        { label: "GO", bps: -5 },
        { label: "Ot", bps: 48 },
      ],
    },
    {
      competidor: "CMAC Cusco", base: 3.98, final: 2.40, totalBps: -158,
      componentes: [
        { label: "RC", bps: -157 },
        { label: "CF", bps: -44 },
        { label: "CP", bps: -9 },
        { label: "GO", bps: 63 },
        { label: "Ot", bps: -10 },
      ],
    },
    {
      competidor: "CMAC Piura", base: 2.35, final: 2.57, totalBps: 22,
      componentes: [
        { label: "RC", bps: -55 },
        { label: "CF", bps: -24 },
        { label: "CP", bps: 8 },
        { label: "GO", bps: 77 },
        { label: "Ot", bps: 16 },
      ],
    },
  ],

  // Comentarios ejecutivos (cajas azules del PDF)
  comentarios: {
    margen_neto_bubble:
      "Caja Arequipa presenta una de las menores caidas en su margen, sostenido por mayores eficiencias, en contrapartida de lo mostrado por Caja Huancayo, cuyo nivel de eficiencia esta golpeando el margen negativamente, asi como su rendimiento de cartera.",
    margen_neto_waterfall:
      "Se aprecia un deterioro importante en el Rendimiento de Cartera en los lideres del segmento, lo que repercute directamente en la caida del margen.",
  },
};
