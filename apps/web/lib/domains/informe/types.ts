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
};

export type PuntoEquilibrioRow = {
  label: string;
  valores: Record<string, number | null>;
  esTotal?: boolean;
  esSubtotal?: boolean;
  indentado?: boolean;
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

export type InformeData = {
  cliente: Cliente;
  periodo: { codigo: number; label: string };
  periodoComparativo: { codigo: number; label: string };
  competidores: Competidor[];
  cuadroResumen: Kpi[];
  puntoEquilibrio: PuntoEquilibrioRow[];
  margenNetoBubble: BubblePoint[];
  margenNetoWaterfall: WaterfallData[];
  comentarios: Record<string, string>;
};

export type EntidadDisponible = {
  nombCorreg: string;
  tipoEntidad: string;
  microfinanciera: boolean;
  ultimoPeriodo: number;
};
