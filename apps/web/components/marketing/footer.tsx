import Link from "next/link";
import { Container } from "@/components/ui";

export function Footer() {
  return (
    <footer className="bg-slate-950 text-slate-400 py-12">
      <Container size="xl">
        <div className="flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="space-y-3">
            <p className="text-2xl font-bold text-white">Aibenchef</p>
            <p className="text-sm max-w-xs">
              Inteligencia financiera para el sistema bancario peruano. Hecho en Perú.
            </p>
          </div>
          <div className="flex gap-12 text-sm">
            <div className="space-y-3">
              <p className="font-semibold text-white">Producto</p>
              <ul className="space-y-2">
                <li>
                  <Link href="/#planes" className="hover:text-white transition-colors">
                    Planes
                  </Link>
                </li>
                <li>
                  <Link href="/signup" className="hover:text-white transition-colors">
                    Empezar gratis
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <p className="font-semibold text-white">Legal</p>
              <ul className="space-y-2">
                <li>
                  <Link href="/terminos" className="hover:text-white transition-colors">
                    Términos
                  </Link>
                </li>
                <li>
                  <Link href="/privacidad" className="hover:text-white transition-colors">
                    Privacidad
                  </Link>
                </li>
                <li>
                  <Link
                    href={"/fuentes-y-metodologia" as never}
                    className="hover:text-white transition-colors"
                  >
                    Fuentes y metodología
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-800 space-y-4 text-xs">
          <p className="text-[11px] leading-relaxed max-w-4xl text-slate-500">
            Datos derivados de reportes públicos publicados por la Superintendencia
            de Banca, Seguros y AFP del Perú (SBS) al amparo de la Ley N° 26702.
            Aibenchef es un servicio independiente de análisis financiero,{" "}
            <strong className="text-slate-400">
              no representa ni está afiliado a la SBS
            </strong>
            . Ver{" "}
            <Link
              href={"/fuentes-y-metodologia" as never}
              className="underline hover:text-slate-300"
            >
              Fuentes y metodología
            </Link>{" "}
            para detalle del origen y las transformaciones aplicadas.
          </p>
          <div className="flex justify-between flex-wrap gap-4">
            <p>© {new Date().getFullYear()} Aibenchef. Todos los derechos reservados.</p>
            <p>Hecho por <span className="text-white">Azoramind</span></p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
