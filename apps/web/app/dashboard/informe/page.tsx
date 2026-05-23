import type { Metadata } from "next";
import { InformeClient } from "./informe-client";
import { CAJA_AREQUIPA_ABR_2020 } from "./fixture-data";

export const metadata: Metadata = {
  title: "Informe Ejecutivo",
};

export const dynamic = "force-dynamic";

// Por ahora la pagina sirve la fixture del benchmark Caja Arequipa Abr-2020
// para validar el diseño visual. La proxima iteracion conecta a
// marts.v_punto_equilibrio_ancho + marts.fact_kpis_mensuales (V033/V034).
export default async function InformeEjecutivoPage() {
  return <InformeClient data={CAJA_AREQUIPA_ABR_2020} />;
}
