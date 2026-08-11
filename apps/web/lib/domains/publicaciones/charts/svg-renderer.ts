/**
 * Chart engine SVG server-side — sin dependencias externas.
 *
 * Filosofia NYT/Datawrapper: SVG limpio, escrito a mano, con control
 * total del estilo. Cero librerias (Recharts/Highcharts) para:
 *   - Zero runtime cost en el server (JSON.stringify a mano)
 *   - Zero bundle bloat en el client (los SVGs se sirven inline en el HTML)
 *   - Consistencia visual (todos los charts respetan la misma paleta/grilla)
 *
 * Los charts se pensaron para embed en articulos de LinkedIn/blog. Por eso:
 *   - Colores accesibles (contraste AAA sobre fondo blanco)
 *   - Tipografia system-ui default (no depende de fonts externos)
 *   - Aspect ratio 16:9 (mejor render en preview de LinkedIn)
 *   - Labels grandes (readable a 400px de ancho)
 *   - Ultima observacion siempre anotada (fatal para storytelling)
 *
 * Escala Y automatica con "nice numbers" (ticks en multiplos de 1/2/5).
 * Escala X mensual/anual segun granularidad de los puntos.
 */

// =============================================================================
// Types
// =============================================================================

export type ChartPoint = {
  /** YYYYMM. Ej: 202606 = Jun 2026 */
  periodo: number;
  /** Valor de la serie. NULL = corte visible en la linea (no dibuja) */
  valor: number | null;
};

export type ChartSerie = {
  /** Nombre visible en la leyenda. */
  nombre: string;
  /** Color hex. Se recomienda 6-8 series max para legibilidad. */
  color: string;
  /** Si true, se dibuja mas gruesa + label al final (entidad propia). */
  destacada?: boolean;
  puntos: ChartPoint[];
};

export type LineChartInput = {
  titulo: string;
  subtitulo?: string;
  /** Ej: "% Cartera Atrasada". Va en label del eje Y. */
  ejeY: string;
  /** Fuente: "SBS Peru · Corte Jun-26". Va en el footer del chart. */
  fuente: string;
  series: ChartSerie[];
  /** Formato del valor: 'pct' -> '12.3%', 'money_millones' -> 'S/ 1.2M' */
  formato?: "pct" | "decimal" | "money_millones";
  /** Ancho en pixels del SVG. Default 800. */
  width?: number;
  /** Alto en pixels del SVG. Default 450 (16:9). */
  height?: number;
};

export type BarChartInput = {
  titulo: string;
  subtitulo?: string;
  ejeY: string;
  fuente: string;
  /** Barras: cada elemento es una barra. Se dibujan en orden. */
  barras: Array<{ nombre: string; valor: number; color: string; destacada?: boolean }>;
  formato?: "pct" | "decimal" | "money_millones";
  width?: number;
  height?: number;
};

// =============================================================================
// Helpers
// =============================================================================

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function periodoLabel(codigo: number, includeYear = true): string {
  const anio = Math.floor(codigo / 100);
  const mes = codigo % 100;
  const mesLabel = MESES_ES[mes - 1] ?? "?";
  return includeYear ? `${mesLabel}-${String(anio).slice(-2)}` : mesLabel;
}

/** Escapa string para usarse dentro de un atributo o texto SVG. */
function escapeSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formato de numero segun tipo. */
function fmt(v: number, formato: "pct" | "decimal" | "money_millones" = "decimal"): string {
  if (!isFinite(v)) return "—";
  if (formato === "pct") return `${v.toFixed(2)}%`;
  if (formato === "money_millones") {
    if (Math.abs(v) >= 1000) return `S/ ${(v / 1000).toFixed(1)} MM`;
    return `S/ ${v.toFixed(1)} M`;
  }
  return v.toFixed(2);
}

/**
 * "Nice numbers" para eje Y — devuelve [min, max, step] redondeados.
 * Ejemplo: input 3.2..8.7 -> output [3, 9, 1] (ticks: 3, 4, 5, ..., 9)
 */
