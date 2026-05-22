export type WidgetTipo =
  | "kpi"
  | "chart_line"
  | "chart_bar"
  | "chart_pie"
  | "chart_area"
  | "chart_combo"
  | "table"
  | "markdown";

export type WidgetConfig = {
  sql?: string;
  // Charts
  xKey?: string;
  yKeys?: string[];
  seriesKey?: string;
  paleta?: string[];
  formato?: "numero" | "porcentaje" | "moneda";
  decimales?: number;
  // KPI
  label?: string;
  campo?: string;
  comparePeriodo?: boolean;
  // Markdown
  content?: string;
  // Combo chart
  combo?: Array<{ tipo: "line" | "bar"; yKey: string; color?: string }>;
};

export type TableroWidget = {
  id: string;
  tableroId: string;
  tipo: WidgetTipo;
  titulo: string | null;
  config: WidgetConfig;
  posX: number;
  posY: number;
  posW: number;
  posH: number;
  orden: number;
};

export type Tablero = {
  id: string;
  userId: string;
  nombre: string;
  descripcion: string | null;
  esPublico: boolean;
  tags: string[];
  widgets: TableroWidget[];
  createdAt: string;
  updatedAt: string;
};

export type TableroResumen = Omit<Tablero, "widgets"> & { widgetsCount: number };
