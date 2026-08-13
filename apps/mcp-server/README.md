# @aibenchef/mcp

MCP (Model Context Protocol) server para consumir la data pública del sistema financiero peruano desde Claude Desktop, Claude Code, Cursor o cualquier cliente MCP.

## Instalación

Necesitas Node.js 20+.

```bash
npx @aibenchef/mcp
```

O global:

```bash
npm install -g @aibenchef/mcp
```

## Configuración

1. Genera una API key en <https://aibenchef.azoramind.com/dashboard/settings> (tab **API keys**).
2. Configura tu cliente MCP con la key.

### Claude Desktop

Edita `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aibenchef": {
      "command": "npx",
      "args": ["-y", "@aibenchef/mcp"],
      "env": {
        "AIBENCHEF_API_KEY": "aibchf_tuKeyAqui"
      }
    }
  }
}
```

Reiniciá Claude Desktop. Deberías ver "aibenchef" en el menú de MCP servers.

### Claude Code / Cursor

Similar. Consultá la doc del cliente para agregar un MCP server local vía stdio.

## Tools disponibles

| Tool | Descripción |
|---|---|
| `list_entidades` | Lista de entidades reguladas (filtro por tipo opcional) |
| `list_periodos_publicados` | Periodos YYYYMM disponibles (más reciente primero) |
| `get_eeff` | Balance General de una entidad para un periodo |
| `get_kpis` | Serie temporal de ratios anualizados (ROA, ROE, Mora, etc.) |
| `compare_benchmark` | Comparativa lado-a-lado de varias entidades |

## Ejemplos de prompts

Una vez configurado, en Claude Desktop podés preguntar:

- *"Compará la mora de Mibanco vs las principales CMAC en el último cierre."*
- *"Traé el balance de BCP para Jun 2026 y resumime los rubros principales."*
- *"Analizá la evolución del ROE de Compartamos entre 2020 y 2024. ¿Cuándo mejoró más?"*
- *"Lista todas las cajas rurales activas y ordenalas por su ROA del último periodo."*

## Rate limits

Según tu plan en Aibenchef:

- **Académico** ($9/mes, verificación email `.edu.pe`): 60 req/min
- **Pro** ($149/mes): 300 req/min
- **Business** ($399/mes): 600 req/min

## Variables de entorno

- `AIBENCHEF_API_KEY` (obligatorio) — tu API key
- `AIBENCHEF_BASE_URL` (opcional) — default `https://aibenchef.azoramind.com/api/public/v1`

## Documentación completa

<https://aibenchef.azoramind.com/docs/mcp>

## Licencia

MIT
