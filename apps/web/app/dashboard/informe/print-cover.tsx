/**
 * PrintCover — portada premium del PDF exportado. Estilo de reporte
 * corporativo profesional. Solo visible al imprimir.
 *
 * Layout:
 *   - Barra de brand con gradiente arriba
 *   - Wordmark AIBENCHEF letterspaced
 *   - Titulo del reporte en serif grande
 *   - Nombre del cliente destacado
 *   - Grid de metadata (entidad, periodo, fecha, id informe)
 *   - Chips de peer group con puntos de color
 *   - Footer con marca institucional + confidencialidad
 *
 * PrintRunningHeader / PrintRunningFooter — se renderizan en cada
 * pagina (excepto portada) via CSS @media print + position:fixed.
 *
 * PrintWatermark — 'CONFIDENCIAL' diagonal semi-transparente en el
 * fondo de cada pagina de contenido.
 */

/**
 * Genera un ID de reporte deterministico por (cliente, periodo, timestamp).
 * Formato: RPT-YYYYMM-XXXX. Util para citar el informe en emails.
 */
function generarReporteId(clienteSlug: string, periodo: number): string {
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const slugCode = clienteSlug.slice(0, 3).toUpperCase().padEnd(3, "X");
  return `RPT-${periodo}-${slugCode}${ts}`;
}

type PrintCoverProps = {
  clienteNombre: string;
  clienteSlug: string;
  periodo: number;
  periodoLabel: string;
  periodoComparativoLabel: string;
  peerGroup: Array<{ nombre: string; color: string }>;
  entidadPropia: string;
  brandPrimary: string;
  brandAcento: string;
};

