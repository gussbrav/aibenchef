import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, Terminal, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "MCP para Claude Desktop",
  description:
    "Consultá la data del sistema financiero peruano directamente desde Claude Desktop con el MCP server de Aibenchef. Ideal para tesistas y analistas.",
};

export default function DocsMcpPage() {
  return (
    <article className="docs-article max-w-none">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">MCP para Claude Desktop</h1>
      <p className="text-lg text-slate-600 !mt-0">
        Consulta el sistema financiero peruano directamente desde Claude
        Desktop — sin abrir el navegador, sin escribir SQL, sin descargar
        Excels.
      </p>

      <div className="not-prose mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Feature icon={Sparkles} title="Nativo" desc="Claude entiende los datos financieros automáticamente." />
        <Feature icon={Terminal} title="Setup 2 minutos" desc="Instalas el server + pegas tu API key." />
        <Feature icon={Zap} title="Gratis para tesistas" desc="Plan Académico $9/mes con verificación .edu.pe." />
      </div>

      <h2>¿Qué es MCP?</h2>
      <p>
        <strong>Model Context Protocol</strong> es el estándar abierto de
        Anthropic que permite a Claude conectarse a fuentes de datos
        externas. El MCP server de Aibenchef expone <strong>5 tools</strong>{" "}
        que Claude puede invocar cuando le preguntes algo sobre banca
        peruana.
      </p>

      <h2>Setup (2 minutos)</h2>

      <h3>1. Genera tu API key</h3>
      <p>
        Ingresa a{" "}
        <Link href={"/dashboard/settings" as never}>
          Configuración &gt; API keys
        </Link>{" "}
        y haz click en <strong>Nueva API key</strong>. Copia el token que
        empieza con <code>aibchf_...</code> — solo se muestra una vez.
      </p>

      <h3>2. Configura Claude Desktop</h3>
      <p>Edita el archivo <code>claude_desktop_config.json</code>:</p>
      <ul>
        <li>
          <strong>Windows:</strong>{" "}
          <code>%APPDATA%\Claude\claude_desktop_config.json</code>
        </li>
        <li>
          <strong>macOS:</strong>{" "}
          <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
        </li>
        <li>
          <strong>Linux:</strong>{" "}
          <code>~/.config/Claude/claude_desktop_config.json</code>
        </li>
      </ul>

      <p>Agrega esto (o lo mezclas con lo que ya tengas):</p>

      <pre>
        <code>{`{
  "mcpServers": {
    "aibenchef": {
      "command": "npx",
      "args": ["-y", "@aibenchef/mcp"],
      "env": {
        "AIBENCHEF_API_KEY": "aibchf_tuKeyAqui"
      }
    }
  }
}`}</code>
      </pre>

      <h3>3. Reinicia Claude Desktop</h3>
      <p>
        Cierra completamente Claude Desktop y ábrelo de nuevo. Deberías ver
        el ícono de MCP en la barra inferior con "aibenchef" listado.
      </p>

      <h2>Tools disponibles</h2>

      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Qué hace</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>list_entidades</code></td>
            <td>Catálogo de entidades reguladas (filtro por tipo opcional)</td>
          </tr>
          <tr>
            <td><code>list_periodos_publicados</code></td>
            <td>Periodos YYYYMM disponibles (más reciente primero)</td>
          </tr>
          <tr>
            <td><code>get_eeff</code></td>
            <td>Balance General de una entidad para un periodo</td>
          </tr>
          <tr>
            <td><code>get_kpis</code></td>
            <td>Serie temporal de ratios anualizados (ROA, ROE, Mora, ...)</td>
          </tr>
          <tr>
            <td><code>compare_benchmark</code></td>
            <td>Comparativa lado-a-lado de varias entidades en un periodo</td>
          </tr>
        </tbody>
      </table>

      <h2>Ejemplos para tesistas</h2>

      <div className="not-prose space-y-3 my-6">
        <PromptCard
          category="Mora y calidad de cartera"
          prompt="Analiza la evolución de la mora global de Mibanco entre 2020 y 2024. ¿Cuándo tocó su pico? ¿Y comparado con las principales CMAC?"
        />
        <PromptCard
          category="Rentabilidad"
          prompt="Compara el ROE de Compartamos con los 3 principales bancos comerciales del Perú en el último cierre. Explícame la diferencia."
        />
        <PromptCard
          category="Descomposición DuPont"
          prompt="Descompón el ROE de BCP en ROA × Apalancamiento para los últimos 5 años. ¿Qué componente explica más de la variación?"
        />
        <PromptCard
          category="Punto de equilibrio"
          prompt="Trae la serie de rendimiento de cartera de todas las cajas rurales y calcula cuál está más cerca de su punto de equilibrio operativo."
        />
        <PromptCard
          category="Estructura de balance"
          prompt="Trae el balance de Financiera Confianza a Jun 2026 y arma un análisis vertical y horizontal vs el año anterior."
        />
      </div>

      <h2>Preguntas frecuentes</h2>

      <details>
        <summary>¿Necesito saber programar?</summary>
        <p>
          No. El único paso "técnico" es editar el archivo JSON de
          configuración de Claude Desktop (que es solo copiar/pegar). Una
          vez hecho, chateás con Claude como siempre y él usa las tools
          automáticamente cuando le preguntas sobre banca peruana.
        </p>
      </details>

      <details>
        <summary>¿Funciona en Claude Code y Cursor también?</summary>
        <p>
          Sí. Cualquier cliente que soporte MCP over stdio puede conectarse.
          La configuración es análoga (agregar entry al file de MCP servers).
        </p>
      </details>

      <details>
        <summary>¿Qué pasa si mi tesista/estudiante no tiene tarjeta?</summary>
        <p>
          El plan Free ($0) también permite consultar via API/MCP para
          endpoints básicos con límites bajos. Para volumen decente ($9/mes)
          conviene el plan Académico con verificación por email institucional
          <code>.edu.pe</code> — no requiere tarjeta ni papeleo.
        </p>
      </details>

      <details>
        <summary>¿Puedo instalar el MCP server sin npm?</summary>
        <p>
          El source está en{" "}
          <a
            href="https://github.com/gussbrav/aibenchef"
            target="_blank"
            rel="noreferrer"
          >
            github.com/gussbrav/aibenchef
          </a>{" "}
          bajo <code>apps/mcp-server/</code>. Puedes clonar, compilar y
          apuntar Claude Desktop al binario local si prefieres no depender
          de npm.
        </p>
      </details>

      <h2>Documentación relacionada</h2>
      <ul>
        <li>
          <Link href={"/docs/api" as never}>API REST pública</Link> — endpoints
          HTTP puros sin MCP
        </li>
        <li>
          <Link href={"/#planes" as never}>Planes y precios</Link>
        </li>
      </ul>
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

function PromptCard({ category, prompt }: { category: string; prompt: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300 transition-colors">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-brand-600 mb-1">
        {category}
      </p>
      <p className="text-sm text-slate-800 italic leading-relaxed">
        "{prompt}"
      </p>
    </div>
  );
}
