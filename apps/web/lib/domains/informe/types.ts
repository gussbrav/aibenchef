// Types compartidos del dominio "informe ejecutivo".
//
// Estos types son la API publica entre el backend (queries.ts +
// route handlers) y el frontend (informe-client.tsx + selectores).

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
};

export type KpiUnidad = "pct" | "numero" | "numero_miles" | "moneda_mm" | "moneda_miles";

export type KpiSeccion = "datos_generales" | "cartera" | "eficiencia" | "rentabilidad";

export type Kpi = {
  codigo: string;
  nombre: string;
  unidad: KpiUnidad;
  signo: 1 | -1;
  seccion: KpiSeccion;
  valores: KpiValor[];
  /** Tooltip opcional explicando la metodologia del KPI
   *  (ej. "Utilidad anualizada trailing 12 meses (TTM)"). */
  tooltip?: string;
  /**
   * Si false, el KPI NO se ranking-eea entre entidades (no aplica heatmap
   * de cuartil). Para metricas de tamaño / market share donde mas alto no
   * implica "mejor" (ej. # agencias, # personal, % Part. SF) — son contexto,
   * no calidad. Default: true (metricas de calidad como ROA, mora, eficiencia).
   */
  rankeable?: boolean;
};

export type PuntoEquilibrioRow = {
  label: string;
  valores: Record<string, number | null>;
  esTotal?: boolean;
  esSubtotal?: boolean;
  indentado?: boolean;
  /** Tooltip opcional explicando el indicador (ej. "anualizada trailing 12 meses"). */
  tooltip?: string;
};

/** Comparativa historica de %Margen Neto (Punto Equilibrio Anualizado).
 *  Replica el formato Excel: 3 filas con el mismo indicador en 3 cortes. */
export type MargenNetoHistoricoRow = {
  /** Label corto del periodo (ej. "Abr-20", "Dic-19", "Abr-19"). */
  periodoLabel: string;
  /** Codigo YYYYMM. */
  periodo: number;
  valores: Record<string, number | null>;
};

export type BubblePoint = {
  competidor: string;
  rendimiento: number; // delta en pp
  puntoEq: number; // delta en pp
  margenNeto: number; // valor absoluto del periodo actual
  deltaPp: number; // delta vs comparativo
};

export type WaterfallData = {
  competidor: string;
  base: number; // margen neto en periodo comparativo (%)
  componentes: { label: string; bps: number }[];
  final: number; // margen neto periodo actual (%)
  totalBps: number;
};

export type TemaPreset = {
  id: string;
  nombre: string;
  primary: string;
  secondary: string;
  acento: string;
};

export const TEMAS_PRESET: TemaPreset[] = [
  { id: "arequipa",   nombre: "Caja Arequipa (azul/dorado)", primary: "#0F2A5E", secondary: "#FFB300", acento: "#2563EB" },
  { id: "huancayo",   nombre: "Caja Huancayo (rojo)",        primary: "#C8102E", secondary: "#F4C300", acento: "#1E1E1E" },
  { id: "cusco",      nombre: "Caja Cusco (vino)",           primary: "#722F37", secondary: "#FFD700", acento: "#8B4513" },
  { id: "piura",      nombre: "Caja Piura (celeste)",        primary: "#1E90FF", secondary: "#FFFFFF", acento: "#003366" },
  { id: "compartamos",nombre: "Compartamos (fucsia)",        primary: "#E91E63", secondary: "#FF9800", acento: "#FFFFFF" },
  { id: "mibanco",    nombre: "Mibanco (verde)",             primary: "#2E7D32", secondary: "#A5D6A7", acento: "#FFD600" },
  { id: "azoramind",  nombre: "Aibenchef default (violeta)", primary: "#1E3A8A", secondary: "#7C3AED", acento: "#06B6D4" },
];

export type CoberturaDatos = {
  entidadesConData: string[];     // matchearon en mv_eeff_balance_ancho
  entidadesSinData: string[];     // del peer group pero sin filas en MVs
  sugerenciasMatch: Record<string, string[]>; // nomb_correg solicitado -> candidatos similares
};