export function PrintCover({
  clienteNombre,
  clienteSlug,
  periodo,
  periodoLabel,
  periodoComparativoLabel,
  peerGroup,
  entidadPropia,
  brandPrimary,
  brandAcento,
}: PrintCoverProps) {
  const generadoEl = new Date().toLocaleDateString("es-PE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const reporteId = generarReporteId(clienteSlug, periodo);

  return (
    <div className="print-only print-cover">
      {/* Top: brand bar + wordmark */}
      <div>
        <div
          className="print-cover-brand-bar"
          style={{
            background: `linear-gradient(90deg, ${brandPrimary} 0%, ${brandAcento} 100%)`,
          }}
        />
        <div className="print-cover-wordmark">
          <span className="print-cover-wordmark-a">A</span>
          <span className="print-cover-wordmark-text">AIBENCHEF</span>
        </div>
        <div className="print-cover-brand-sub">
          Plataforma de Analisis Financiero Regulado
        </div>
      </div>

      {/* Middle: titulo + cliente */}
      <div className="print-cover-hero">
        <div className="print-cover-hero-kicker">Informe</div>
        <h1 className="print-cover-hero-title">
          Benchmark
          <br />
          Competitivo
        </h1>
        <div className="print-cover-hero-rule" />
        <div className="print-cover-hero-cliente">{clienteNombre}</div>
        <div className="print-cover-hero-periodo">Cierre {periodoLabel}</div>
      </div>

      {/* Meta grid + peer group */}
      <div>
        <div className="print-cover-meta-table">
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Entidad analizada</div>
            <div className="print-cover-meta-value">{entidadPropia}</div>
          </div>
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Periodo reportado</div>
            <div className="print-cover-meta-value">{periodoLabel}</div>
            <div className="print-cover-meta-sub">vs {periodoComparativoLabel}</div>
          </div>
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Fecha de emision</div>
            <div className="print-cover-meta-value">{generadoEl}</div>
          </div>
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">ID del informe</div>
            <div className="print-cover-meta-value print-cover-meta-mono">{reporteId}</div>
          </div>
        </div>

        <div className="print-cover-peers-section">
          <div className="print-cover-meta-label" style={{ marginBottom: "3mm" }}>
            Grupo comparable ({peerGroup.length} entidades)
          </div>
          <div className="print-cover-peers-list">
            {peerGroup.map((p) => (
              <span key={p.nombre} className="print-cover-peer-chip">
                <span
                  className="print-cover-peer-dot"
                  style={{ backgroundColor: p.color }}
                />
                {p.nombre}
                {p.nombre === entidadPropia && (
                  <span className="print-cover-peer-badge">PROPIA</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Footer institucional */}
      <div className="print-cover-footer">
        <div className="print-cover-footer-rule" />
        <div className="print-cover-footer-grid">
          <div>
            <div className="print-cover-footer-label">Preparado por</div>
            <div className="print-cover-footer-value">Aibenchef</div>
          </div>
          <div>
            <div className="print-cover-footer-label">Fuente de datos</div>
            <div className="print-cover-footer-value">Superintendencia de Banca, Seguros y AFP (SBS Peru)</div>
          </div>
          <div>
            <div className="print-cover-footer-label">Clasificacion</div>
            <div className="print-cover-footer-value print-cover-footer-conf">CONFIDENCIAL</div>
          </div>
        </div>
        <div className="print-cover-footer-note">
          Documento generado automaticamente. Uso exclusivo del destinatario.
          Prohibida su reproduccion parcial o total sin autorizacion escrita.
        </div>
      </div>
    </div>
  );
}

/**
 * Running header — banda sutil en cada pagina (excepto portada). Muestra
 * cliente + periodo a la izq y linea + tipo de doc a la der. Se posiciona
 * fixed en top:0 con display:none default -> solo en @media print.
 */
export function PrintRunningHeader({
  clienteNombre,
  periodoLabel,
}: {
  clienteNombre: string;
  periodoLabel: string;
}) {
  return (
    <div className="print-running-header print-only">
      <span className="print-running-header-left">{clienteNombre}</span>
      <span className="print-running-header-right">
        Informe de Benchmark · {periodoLabel}
      </span>
    </div>
  );
}

/**
 * Running footer — banda al pie de cada pagina con clasificacion +
 * marca + fecha. Los page numbers los genera @page counter en globals.css.
 */
export function PrintRunningFooter({
  clienteNombre,
}: {
  clienteNombre: string;
}) {
  const gen = new Date().toLocaleDateString("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (
    <div className="print-running-footer print-only">
      <span className="print-running-footer-left">CONFIDENCIAL · {clienteNombre}</span>
      <span className="print-running-footer-center">Aibenchef</span>
      <span className="print-running-footer-right">Generado {gen}</span>
    </div>
  );
}

/**
 * Watermark — 'CONFIDENCIAL' diagonal semi-transparente en el background
 * de cada pagina de contenido. Se posiciona fixed y no interfiere con
 * el texto que va encima.
 */
export function PrintWatermark({ text = "CONFIDENCIAL" }: { text?: string }) {
  return (
    <div className="print-watermark print-only" aria-hidden>
      {text}
    </div>
  );
}

/**
 * Cierre del informe: nota final legal + firma. Reemplaza el footer viejo.
 */
export function PrintFooter({
  clienteNombre,
  periodoLabel,
}: {
  clienteNombre: string;
  periodoLabel: string;
}) {
  const generadoEl = new Date().toLocaleString("es-PE", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return (
    <div className="print-only print-closure">
      <div className="print-closure-rule" />
      <h2 className="print-closure-title">Notas metodologicas</h2>
      <ul className="print-closure-notes">
        <li>
          Datos derivados de reportes publicos publicados por la Superintendencia de Banca, Seguros y
          AFP del Peru (SBS) al amparo de la Ley N° 26702. Los estados financieros se toman en su
          version publicada mensualmente por la SBS y estan sujetos a revisiones posteriores del regulador.
        </li>
        <li>
          Indicadores anualizados se calculan sobre los últimos 12 meses móviles. Ratios de rentabilidad
          (ROE, ROA) usan promedios de saldos de 12 meses en el denominador.
        </li>
        <li>
          El grupo comparable se construye siguiendo la regla regulatoria: una entidad top por tipo
          (Bancos, Financieras, CMAC, CRAC, Empresas de Créditos). La entidad propia reemplaza al top
          de su mismo tipo.
        </li>
        <li>
          Los insights generados con inteligencia artificial son de apoyo — no constituyen recomendacion
          de inversion, credito o cualquier accion regulada. Verifique siempre las cifras contra la
          fuente oficial SBS.
        </li>
      </ul>

      <div className="print-closure-disclaimer">
        <strong>Aibenchef es un servicio independiente de analisis financiero,
        no representa ni esta afiliado a la SBS.</strong> El valor que entregamos consiste
        en la capa analitica, metodologica y de consultoria aplicada sobre informacion
        publica. En caso de discrepancia entre nuestro calculo y el valor oficial SBS,
        prevalece la publicacion oficial de SBS. Documentacion completa en{" "}
        <span className="print-closure-disclaimer-url">aibenchef.azoramind.com/fuentes-y-metodologia</span>.
      </div>

      <div className="print-closure-sign">
        <div>
          <strong>{clienteNombre}</strong>
          <br />
          Benchmark {periodoLabel}
        </div>
        <div style={{ textAlign: "right" }}>
          Aibenchef
          <br />
          Emitido {generadoEl}
        </div>
      </div>
    </div>
  );
}
