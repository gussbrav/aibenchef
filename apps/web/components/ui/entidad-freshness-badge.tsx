/**
 * EntidadFreshnessBadge — chip visual reutilizable para marcar entidades
 * sin data reciente en los selectores del dashboard.
 *
 * Uso: dentro de un modal/combobox de seleccion de entidades, computar
 * `maxUltimoPeriodo` una vez y pasar `ultimoPeriodo` por-entidad. El
 * componente decide si mostrar el badge (solo si gap > threshold).
 *
 *   const max = computeMaxUltimoPeriodo(disponibles);
 *   ...
 *   <EntidadFreshnessBadge
 *     ultimoPeriodo={e.ultimoPeriodo}
 *     maxDisponible={max}
 *   />
 *
 * Componente server-safe (sin hooks ni event handlers). Se puede
 * importar desde client OR server components.
 */

import {
  esObsoleta,
  fmtPeriodoLabel,
  FRESHNESS_THRESHOLD_MESES,
} from "@/lib/utils/periodo-freshness";

type Props = {
  ultimoPeriodo: number | null | undefined;
  maxDisponible: number;
  /** Variante compacta (solo icono + texto corto). Default false = con label. */
  compact?: boolean;
  /** Threshold custom en meses. Default 3. */
  thresholdMeses?: number;
};

export function EntidadFreshnessBadge({
  ultimoPeriodo,
  maxDisponible,
  compact = false,
  thresholdMeses = FRESHNESS_THRESHOLD_MESES,
}: Props) {
  if (!esObsoleta(ultimoPeriodo, maxDisponible, thresholdMeses)) return null;

  const label = ultimoPeriodo ? fmtPeriodoLabel(ultimoPeriodo) : "?";
  const title =
    `Sin data desde ${label}. Esta entidad probablemente cambió de nombre ` +
    `(rename histórico). Verifica si existe un canónico más reciente para ver ` +
    `la data completa, o activa "Renombres unidos" para consolidar la historia.`;

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-200"
        title={title}
      >
        ⚠ {label}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-200"
      title={title}
    >
      ⚠ sin data reciente
    </span>
  );
}
