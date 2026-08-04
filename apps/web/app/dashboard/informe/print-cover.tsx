/**
 * PrintCover — portada del PDF exportado. Solo se ve al imprimir (class
 * print-only + display:none en pantalla). Incluye branding del cliente,
 * periodo, peers y fecha de generacion.
 *
 * Diseño: ocupa la primera pagina completa (page-break-after: always) con
 * layout tipo one-pager corporativo — brand-bar arriba, titulo grande, meta
 * grid abajo con dos columnas (info del informe + peer group), y footer
 * con marca de agua.
 */

type PrintCoverProps = {
  clienteNombre: string;
  periodoLabel: string;
  periodoComparativoLabel: string;
  peerGroup: string[];
  entidadPropia: string;
  brandPrimary: string;
  brandAcento: string;
};

export function PrintCover({
  clienteNombre,
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
  return (
    <div className="print-only print-cover">
      <div>
        <div
          className="print-cover-brand-bar"
          style={{
            background: `linear-gradient(90deg, ${brandPrimary}, ${brandAcento})`,
          }}
        />
        <p className="print-cover-brand">Informe de Benchmark Competitivo</p>
        <h1 className="print-cover-title" style={{ marginTop: "4mm" }}>
          {clienteNombre}
        </h1>
        <p className="print-cover-subtitle">
          Analisis financiero comparativo — cierre {periodoLabel}
        </p>
      </div>

      <div>
        <div className="print-cover-meta">
          <div>
            <div className="print-cover-meta-label">Entidad analizada</div>
            <div className="print-cover-meta-value">{entidadPropia}</div>
          </div>
          <div>
            <div className="print-cover-meta-label">Periodo de reporte</div>
            <div className="print-cover-meta-value">
              {periodoLabel}
              <div style={{ fontSize: "9pt", fontWeight: 400, color: "#64748b", marginTop: "1mm" }}>
                Comparativa vs {periodoComparativoLabel}
              </div>
            </div>
          </div>
          <div>
            <div className="print-cover-meta-label">Fecha de generacion</div>
            <div className="print-cover-meta-value">{generadoEl}</div>
          </div>
          <div>
            <div className="print-cover-meta-label">Grupo comparable ({peerGroup.length})</div>
            <div className="print-cover-meta-value" style={{ fontSize: "10pt" }}>
              {peerGroup.map((p, i) => (
                <div key={p} style={{ marginBottom: "1mm" }}>
                  {i + 1}. {p}
                  {p === entidadPropia && (
                    <span
                      style={{
                        marginLeft: "3mm",
                        fontSize: "7pt",
                        padding: "1px 4px",
                        background: "#0f172a",
                        color: "#fff",
                        borderRadius: "2mm",
                        fontWeight: 600,
                      }}
                    >
                      PROPIA
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="print-cover-footer">
        <p style={{ margin: 0 }}>
          <strong>Aibenchef</strong> · Fuente de datos: Superintendencia de Banca, Seguros y AFP (SBS Peru)
        </p>
        <p style={{ margin: "1mm 0 0", fontSize: "7pt", fontStyle: "italic" }}>
          Documento confidencial. Uso exclusivo del cliente. Prohibida su reproduccion parcial o total sin autorizacion.
        </p>
      </div>
    </div>
  );
}

/**
 * PrintFooter — firma al pie del informe (ultima seccion antes del cierre).
 * Se ve solo al imprimir. Reemplaza el pie que el navegador pondria (feo)
 * por uno con marca propia.
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
    <div
      className="print-only"
      style={{
        marginTop: "12mm",
        paddingTop: "6mm",
        borderTop: "1px solid #cbd5e1",
        fontSize: "8pt",
        color: "#64748b",
        display: "flex",
        justifyContent: "space-between",
        gap: "10mm",
      }}
    >
      <div>
        <strong>{clienteNombre}</strong> · Benchmark {periodoLabel}
      </div>
      <div>
        Aibenchef · Generado el {generadoEl}
      </div>
    </div>
  );
}
