import { listPeriodosDisponibles } from "@/lib/domains/informe/queries";
import { handleRoute } from "@/lib/domains/shared";
import { requireSession } from "@/lib/auth-helpers";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    await requireSession();
    const periodos = await listPeriodosDisponibles({ ultimosN: 240 });
    return { periodos };
  });
}