export type HistoricoPuntoSerie = {
  periodo: number;
  periodoLabel: string;
  valor: number | null;
  /** Crecimiento absoluto vs periodo previo en la serie (null si no aplica). */
  crecimiento: number | null;
};

export type HistoricoEntidadSerie = {
  entidad: string;        // labelCorto
  color: string;          // del competidor para tinte consistente
  valorActual: number | null;
  /** Valor en el primer periodo de la serie — para comparar "Dic.X vs hoy". */
  valorBase: number | null;
  /** Variacion absoluta entre primer y ultimo periodo de la serie. */
  variacionTotal: number | null;
  /** Serie temporal completa. */
  serie: HistoricoPuntoSerie[];
};

export type InformeData = {
  cliente: Cliente;
  periodo: { codigo: number; label: string };
  periodoComparativo: { codigo: number; label: string };
  /** Periodo de cierre del año previo (ej: Dic año anterior si actual = Mar 2026 -> Dic 2025). */
  periodoDicPrev: { codigo: number; label: string };
  competidores: Competidor[];
  cuadroResumen: Kpi[];
  puntoEquilibrio: PuntoEquilibrioRow[];
  /** Comparativa anualizada %Margen Neto en 3 cortes (actual / Dic año previo / mismo mes año previo). */
  margenNetoHistorico: MargenNetoHistoricoRow[];
  margenNetoBubble: BubblePoint[];
  /** Cascada %Margen Neto: actual vs mismo mes año previo. */
  margenNetoWaterfall: WaterfallData[];
  /** Cascada %Margen Neto: actual vs cierre Dic año previo. */
  margenNetoWaterfallVsDic: WaterfallData[];
  /** Serie historica de # Oficinas por entidad (ultimos 5 periodos). */
  oficinasHistorico: HistoricoEntidadSerie[];
  /** Serie historica de # Personal por entidad (ultimos 5 periodos). */
  personalHistorico: HistoricoEntidadSerie[];
  /** Serie historica de # Clientes de Credito (en miles) por entidad. */
  clientesHistorico: HistoricoEntidadSerie[];
  /** Serie historica %Rendimiento Cartera (anualizado TTM). */
  rendimientoCarteraHistorico: HistoricoEntidadSerie[];
  /** Serie historica %Costo Fondeo (anualizado TTM). */
  costoFondeoHistorico: HistoricoEntidadSerie[];
  /** Serie historica %Costo Provisiones / Cartera Prom (anualizado). */
  costoProvisionesHistorico: HistoricoEntidadSerie[];
  /** Serie historica Eficiencia: %Gastos Op / Margen Bruto. */
  eficienciaHistorico: HistoricoEntidadSerie[];
  /** Serie historica Gastos Personal / Margen Bruto. */
  gastosPersonalHistorico: HistoricoEntidadSerie[];
  /** Serie historica Gastos Generales / Margen Bruto. */
  gastosGeneralesHistorico: HistoricoEntidadSerie[];
  /** Serie historica Utilidad Neta TTM (en MM S/). */
  utilidadNetaHistorico: HistoricoEntidadSerie[];
  /** Serie historica ROE = utilidad TTM / patrimonio prom 12m. */
  roeHistorico: HistoricoEntidadSerie[];
  /** Serie historica ROA = utilidad TTM / activos prom 12m. */
  roaHistorico: HistoricoEntidadSerie[];
  /** Serie historica Ingresos Financieros TTM (cta_1) en MM S/. */
  ingresosFinancierosHistorico: HistoricoEntidadSerie[];
  /** Serie historica Gastos Financieros TTM (cta_2) en MM S/. */
  gastosFinancierosHistorico: HistoricoEntidadSerie[];
  /** Serie historica Margen Financiero Bruto = (cta_1 - cta_2) TTM en MM S/. */
  margenFinancieroBrutoHistorico: HistoricoEntidadSerie[];
  /** Serie historica Margen Financiero Neto = Margen Bruto + INOF Neto TTM en MM S/. */
  margenFinancieroNetoHistorico: HistoricoEntidadSerie[];
  comentarios: Record<string, string>;
  cobertura: CoberturaDatos;
};

export type EntidadDisponible = {
  nombCorreg: string;
  tipoEntidad: string;
  microfinanciera: boolean;
  ultimoPeriodo: number;
};
