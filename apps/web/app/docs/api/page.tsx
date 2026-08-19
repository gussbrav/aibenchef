import type { Metadata } from "next";
import Link from "next/link";
import { Key, Lock, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "API pública REST",
  description:
    "Documentación de la API REST pública de Aibenchef — endpoints, autenticación por API key, rate limits, ejemplos curl.",
};

export default function DocsApiPage() {
  return (
    <article className="docs-article max-w-none">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">API pública REST</h1>
      <p className="text-lg text-slate-600 mt-0">
        Consume la data del sistema financiero peruano desde tus scripts,
        notebooks o pipelines. HTTP/JSON estándar, autenticación por API key.
      </p>

      <div className="not-prose mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Feature icon={Key} title="API keys" desc="Genera y revocas tus keys desde el panel." />
        <Feature icon={Lock} title="Seguridad" desc="SHA-256 + rate limit por plan." />
        <Feature icon={Zap} title="Base URL" desc="https://aibenchef.azoramind.com/api/public/v1" />
      </div>

      <h2>Autenticación</h2>
      <p>
        Todas las requests requieren un header <code>Authorization: Bearer &lt;api_key&gt;</code>{" "}
        (alternativa: <code>X-API-Key: &lt;api_key&gt;</code>). Genera tus
        keys en{" "}
        <Link href={"/dashboard/settings" as never}>Configuración &gt; API keys</Link>.
        {" "}
        Formato del token: <code>aibchf_xxxx...</code>.
      </p>

      <h2>Rate limits</h2>
      <p>
        El acceso a la API está incluido en el plan <strong>Business</strong>{" "}
        (cotización a medida). Límites según acuerdo del engagement:
      </p>
      <ul>
        <li>
          <strong>Business estándar</strong>: 600 requests / minuto por API key
        </li>
        <li>
          <strong>Business enterprise</strong>: límites custom según volumen
        </li>
      </ul>
      <p>
        Response incluye headers <code>x-ratelimit-limit</code> y{" "}
        <code>x-ratelimit-remaining</code>. Excedido devuelve 429.
      </p>

      <h2>Endpoints</h2>

      <h3>GET /entidades</h3>
      <p>
        Catálogo de entidades reguladas activas. Query opcional{" "}
        <code>?tipo=BANCOS|FINANCIERAS|CMAC|CRAC|EDPYMES</code>.
      </p>
      <pre>
        <code>{`curl -H "Authorization: Bearer aibchf_..." \\
  "https://aibenchef.azoramind.com/api/public/v1/entidades?tipo=CMAC"`}</code>
      </pre>

      <h3>GET /periodos</h3>
      <p>
        Lista de periodos YYYYMM publicados (DESC). Query opcional{" "}
        <code>?ultimosN=60</code>.
      </p>
      <pre>
        <code>{`curl -H "Authorization: Bearer aibchf_..." \\
  "https://aibenchef.azoramind.com/api/public/v1/periodos"

# → { "data": [202606, 202605, 202604, ...] }`}</code>
      </pre>

      <h3>GET /entidades/&#123;nomb&#125;/eeff</h3>
      <p>
        Balance General de una entidad para un periodo. Params:{" "}
        <code>periodo=YYYYMM</code> (obligatorio),{" "}
        <code>moneda=TOTAL|MN|ME</code> (default TOTAL).
      </p>
      <pre>
        <code>{`curl -H "Authorization: Bearer aibchf_..." \\
  "https://aibenchef.azoramind.com/api/public/v1/entidades/Banco%20de%20Cr%C3%A9dito%20del%20Per%C3%BA/eeff?periodo=202606"`}</code>
      </pre>

      <h3>GET /entidades/&#123;nomb&#125;/kpis</h3>
      <p>
        Serie temporal de ratios anualizados (TTM): ROA, ROE, Mora,
        Cobertura, Eficiencia, Apalancamiento, etc. Params:{" "}
        <code>desde=YYYYMM</code>, <code>hasta=YYYYMM</code>,{" "}
        <code>moneda=TOTAL|MN|ME</code>.
      </p>
      <pre>
        <code>{`curl -H "Authorization: Bearer aibchf_..." \\
  "https://aibenchef.azoramind.com/api/public/v1/entidades/Mibanco/kpis?desde=202401&hasta=202606"`}</code>
      </pre>

      <h3>GET /benchmarks</h3>
      <p>
        Comparativa lado-a-lado de ratios para varias entidades en el mismo
        periodo. Params: <code>entidades=X,Y,Z</code> (CSV, obligatorio,
        max 20), <code>periodo=YYYYMM</code> (default último).
      </p>
      <pre>
        <code>{`curl -H "Authorization: Bearer aibchf_..." \\
  "https://aibenchef.azoramind.com/api/public/v1/benchmarks?entidades=BCP,BBVA,Interbank&periodo=202606"`}</code>
      </pre>

      <h2>Formato de respuesta</h2>
      <p>
        Éxito (2xx): <code>{`{ "data": ... }`}</code>. Error (4xx/5xx):{" "}
        <code>{`{ "error": { "code": "...", "message": "..." } }`}</code>.
      </p>

      <h2>Códigos de error</h2>
      <ul>
        <li>
          <code>401 missing_token</code> — Falta el header Authorization
        </li>
        <li>
          <code>401 invalid_token</code> — Token inválido o revocado
        </li>
        <li>
          <code>402 plan_no_api</code> — Tu plan no incluye acceso API
        </li>
        <li>
          <code>422 validation</code> — Params inválidos
        </li>
        <li>
          <code>429 rate_limit_exceeded</code> — Rate limit del plan superado
        </li>
        <li>
          <code>500 internal_error</code> — Error interno
        </li>
      </ul>

      <h2>Enforcement de plan</h2>
      <p>
        Los caps del engagement se aplican server-side incluso desde la API:
      </p>
      <ul>
        <li>
          <strong>Peer group</strong>: <code>/benchmarks?entidades=X,Y,Z,...</code>{" "}
          se trunca al <code>maxPeers</code> acordado en el contrato Business.
          El response incluye <code>meta.planLimited=true</code> si
          hubo truncamiento.
        </li>
        <li>
          <strong>Ventana histórica</strong>: en <code>/kpis</code> y{" "}
          <code>/eeff</code>, si pediste un periodo fuera del rango del engagement,
          el server clampea (KPIs) o devuelve 422 (EEFF).
        </li>
      </ul>

      <h2>Preguntas frecuentes</h2>
      <details>
        <summary>¿Puedo compartir mi API key en un repo público?</summary>
        <p>
          No. La key da acceso a tu cuenta con tus límites de plan y consume
          tu rate limit. Si la comprometes por accidente, revócala inmediatamente
          desde el panel y crea una nueva.
        </p>
      </details>
      <details>
        <summary>¿Hay SDK oficial?</summary>
        <p>
          Aún no. La API es HTTP/JSON simple, cualquier cliente HTTP funciona.
          El{" "}
          <Link href={"/docs/mcp" as never}>MCP server para Claude Desktop</Link>{" "}
          es el "SDK" recomendado para equipos técnicos que consuman desde Claude.
        </p>
      </details>
      <details>
        <summary>¿Aparece la API en Free o en la prueba de 14 días?</summary>
        <p>
          No. Free y la prueba dan acceso al dashboard pero no a la API
          (protege el activo — la API permitiría bulk extraction). El
          acceso a la API se incluye al contratar Business (cotización
          a medida). Contáctanos por WhatsApp para armar tu propuesta.
        </p>
      </details>
    </article>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <Icon className="w-5 h-5 text-brand-600 mb-2" />
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-xs text-slate-600 mt-0.5">{desc}</p>
    </div>
  );
}