function niceScale(rawMin: number, rawMax: number, targetTicks = 5): {
  min: number;
  max: number;
  step: number;
} {
  const range = rawMax - rawMin;
  if (range === 0) {
    // Todos iguales — dejamos un padding artificial
    return { min: rawMin - 1, max: rawMax + 1, step: 0.5 };
  }
  const roughStep = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  let niceNormalized: number;
  if (normalized < 1.5) niceNormalized = 1;
  else if (normalized < 3) niceNormalized = 2;
  else if (normalized < 7) niceNormalized = 5;
  else niceNormalized = 10;
  const step = niceNormalized * magnitude;
  const min = Math.floor(rawMin / step) * step;
  const max = Math.ceil(rawMax / step) * step;
  return { min, max, step };
}

// =============================================================================
// LINE CHART
// =============================================================================

/**
 * Renderiza un line chart multi-serie a SVG string (server-side).
 *
 * Layout:
 *   - Padding top: 60 (titulo + subtitulo)
 *   - Padding right: 100 (label de series al final de linea)
 *   - Padding bottom: 60 (labels eje X + fuente)
 *   - Padding left: 60 (labels eje Y)
 */
export function renderLineChartSvg(input: LineChartInput): string {
  const width = input.width ?? 800;
  const height = input.height ?? 450;
  const formato = input.formato ?? "decimal";

  const padTop = 70;
  const padRight = 140;
  const padBottom = 70;
  const padLeft = 70;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Recolectar todos los periodos + valores para calcular escalas
  const periodosSet = new Set<number>();
  const valoresValidos: number[] = [];
  for (const s of input.series) {
    for (const p of s.puntos) {
      periodosSet.add(p.periodo);
      if (p.valor != null && isFinite(p.valor)) valoresValidos.push(p.valor);
    }
  }
  const periodos = Array.from(periodosSet).sort((a, b) => a - b);

  if (periodos.length === 0 || valoresValidos.length === 0) {
    return renderEmptyChart(width, height, "Sin data para renderizar");
  }

  const yScale = niceScale(Math.min(...valoresValidos), Math.max(...valoresValidos));
  const xToPx = (p: number): number => {
    const idx = periodos.indexOf(p);
    if (periodos.length === 1) return padLeft + chartW / 2;
    return padLeft + (idx / (periodos.length - 1)) * chartW;
  };
  const yToPx = (v: number): number => {
    const t = (v - yScale.min) / (yScale.max - yScale.min);
    return padTop + chartH - t * chartH;
  };

  // Ticks del eje Y
  const yTicks: number[] = [];
  for (let v = yScale.min; v <= yScale.max + 1e-9; v += yScale.step) {
    yTicks.push(Math.round(v * 1e6) / 1e6);
  }

  // Ticks del eje X — cada N periodos segun cantidad (max 8 labels visibles)
  const xTickStep = Math.max(1, Math.ceil(periodos.length / 8));

  // Path SVG por serie (line + puntos)
  const seriePaths = input.series.map((s) => {
    const puntosValidos = s.puntos.filter((p) => p.valor != null && isFinite(p.valor));
    if (puntosValidos.length === 0) return null;
    const d = puntosValidos
      .map((p, i) => {
        const cmd = i === 0 ? "M" : "L";
        return `${cmd}${xToPx(p.periodo).toFixed(1)},${yToPx(p.valor as number).toFixed(1)}`;
      })
      .join(" ");
    const strokeWidth = s.destacada ? 3 : 1.75;
    const opacity = s.destacada ? 1 : 0.75;
    const ultimo = puntosValidos[puntosValidos.length - 1];
    return { serie: s, d, strokeWidth, opacity, ultimo };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // Labels finales de series (a la derecha de la ultima observacion)
  // Para evitar overlap, sortear por Y y separar minimo 14px
  const labelsData = seriePaths
    .map((sp) => ({
      nombre: sp.serie.nombre,
      color: sp.serie.color,
      destacada: sp.serie.destacada ?? false,
      valor: sp.ultimo?.valor as number,
      x: sp.ultimo ? xToPx(sp.ultimo.periodo) : 0,
      y: sp.ultimo ? yToPx(sp.ultimo.valor as number) : 0,
    }))
    .sort((a, b) => a.y - b.y);
  // Ajuste anti-overlap
  const MIN_GAP = 15;
  for (let i = 1; i < labelsData.length; i++) {
    const prev = labelsData[i - 1]!;
    const curr = labelsData[i]!;
    if (curr.y - prev.y < MIN_GAP) curr.y = prev.y + MIN_GAP;
  }

  // Construccion del SVG
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeSvg(input.titulo)}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff;">`);

  // Fondo
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  // Titulo
  parts.push(`<text x="${padLeft}" y="26" font-size="16" font-weight="700" fill="#0f172a">${escapeSvg(input.titulo)}</text>`);
  if (input.subtitulo) {
    parts.push(`<text x="${padLeft}" y="46" font-size="12" fill="#64748b">${escapeSvg(input.subtitulo)}</text>`);
  }

  // Grid horizontal + labels Y
  for (const t of yTicks) {
    const y = yToPx(t);
    parts.push(`<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + chartW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`);
    parts.push(`<text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" font-size="10" fill="#64748b" text-anchor="end">${escapeSvg(fmt(t, formato))}</text>`);
  }

  // Eje Y label (rotado)
  parts.push(`<text x="${padLeft - 50}" y="${padTop + chartH / 2}" font-size="10" fill="#475569" text-anchor="middle" transform="rotate(-90 ${padLeft - 50} ${padTop + chartH / 2})">${escapeSvg(input.ejeY)}</text>`);

  // Labels eje X
  for (let i = 0; i < periodos.length; i++) {
    if (i % xTickStep !== 0 && i !== periodos.length - 1) continue;
    const x = xToPx(periodos[i]!);
    parts.push(`<text x="${x.toFixed(1)}" y="${(padTop + chartH + 18).toFixed(1)}" font-size="10" fill="#64748b" text-anchor="middle">${escapeSvg(periodoLabel(periodos[i]!))}</text>`);
  }

  // Lineas de las series (destacadas al final para que queden encima)
  const ordenSeries = [...seriePaths].sort((a, b) => (a.serie.destacada ? 1 : 0) - (b.serie.destacada ? 1 : 0));
  for (const sp of ordenSeries) {
    parts.push(`<path d="${sp.d}" fill="none" stroke="${sp.serie.color}" stroke-width="${sp.strokeWidth}" stroke-opacity="${sp.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`);
    // Punto final anotado con circle
    if (sp.ultimo) {
      const px = xToPx(sp.ultimo.periodo);
      const py = yToPx(sp.ultimo.valor as number);
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${sp.serie.destacada ? 4 : 3}" fill="${sp.serie.color}" stroke="#ffffff" stroke-width="1.5"/>`);
    }
  }

  // Labels de series a la derecha (con leader line al punto final)
  for (const ld of labelsData) {
    // Leader line si el label esta desplazado del punto real
    if (Math.abs(ld.y - yToPx(ld.valor)) > 3) {
      parts.push(`<line x1="${(ld.x + 6).toFixed(1)}" y1="${yToPx(ld.valor).toFixed(1)}" x2="${(padLeft + chartW + 6).toFixed(1)}" y2="${ld.y.toFixed(1)}" stroke="${ld.color}" stroke-width="0.75" stroke-opacity="0.5"/>`);
    }
    const labelText = `${ld.nombre} · ${fmt(ld.valor, formato)}`;
    parts.push(`<text x="${(padLeft + chartW + 10).toFixed(1)}" y="${(ld.y + 3).toFixed(1)}" font-size="${ld.destacada ? 11 : 10}" font-weight="${ld.destacada ? 700 : 400}" fill="${ld.color}">${escapeSvg(labelText)}</text>`);
  }

  // Fuente al pie
  parts.push(`<text x="${padLeft}" y="${height - 12}" font-size="9" fill="#94a3b8" font-style="italic">Fuente: ${escapeSvg(input.fuente)}</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

// =============================================================================
// BAR CHART (horizontal — ranking)
// =============================================================================

export function renderBarChartSvg(input: BarChartInput): string {
  const width = input.width ?? 800;
  const height = input.height ?? Math.max(220, 60 + input.barras.length * 42);
  const formato = input.formato ?? "decimal";

  const padTop = 70;
  const padRight = 100;
  const padBottom = 40;
  const padLeft = 200; // espacio grande para nombres de entidades
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const barrasOrdenadas = [...input.barras].sort((a, b) => b.valor - a.valor);
  const valores = barrasOrdenadas.map((b) => b.valor);
  const rawMin = Math.min(0, ...valores);
  const rawMax = Math.max(0, ...valores);
  const yScale = niceScale(rawMin, rawMax);

  const xToPx = (v: number): number => {
    const t = (v - yScale.min) / (yScale.max - yScale.min);
    return padLeft + t * chartW;
  };
  const zeroX = xToPx(0);

  const barH = Math.min(28, (chartH / barrasOrdenadas.length) * 0.7);
  const gap = (chartH - barH * barrasOrdenadas.length) / (barrasOrdenadas.length + 1);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeSvg(input.titulo)}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff;">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  parts.push(`<text x="${padLeft}" y="26" font-size="16" font-weight="700" fill="#0f172a">${escapeSvg(input.titulo)}</text>`);
  if (input.subtitulo) {
    parts.push(`<text x="${padLeft}" y="46" font-size="12" fill="#64748b">${escapeSvg(input.subtitulo)}</text>`);
  }

  // Grid vertical + labels X
  const xTicks: number[] = [];
  for (let v = yScale.min; v <= yScale.max + 1e-9; v += yScale.step) {
    xTicks.push(Math.round(v * 1e6) / 1e6);
  }
  for (const t of xTicks) {
    const x = xToPx(t);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${(padTop + chartH).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${(padTop + chartH + 16).toFixed(1)}" font-size="10" fill="#64748b" text-anchor="middle">${escapeSvg(fmt(t, formato))}</text>`);
  }

  // Linea del cero mas destacada
  parts.push(`<line x1="${zeroX.toFixed(1)}" y1="${padTop}" x2="${zeroX.toFixed(1)}" y2="${(padTop + chartH).toFixed(1)}" stroke="#94a3b8" stroke-width="1"/>`);

  // Barras
  barrasOrdenadas.forEach((b, i) => {
    const y = padTop + gap * (i + 1) + barH * i;
    const barX = Math.min(zeroX, xToPx(b.valor));
    const barW = Math.abs(xToPx(b.valor) - zeroX);
    const opacity = b.destacada ? 1 : 0.85;
    parts.push(`<rect x="${barX.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${b.color}" fill-opacity="${opacity}" rx="2"/>`);
    // Label de la entidad a la izquierda
    parts.push(`<text x="${(padLeft - 10).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="${b.destacada ? 12 : 11}" font-weight="${b.destacada ? 700 : 400}" fill="${b.destacada ? "#0f172a" : "#334155"}" text-anchor="end">${escapeSvg(b.nombre)}</text>`);
    // Valor al final de la barra
    const labelX = b.valor >= 0 ? xToPx(b.valor) + 6 : xToPx(b.valor) - 6;
    const anchor = b.valor >= 0 ? "start" : "end";
    parts.push(`<text x="${labelX.toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="11" font-weight="${b.destacada ? 700 : 400}" fill="${b.color}" text-anchor="${anchor}">${escapeSvg(fmt(b.valor, formato))}</text>`);
  });

  // Fuente
  parts.push(`<text x="${padLeft}" y="${height - 12}" font-size="9" fill="#94a3b8" font-style="italic">Fuente: ${escapeSvg(input.fuente)}</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function renderEmptyChart(width: number, height: number, mensaje: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="font-family: system-ui, sans-serif;">
    <rect width="${width}" height="${height}" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="${width / 2}" y="${height / 2}" font-size="14" fill="#94a3b8" text-anchor="middle">${escapeSvg(mensaje)}</text>
  </svg>`;
}
