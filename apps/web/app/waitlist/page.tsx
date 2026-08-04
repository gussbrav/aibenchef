import { redirect } from "next/navigation";

/**
 * /waitlist redirige a /solicitar-acceso. La pagina waitlist original era del
 * launch beta privado — ahora unificamos el flujo de captacion en un solo
 * lugar. Se conserva la ruta para no romper links viejos ya publicados.
 */
export default function WaitlistPage() {
  redirect("/solicitar-acceso" as never);
}
