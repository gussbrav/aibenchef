import { listPeriodosDisponibles } from "@/lib/domains/informe";
import { handleRoute, requireSession } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    await requireSession();
    const periodos = await listPeriodosDisponibles({ ultimosN: 36 });
    return { periodos };
  });
}
