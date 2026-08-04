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
                  <Link href={"/solicitar-acceso" as never} className="hover:text-white transition-colors">
                    Solicitar acceso
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
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-800 flex justify-between text-xs">
          <p>© {new Date().getFullYear()} Aibenchef. Todos los derechos reservados.</p>
          <p>Hecho por <span className="text-white">Azoramind</span></p>
        </div>
      </Container>
    </footer>
  );
}
