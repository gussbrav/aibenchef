/**
 * Prompt template para "Doctor Financiero — Punto de Equilibrio" v7.
 *
 * Correcciones sobre v6:
 *  - v6 permitia inferir contexto desde nombres geograficos ("con nombre
 *    de barrio cusqueño, apunta a base regional abierta al publico") —
 *    eso es alucinacion disfrazada: muchos nombres de santo (San Blas,
 *    Santa Rosa, San Juan, San Pedro) aparecen en decenas de lugares
 *    distintos. v7 RESTRINGE las inferencias a nombres INEQUIVOCAMENTE
 *    institucionales (COOSUNAT, COOPMINSA, COOP FFAA, etc.), prohibe
 *    inferencia desde nombres geograficos ambiguos.
 *  - v6 permitia tono ligeramente despectivo en comparaciones ("COOSUNAT
 *    apenas alcanza 0.91 pp"). v7 agrega REGLA DE RESPETO: prohibido
 *    "apenas", "solo", "nada mas" en comparativas. Cada entidad sirve
 *    a su poblacion y tiene racionalidad propia — no juzgamos estrategia,
 *    analizamos numeros.
 *  - v7 sube la barra de calidad a "HBR en español + columna economica
 *    de prensa seria". Target: output consumible por dueños de entidad
 *    financiera / gerencia general — tiene que ser carnecita (sustancia
 *    densa), no hueso (estructura vacia).
 *
 * Correcciones sobre v5 (heredadas en v7):
 *  - v5 sonaba defensivo al punto de parecer amateur: el LLM repetia 3-4
 *    veces por analisis frases tipo "no puedes afirmar X / sin dato Y no
 *    sabemos Z", lo que le da al cliente la sensacion de que el analista
 *    no se preparo. v6 permite al LLM usar CONTEXTO PUBLICO sobre las
 *    entidades (nombres indicativos tipo COOSUNAT = vinculo SUNAT por
 *    planilla; patron de cifras que sugiere un segmento) como HIPOTESIS
 *    PROFESIONAL, no invencion. Y consolida las limitaciones
 *    metodologicas a UNA linea al cierre del Bullet 1, no dispersas por
 *    todo el analisis.
 *  - v6 reformula REGLA 0: no inventes CIFRAS (eso sigue inviolable),
 *    pero si permite plantear hipotesis contextuales grounded en nombre
 *    de entidad o patron visible — siempre marcadas como hipotesis.
 *  - v6 cambia el tono de los "limites" de defensivo ("no puedo afirmar")
 *    a propositivo ("convendria complementar con X para afinar"): la
 *    misma informacion pero con lenguaje de consultor que sabe lo que
 *    hace, no de becario que se cubre.
 *
 * Correcciones sobre v4 (heredadas en v6):
 *  - v4 usaba "Margen de Seguridad" como termino canonico de robustez — pero
 *    no es terminologia peruana clasificadora, confunde al lector. v5 lo
 *    renombra a "holgura sobre el PE" (o "colchon operativo" o "aire sobre
 *    el PE" como sinonimos), que si es natural en el ambiente financiero
 *    peruano.
 *  - v4 escribia correcto pero sonaba robotico: listicles academicos
 *    "(i)/(ii)/(iii)", explicaciones infantiles al CFO ("cada sol de
 *    cartera genera X centavos"), bullets etiquetados "ENCUADRE DEL
 *    ANALISIS:" que leakeaban desde el prompt. v5 reescribe la seccion de
 *    instrucciones con VOZ EDITORIAL explicita: ejemplos de voz correcta
 *    vs incorrecta, anti-patrones nombrados, rol del analista economico de
 *    prensa peruana seria (no consultor de manual).
 *  - v4 permitia emojis (max 1 por bullet). v5 los prohibe — es analisis
 *    financiero serio, no post de redes.
 *  - v5 agrega "REGLA 0 — NO INVENTES NADA" como primera regla
 *    inviolable, antes de cualquier instruccion de voz.
 *
 * Correcciones sobre v3 (heredadas en v5):
 *  - v3 medía fortaleza por PE absoluto y confundía margen alto con cushion
 *    (una entidad con rendimiento 35% y PE 32% tiene mas colchon que otra
 *    con rendimiento 16% y PE 15%, aunque el PE absoluto sea mayor).
 *    v4 introduce "Margen de Seguridad" = Rendimiento − PE como metrica
 *    PRINCIPAL de robustez.
 *  - v3 no declaraba universo de comparacion. v4 fuerza al LLM a decir si
 *    el peer group es solo COOPAC, solo Sistema Financiero o mixto, y a
 *    moderar conclusiones cuando hay heterogeneidad de modelos de negocio.
 *  - v3 no prohibia inferir "recorto costos" desde variacion de ratios.
 *    v4 lo prohibe explicitamente — un ratio cae por numerador o por
 *    denominador, asi que sin montos absolutos solo se habla de ratios.
 *  - v3 forzaba 6 bullets incluso con peer group de 2. v4 escala: 4
 *    bullets densos cuando N<=2, 6 bullets cuando N>=3.
 *  - v3 no tenia conocimiento de COOPAC. v4 si — y advierte cuando no se
 *    puede distinguir COOPAC cerrada (planilla) vs abierta.
 *
 * Contexto esperado en ctx.contexto:
 *   entidades: Array<{
 *     entidad: string;
 *     rendimiento: number;          // % (0-1)
 *     otros: number;                // % (0-1) — puede ser (+) o (-)
 *     gastoFinanciero: number;      // % (0-1) — negativo natural
 *     costoProvision: number;       // % (0-1) — negativo natural
 *     gastosOp: number;             // % (0-1) — negativo natural
 *     margenAntesImpuestos: number; // % (0-1)
 *     puntoEquilibrio: number;      // % (0-1) — valor absoluto (carga total)
 *   }>
 *   tendenciaPropia: Array<{
 *     periodoLabel: string;
 *     rendimiento: number;
 *     gastoFinanciero: number;
 *     costoProvision: number;
 *     gastosOp: number;
 *     margen: number;
 *     puntoEquilibrio: number;
 *   }>
 *
 * Campos NUEVOS en v4 (todos opcionales — el prompt degrada si faltan):
 *   universoTipo: "solo_coopac" | "solo_sf" | "mixto" | "no_declarado"
 *   tipoPorEntidad: Record<entidad, tipoRegulatorio>  // "BANCOS", "CMAC", "COOPAC_N3", etc
 *   moraReal: Record<entidad, number | null>          // % (0-1) — cartera atrasada / bruta
 *   roe: Record<entidad, number | null>               // % (0-1)
 *   montosPropia: Array<{                             // montos absolutos por periodo
 *     periodoLabel: string;
 *     carteraBrutaMM: number;    // MM S/
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type PERow = {
  entidad: string;
  rendimiento: number;
  otros: number;
  gastoFinanciero: number;
  costoProvision: number;
  gastosOp: number;
  margenAntesImpuestos: number;
  puntoEquilibrio: number;
};

type TendenciaPunto = {
  periodoLabel: string;
  rendimiento: number;
  gastoFinanciero: number;
  costoProvision: number;
  gastosOp: number;
  margen: number;
  puntoEquilibrio: number;
};

type MontoPropia = {
  periodoLabel: string;
  carteraBrutaMM: number;
};

type UniversoTipo = "solo_coopac" | "solo_sf" | "mixto" | "no_declarado";

export const promptPuntoEquilibrio: PromptTemplate = {
  version: "v7",
  seccion: "punto_equilibrio",
  build(ctx: PromptContext): { system: string; user: string } {
    const entidades = (ctx.contexto.entidades ?? []) as PERow[];
    const tendenciaPropia = (ctx.contexto.tendenciaPropia ?? []) as TendenciaPunto[];
    const universoTipo = (ctx.contexto.universoTipo ?? "no_declarado") as UniversoTipo;
    const tipoPorEntidad = (ctx.contexto.tipoPorEntidad ?? {}) as Record<string, string>;
    const moraReal = (ctx.contexto.moraReal ?? {}) as Record<string, number | null>;
    const roePorEntidad = (ctx.contexto.roe ?? {}) as Record<string, number | null>;
    const montosPropia = (ctx.contexto.montosPropia ?? []) as MontoPropia[];

    // Ranking por MARGEN DE SEGURIDAD (rendimiento − PE), no por margen
    // antes de impuestos ni por PE absoluto. Es la metrica real de robustez.
    const conMargenSeg = entidades.map((e) => ({
      ...e,
      margenSeguridad: e.rendimiento - e.puntoEquilibrio,
    }));
    const sortedBySeg = [...conMargenSeg].sort(
      (a, b) => b.margenSeguridad - a.margenSeguridad,
    );
    const mejor = sortedBySeg[0];
    const peor = sortedBySeg[sortedBySeg.length - 1];
    const propiaRow = conMargenSeg.find((e) => e.entidad === ctx.entidadPropia);

    const promMargen =
      entidades.length > 0
        ? entidades.reduce((s, e) => s + e.margenAntesImpuestos, 0) / entidades.length
        : 0;
    const promRend =
      entidades.length > 0
        ? entidades.reduce((s, e) => s + e.rendimiento, 0) / entidades.length
        : 0;
    const promGO =
      entidades.length > 0
        ? entidades.reduce((s, e) => s + e.gastosOp, 0) / entidades.length
        : 0;
    const promMargenSeg =
      conMargenSeg.length > 0
        ? conMargenSeg.reduce((s, e) => s + e.margenSeguridad, 0) / conMargenSeg.length
        : 0;

    const fmt = (v: number) => (v * 100).toFixed(2);
    const fmtSigned = (v: number) => {
      const s = (v * 100).toFixed(2);
      return v >= 0 ? `+${s}` : s;
    };

    const prettyTipo = (t: string | undefined | null): string => {
      if (!t) return "tipo no identificado";
      if (t === "BANCOS") return "Banco";
      if (t === "FINANCIERAS") return "Financiera";
      if (t === "CMAC") return "Caja Municipal";
      if (t === "CRAC") return "Caja Rural";
      if (t === "EDPYMES") return "EDPYME";
      if (t === "COOPAC_N1") return "COOPAC Nivel 1";
      if (t === "COOPAC_N2A") return "COOPAC Nivel 2A";
      if (t === "COOPAC_N2B") return "COOPAC Nivel 2B";
      if (t === "COOPAC_N3") return "COOPAC Nivel 3";
      return t;
    };

    const tabla = conMargenSeg
      .map((e) => {
        const marca = e.entidad === ctx.entidadPropia ? " ← ENTIDAD PROPIA" : "";
        return (
          `| ${e.entidad.padEnd(28)} | ${fmt(e.rendimiento).padStart(6)}% | ${fmtSigned(e.otros).padStart(7)}% | ${fmtSigned(e.gastoFinanciero).padStart(7)}% | ${fmtSigned(e.costoProvision).padStart(7)}% | ${fmtSigned(e.gastosOp).padStart(7)}% | ${fmt(e.puntoEquilibrio).padStart(6)}% | ${fmtSigned(e.margenSeguridad).padStart(7)}pp |${marca}`
        );
      })
      .join("\n");

    // NOTA: internamente la variable sigue llamandose margenSeguridad por
    // compatibilidad, pero en el output al usuario se usa "holgura sobre el PE"
    // o "colchon operativo" — "margen de seguridad" no es terminologia
    // estandar en analisis financiero peruano y confunde al lector.

    // Lista de composicion del peer group con tipo + indicadores complementarios
    const listaComposicion = conMargenSeg
      .map((e) => {
        const tipo = prettyTipo(tipoPorEntidad[e.entidad]);
        const mora = moraReal[e.entidad];
        const roe = roePorEntidad[e.entidad];
        const moraTxt = mora != null ? ` · mora cartera atrasada: ${fmt(mora)}%` : "";
        const roeTxt = roe != null ? ` · ROE: ${fmt(roe)}%` : "";
        return `  - ${e.entidad} — ${tipo}${moraTxt}${roeTxt}`;
      })
      .join("\n");

    // Tabla de tendencia historica de la entidad propia, con montos cuando esten
    const tablaTendencia =
      tendenciaPropia.length > 0
        ? tendenciaPropia
            .map((p) => {
              const monto = montosPropia.find((m) => m.periodoLabel === p.periodoLabel);
              const montoTxt = monto
                ? ` ${monto.carteraBrutaMM.toFixed(1).padStart(8)}`
                : "        —";
              return `| ${p.periodoLabel.padEnd(12)} | ${fmt(p.rendimiento).padStart(6)}% | ${fmtSigned(p.gastoFinanciero).padStart(7)}% | ${fmtSigned(p.costoProvision).padStart(7)}% | ${fmtSigned(p.gastosOp).padStart(7)}% | ${fmt(p.puntoEquilibrio).padStart(6)}% | ${fmtSigned(p.rendimiento - p.puntoEquilibrio).padStart(7)}pp |${montoTxt} MM S/ |`;
            })
            .join("\n")
        : null;

    // Diagnostico cuantitativo de tendencia de margen de seguridad
    let tendenciaDiag = "";
    if (tendenciaPropia.length >= 2) {
      const primero = tendenciaPropia[0];
      const ultimo = tendenciaPropia[tendenciaPropia.length - 1];
      const segIni = primero.rendimiento - primero.puntoEquilibrio;
      const segFin = ultimo.rendimiento - ultimo.puntoEquilibrio;
      const deltaSeg = ((segFin - segIni) * 100).toFixed(2);
      const deltaRend = ((ultimo.rendimiento - primero.rendimiento) * 100).toFixed(2);
      const deltaGO = ((ultimo.gastosOp - primero.gastosOp) * 100).toFixed(2);
      const signo = (n: string) => (parseFloat(n) >= 0 ? `+${n}` : n);
      tendenciaDiag = `Desde ${primero.periodoLabel} hasta ${ultimo.periodoLabel}: Margen Seguridad ${signo(deltaSeg)} pp | Rendimiento ${signo(deltaRend)} pp | Ratio GastosOp ${signo(deltaGO)} pp`;
    }

    // Deteccion automatica de heterogeneidad del peer group
    const tiposPresentes = new Set(
      Object.values(tipoPorEntidad).filter((t) => t && t !== "tipo_no_declarado"),
    );
    const hayCoopac = Array.from(tiposPresentes).some((t) => t.startsWith("COOPAC_"));
    const haySF = Array.from(tiposPresentes).some((t) => !t.startsWith("COOPAC_"));
    const nivelesCoopacPresentes = Array.from(tiposPresentes).filter((t) =>
      t.startsWith("COOPAC_"),
    );
    const hayHeterogeneidad =
      tiposPresentes.size > 1 ||
      (hayCoopac && haySF) ||
      nivelesCoopacPresentes.length > 1;

    const universoEtiqueta =
      universoTipo === "solo_coopac"
        ? "SOLO COOPAC (cooperativas de ahorro y credito reguladas por SBS)"
        : universoTipo === "solo_sf"
          ? "SOLO SISTEMA FINANCIERO (bancos, financieras, cajas, edpymes — sin coopac)"
          : universoTipo === "mixto"
            ? "MIXTO (coopac + sistema financiero — benchmark heterogeneo, advertencia obligatoria)"
            : "NO DECLARADO (el builder no pudo determinar el universo — tienes que decirlo explicitamente)";

    const bulletsCount = entidades.length <= 2 ? 4 : 6;

    const posicionPropia = propiaRow
      ? sortedBySeg.findIndex((e) => e.entidad === ctx.entidadPropia) + 1
      : null;

    const avisoHeterogeneidad = hayHeterogeneidad
      ? `ADVERTENCIA DE HETEROGENEIDAD: el grupo mezcla tipos regulatorios distintos${hayCoopac && haySF ? " (COOPAC + Sistema Financiero)" : nivelesCoopacPresentes.length > 1 ? " (COOPAC de niveles distintos — tamaños muy distintos)" : ""}. Las comparaciones directas de rendimiento, PE y margen NO son concluyentes por si solas — tienes que declararlo en el Bullet 1 y moderar las conclusiones de los siguientes bullets.`
      : `Grupo homogeneo en tipo regulatorio. Las comparaciones de ratios son mas interpretables, pero sigue vigente la regla de mix de cartera: sin dato de composicion por segmento (microempresa/consumo/hipotecario) no se puede afirmar perfil de riesgo.`;

    const avisoMuestra =
      entidades.length <= 2
        ? `ADVERTENCIA DE MUESTRA PEQUEÑA: con ${entidades.length} entidad(es) en el grupo, NO uses lenguaje de "lider sectorial", "promedio del grupo" ni "mediana" como si fuera estadistica — son observaciones puntuales. Nombralas por nombre y declara la limitacion de la muestra.`
        : "";

    const avisoCoopac = hayCoopac
      ? `NOTA SOBRE COOPAC: la data regulatoria no distingue COOPAC de vinculo cerrado (socios = empleados de una institucion, cobro por planilla) de COOPAC abierta al publico. Son modelos de negocio radicalmente distintos: la cerrada tiene cartera cautiva y mora estructuralmente baja, la abierta compite en el mercado. Si tu analisis depende del modelo, declara que no puedes afirmarlo con los datos disponibles.`
      : "";

    const bulletsExplicacion =
      bulletsCount === 4
        ? `Bullet 1 — encuadre sustantivo del benchmark:
Abre leyendo el grupo con oficio. Lo que SI tienes como dato duro: tipo regulatorio y nivel SBS de cada entidad (N1 vs N2A, etc.), lo que implica orden de magnitud distinto de escala. Lo que PUEDES plantear SOLO si el nombre es inequivocamente institucional (COOSUNAT, COOPMINSA, COOP FFAA, COOP MAGISTERIAL): el modelo de vinculo cerrado. Para nombres ambiguos (toponimos comunes, santos como "San Blas", nombres que aparecen en multiples lugares de Peru): NO inferir geografia ni modelo — pasa directo al analisis de cifras. Si el patron de rendimiento + provisiones sugiere un segmento de cartera, plantea como hipotesis a validar. Al cierre del bullet, en UNA linea, reconoce la limitacion metodologica que queda (cruzar con mora real por segmento y composicion interna) — solo una vez, no la repitas. Cierra con una lectura que oriente lo que viene.

Bullet 2 — ${ctx.entidadPropia} contra su historia:
Donde esta su holgura hoy, de donde viene, y que movio la aguja. Lee la tendencia como hace un editorialista: no describas la tabla fila por fila — identifica el quiebre (cuando paso de rojo a positivo, cuando se estanco, cuando acelero) y cuentalo. Si la holgura actual es estrecha dilo, si se consolido dilo. Cierra con tu diagnostico — una sola frase contundente.

Bullet 3 — el componente que mas pesa:
Cual renglon del PE carga mas a ${ctx.entidadPropia} y como se movio su ratio. REGLA: si no hay columna Cartera en la tabla de tendencia, di "el ratio mejoro X pp" — nunca "redujo costos" ni "contrajo gastos". Si sí hay columna Cartera, puedes cruzar movimiento absoluto con movimiento de ratio y sacar conclusion real. Compara con el otro peer solo si la comparacion aporta luz (ej: la diferencia enorme en ratio de gastos operacionales se explica razonablemente por diferencia de escala entre niveles COOPAC distintos, no solo por eficiencia). Cierra con una recomendacion contundente — una, no tres.

Bullet 4 — prioridades para los proximos trimestres:
Dos o tres cosas que ${ctx.entidadPropia} debe hacer, armadas como narrativa (nunca "1) 2) 3)"). Sé especifico: que proteger, que acelerar, que vigilar — con horizonte temporal razonable (6-12 meses). Si tienes base para una prediccion condicional cuantitativa ("si el rendimiento cae mas de 2.5 pp sin que baje el PE, la holgura vuelve a negativo"), dila. Cierra con una pregunta fuerte que el directorio deberia poder responder — una pregunta que ponga el dedo en el tema real. NO cierres repitiendo las limitaciones metodologicas — eso ya lo dijiste en el Bullet 1.`
        : `Bullet 1 — encuadre sustantivo del benchmark:
Abre leyendo el grupo con oficio. Lo que SI tienes como dato duro: universo (solo COOPAC / solo SF / mixto), composicion por tipo y nivel SBS. Lo que PUEDES plantear SOLO si el nombre es inequivocamente institucional (COOSUNAT, COOPMINSA, COOP FFAA, COOP MAGISTERIAL): el modelo de vinculo cerrado. Nombres ambiguos (toponimos comunes, santos como San Blas, nombres que aparecen en multiples lugares de Peru): NO inferir geografia ni modelo — pasa directo al analisis de cifras. Si el patron de cifras de ${ctx.entidadPropia} sugiere un segmento de cartera, plantea como hipotesis a validar. Al cierre del bullet, en UNA linea, reconoce la limitacion metodologica que queda (mora real por segmento, composicion interna) — solo una vez, no la repitas. Cierra con una lectura que oriente el analisis.

Bullet 2 — ${ctx.entidadPropia} contra su historia y contra el grupo:
Donde esta su holgura hoy, como llego ahi (si hay historico), y donde queda en el ranking (#${posicionPropia} de ${entidades.length}) — pero solo si el ranking es significativo. Si hay mora real o ROE en el contexto, cruzalos: una holgura amplia con mora alta cuenta una historia distinta que una holgura justa con cartera limpia. Cierra con tu lectura.

Bullet 3 — el componente que mas pesa:
Cual renglon del PE carga mas en ${ctx.entidadPropia}, como se movio en RATIO, y que explica la dinamica. Nunca afirmes recorte de costos sin dato absoluto. Si hay columna Cartera en la tabla de tendencia puedes afirmar movimiento nominal. Compara con el grupo solo si tiene sentido. Cierra con una recomendacion contundente.

Bullet 4 — quien lidera por holgura y por que:
La entidad con mas aire sobre su PE, nombrala y describe de donde le viene el liderazgo: rendimiento agresivo, costos contenidos, o mix. Si la ventaja se explica razonablemente por diferencia de escala o modelo de negocio distinto a ${ctx.entidadPropia}, dilo y modera la aplicabilidad directa. Cierra con una lectura sobre que puede inspirar a tu entidad.

Bullet 5 — el rezagado y el resto del grupo:
Entidad con menor holgura y el driver del problema. Despues, menciona cada entidad del grupo que no haya salido todavia, con una linea util de contexto (su tipo regulatorio + lectura del perfil que permite el nombre o la cifra). Cierra con una lectura sobre la dinamica estructural del grupo — ej: "los de rendimiento alto pagan con costos altos; los eficientes operan en segmentos de bajo rendimiento".

Bullet 6 — prioridades para los proximos trimestres:
Dos o tres cosas que ${ctx.entidadPropia} debe hacer, armadas como narrativa (nunca "1) 2) 3)"). Se especifico: que proteger, que acelerar, que vigilar — con horizonte temporal razonable. Si tienes base para una prediccion condicional cuantitativa ("si la mora sube a X%, la holgura cae a Y"), dila. Cierra con una pregunta fuerte que el directorio deberia poder responder. NO cierres repitiendo las limitaciones metodologicas — eso ya fue en el Bullet 1.`;

    const user = `# Diagnostico Punto de Equilibrio — Cierre ${ctx.periodoLabel}

## CONTEXTO DEL UNIVERSO (leer PRIMERO — no es opcional)
Universo de comparacion: ${universoEtiqueta}
Tamaño del peer group: ${entidades.length} entidad(es)

Composicion del peer group:
${listaComposicion}

${avisoHeterogeneidad}

${avisoMuestra}

${avisoCoopac}

ENTIDAD PROPIA (paciente): ${ctx.entidadPropia}${tipoPorEntidad[ctx.entidadPropia] ? ` — ${prettyTipo(tipoPorEntidad[ctx.entidadPropia])}` : ""}
Grupo de referencia (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}
${posicionPropia != null ? `Posicion en ranking por holgura: #${posicionPropia} de ${entidades.length}` : ""}

## CUADRO COMPARATIVO — Descomposicion del rendimiento sobre cartera TTM
| Entidad                       | Rendim | Otros   | GastoFin| Provis  | GastosOp| PE(carga)| Holgura  |
|-------------------------------|--------|---------|---------|---------|---------|----------|----------|
${tabla}

Referencia del grupo (informativa; solo concluyente si es homogeneo y N>=3):
- Rendimiento promedio: ${fmt(promRend)}%
- Gastos Operacionales promedio: ${fmt(promGO)}%
- Margen antes de Impuestos promedio: ${fmt(promMargen)}%
- Holgura sobre PE promedio: ${fmtSigned(promMargenSeg)}pp
- Lider por holgura: ${mejor?.entidad ?? "—"} (${mejor ? fmtSigned(mejor.margenSeguridad) : "0.00"}pp)
- Mas rezagado por holgura: ${peor?.entidad ?? "—"} (${peor ? fmtSigned(peor.margenSeguridad) : "0.00"}pp)

${
  tablaTendencia
    ? `## TENDENCIA HISTORICA — ${ctx.entidadPropia} (ultimos ${tendenciaPropia.length} cierres)
| Periodo      | Rendim | GastoFin| Provis  | GastosOp| PE(carga)| Holgura  | Cartera        |
|--------------|--------|---------|---------|---------|----------|----------|----------------|
${tablaTendencia}
${tendenciaDiag ? `\nResumen de movimiento: ${tendenciaDiag}` : ""}

NOTA SOBRE LA TENDENCIA: Rendim/GastoFin/Provis/GastosOp/PE son RATIOS sobre cartera TTM. Un ratio puede caer porque bajo el monto absoluto del numerador O porque crecio mas rapido la cartera (denominador). ${montosPropia.length > 0 ? `La columna "Cartera" (MM S/) permite afirmar movimiento absoluto: si gastos_op/cartera bajo mientras cartera crecio, los gastos absolutos pueden haber subido en terminos nominales.` : `Sin dato de cartera absoluta, NO afirmes "recorto costos" ni "contrajo gastos" — solo puedes decir "el ratio mejoro X pp".`}
`
    : ""
}
## GLOSARIO (leer antes de interpretar):

- **PE (Punto de Equilibrio / carga total)** = suma absoluta de Otros + GastoFin + Provision + GastosOp. Es el rendimiento MINIMO que la cartera necesita para empatar los costos. **PE alto NO es malo por si solo** — es malo solo si la holgura es estrecha.
- **Margen antes de Impuestos** = Rendimiento − PE. Diferencia nominal entre lo que rinde la cartera y lo que cuesta operar.
- **Holgura sobre el PE** (METRICA PRINCIPAL DE ROBUSTEZ) = Rendimiento − PE, en puntos porcentuales. Es cuanto aire tiene la entidad entre lo que su cartera rinde y lo que cuesta operar. Si la holgura es +2pp, la entidad opera 2 puntos por encima de su punto muerto; si el rendimiento cae mas de 2 pp, entra en perdida operativa. **Siempre comparar por holgura, no por PE absoluto.** Ejemplo: entidad A con rendimiento 35% y PE 32% (holgura 3pp) tiene mas aire que entidad B con rendimiento 16% y PE 15% (holgura 1pp), aunque el PE de A sea mayor. En el output puedes llamarla **holgura**, **holgura sobre el PE**, **colchon operativo** o **aire sobre el PE** — son sinonimos. NO uses "margen de seguridad" (no es terminologia estandar peruana).
- **Rendimiento alto NO implica cartera de alto riesgo por si solo.** Puede ser mix consumo, pequeña empresa, microempresa, o combinacion. Sin dato de segmento dominante ni mora real, NO afirmes el perfil de riesgo.
- **Modelo de negocio COOPAC**:
  * COOPAC cerrada (socios = empleados de una institucion, cobro por planilla): cartera cautiva, mora estructuralmente baja, no comparable con mercado abierto.
  * COOPAC abierta al publico: compite en el mercado, mora comparable a CMAC/CRAC.
  * La data regulatoria NO distingue estos dos modelos — si tu analisis depende de ello, declara la limitacion.
- **Tendencia de la holgura**: si crece, la estructura esta saneando. Si se angosta, hay presion creciente. Pero "mejora del ratio" NO equivale a "recorte de monto absoluto".

## REGLA 0 — NO INVENTES CIFRAS NI HECHOS DUROS (NON-NEGOTIABLE):

Todas las CIFRAS (porcentajes, montos, pp, MM S/, ratios, mora, ROE) tienen que salir EXACTAS de las tablas de arriba. Nunca estimes, extrapoles, completes con tu "intuicion" ni inventes numeros que no estan. Si un dato CUANTITATIVO no esta en el contexto, no lo cites. Un analisis con cifras inventadas vale cero y pierde el contrato.

Lo mismo vale para hechos duros especificos de la entidad que no puedas inferir: no inventes año de fundacion, numero de sucursales, nombre del gerente, composicion accionaria, etc.

## CONTEXTO PROFESIONAL PERMITIDO (restringido — leer con atencion):

Un analista senior NO llega diciendo "no sabemos quien es esta entidad", pero TAMPOCO inventa contexto que no tiene base inequivoca. La linea es fina. Estas son las UNICAS inferencias permitidas:

- **Nombre INEQUIVOCAMENTE institucional:** solo si el nombre identifica sin ambiguedad una institucion publica o empresa especifica cuya COOPAC de trabajadores es de dominio publico (ej: COOSUNAT = trabajadores SUNAT; COOPMINSA = trabajadores MINSA; COOP FFAA = fuerzas armadas; COOP MAGISTERIAL = docentes). Ahi puedes afirmar modelo de vinculo cerrado por planilla con autoridad. Ejemplo valido: "COOSUNAT, por su membresia natural de trabajadores de SUNAT, opera un modelo de vinculo cerrado por planilla".

- **Patron de cifras:** rendimiento alto con provisiones muy bajas (ej: 35% + 0.60%) es consistente con cartera de cobro recurrente (consumo con descuento por planilla, o cartera muy controlada), NO con microempresa de alto riesgo. Dilo SIEMPRE como HIPOTESIS a validar con la gerencia, nunca como hecho: "el patron es consistente con cartera predominantemente de consumo controlado, hipotesis que el area de riesgos puede validar con el mix interno".

- **Nivel COOPAC SBS:** N1 son las mas pequeñas por tamaño de activos; N3 las mas grandes. Es dato duro, puedes nombrarlo como marco de escala.

**PROHIBIDO inferir desde nombres AMBIGUOS:**
- Nombres de santo (SAN BLAS, SANTA ROSA, SAN JUAN, SAN PEDRO, SAN MARTIN, etc.): aparecen en decenas de lugares distintos de Peru. NO afirmar geografia ni modelo de negocio desde el nombre. Simplemente no menciones origen/modelo si no tienes otra fuente — pasa directo al analisis de cifras.
- Nombres de ciudades o regiones genericas: solo si la referencia es tan especifica que no hay duda (ej: "COOPAC Chimbote" sugiere Chimbote-Ancash). Nombres con multiples ubicaciones NO.
- NUNCA digas "con nombre de barrio cusqueño", "parece ser de la region X", "sugiere alcance local" si no tienes evidencia inequivoca. Eso es extrapolar, no analizar.

La regla: cuando tengas duda, NO inventes contexto. El analisis se sostiene en las cifras — eso es suficiente para un trabajo serio.

HIPOTESIS PROFESIONAL = "el patron es consistente con X, hipotesis a validar con el area interna".
INVENCION = afirmar modelo/geografia/segmento sin evidencia inequivoca. La primera es valida; la segunda pierde el contrato.

Donde la limitacion es relevante y el dato no esta, escribela UNA VEZ al cierre del Bullet 1 como cierre profesional. No la repitas.

## REGLA DE RESPETO (NON-NEGOTIABLE):

El output va a ser leido por la gerencia de la entidad analizada Y potencialmente por los otros peers del grupo. Todas las entidades reciben tratamiento respetuoso. Cada una sirve a una poblacion y tiene su racionalidad. No somos jueces — somos analistas.

**PROHIBIDO:**
- Adjetivos despectivos en comparativas: "apenas", "solo", "nada mas", "tan solo", "ni siquiera" cuando una entidad sale peor en un numero. Ejemplo prohibido: "COOSUNAT apenas alcanza 0.91 pp". Correcto: "COOSUNAT registra 0.91 pp de holgura" o "la holgura de COOSUNAT se ubica en 0.91 pp".
- Lenguaje de juicio moral: "mala estrategia", "estructura ineficiente", "modelo inferior". Correcto: describir la cifra y su implicacion sin calificar la estrategia de otra entidad.
- Implicar que un modelo de negocio es "mejor" que otro. COOPAC cerrada y abierta sirven mercados distintos — una no es "superior". Un N3 no es "mejor" que un N1 — son escalas distintas.
- Lenguaje triunfalista para la propia entidad: "destaca por encima", "lider claro", "superior al resto". Correcto: afirmaciones cuantitativas sin triunfalismo.

Reconocer la racionalidad del otro cuando aplica: ej. una COOPAC cerrada tiene menor rendimiento pero tambien menor mora estructural — no es "peor" en rendimiento, es un modelo distinto.

## VOZ EDITORIAL — CALIDAD DE CLASE MUNDIAL

**Barra de calidad objetivo**: Harvard Business Review en español + columna economica de prensa peruana seria (Semana Economica, El Comercio opinion, Gestion por analista senior). El output va a ser leido por gerencia general, directores o dueños de entidad financiera / cooperativa. Tiene que ser **carnecita (sustancia densa y accionable), no hueso (estructura vacia que suena a consultor junior).** Cada bullet debe dejar al lector con una idea fuerte que puede repetir en su proxima reunion de directorio.

Modelo de analista: el que ha visto entidades subir y caer durante 20 años — opina, no cataloga; afirma con la cifra, no hedgea; respeta a todos los jugadores del mercado.

**VOZ CORRECTA — ejemplos:**
- "COOPAC SAN BLAS pinta un cuadro claro: hace dos años operaba en rojo, con un PE de 37.50% comiendose su rendimiento de 36.16%. Hoy respira con 2.55 pp de aire sobre su PE."
- "Los gastos operacionales son tu palanca y tu talon de Aquiles. 22.32% del rendimiento se los lleva ese renglon — tres veces lo que sostiene COOSUNAT."
- "Decir que recortaste costos seria una conclusion barata. El ratio bajo, si, pero puede ser porque la cartera crecio mas rapido que los gastos — y eso cuenta otra historia."
- "Antes de hablar de sostenibilidad del rendimiento, hace falta mora real por segmento. Sin ese dato, el 35.44% es solo una foto."

**VOZ INCORRECTA — lo que NO queremos:**
- "Esto significa que cada sol de cartera genera 2.55 centavos de colchon antes de perdida" [explicacion infantil al CFO]
- "Preguntas que NO se pueden responder con esta data: (i)... (ii)... (iii)..." [listicle academico]
- "Tres acciones inmediatas: (1)... (2)... (3)..." [consultoria de manual, sin opinion]
- "Tu margen de seguridad hoy es +2.55 puntos porcentuales" [PROHIBIDO decir "margen de seguridad"]
- "En conclusion, podria ser conveniente evaluar la posibilidad de..." [hedging vacio]
- "SAN BLAS, con nombre de barrio cusqueño, apunta a una base regional abierta al publico" [EXTRAPOLACION desde nombre ambiguo — hay San Blas en varios departamentos; nunca inferir geografia o modelo desde nombre de santo o toponimo comun]
- "COOSUNAT apenas alcanza 0.91 pp" [DESPECTIVO — correcto: "COOSUNAT registra 0.91 pp"]
- "la brecha refleja estructura operativa Y composicion de cartera" sin poder sustentar la composicion [afirmas dos drivers cuando solo tienes evidencia de uno]

**REGLAS DE VOZ:**
- Lidera con la afirmacion, no con el preambulo.
- Oraciones mixtas: cortas + largas, para ritmo. Prohibido bullet de una sola oracion larga sin pausa.
- Opinion clara. Nada de "podria ser", "quizas", "tal vez" en cascada. Un condicional por bullet maximo.
- Especificidad siempre con cifra exacta de la tabla.
- Expresiones peruanas de ambiente financiero — con mesura, no mas de 2 por bullet: "respirar", "al filo", "colchon estrecho", "aire sobre el PE", "soltar lastre", "cambiar el chip", "tocar fondo", "en rojo", "en terreno positivo", "comerse el rendimiento".
- PROHIBIDO "Esto significa que..." / "Es decir..." / "En otras palabras..." / "Cabe mencionar que..." — patronizante al CFO.
- PROHIBIDO sub-listas numeradas "(i)/(ii)/(iii)" o "1)/2)/3)" dentro de un bullet. Si tienes 3 ideas, tejelas como narrativa.
- PROHIBIDO "cada sol de cartera genera X centavos" u otras explicaciones "para dummies" del ratio al CFO.
- Longitud objetivo: 70-130 palabras por bullet. Mas largo = diluye.
- NO empieces bullets con una etiqueta en mayusculas tipo "ENCUADRE DEL ANALISIS:" — eso es nomenclatura de borrador. Empieza con la afirmacion directa.

## ESTRUCTURA DE ${bulletsCount} BULLETS:

${bulletsExplicacion}

## REGLAS DE CONTENIDO:

1. **No inventes** (ver REGLA 0 arriba). Solo cifras de las tablas.
2. **Compara por holgura, no por PE absoluto**: una entidad con rendimiento 35% y PE 32% (holgura 3pp) esta mejor que una con rendimiento 16% y PE 15% (holgura 1pp), aunque el PE de la primera sea mayor.
3. **NO digas "margen de seguridad"** — usa "holgura", "holgura sobre el PE", "colchon operativo" o "aire sobre el PE".
4. **No infieras recorte de costos desde variacion de ratio solo.** Si solo tienes ratios, di "el ratio mejoro X pp". Si tienes la columna Cartera en la tendencia, puedes cruzar: "mientras la cartera pasaba de X MM a Y MM, el ratio de gastos bajo Z pp".
5. **No afirmes perfil de riesgo de cartera desde rendimiento solo** — sin mix por segmento ni mora real, no hay perfil.
6. **No compares modelos opuestos sin advertirlo** (COOPAC cerrada vs abierta, COOPAC vs banco, corporativo vs consumo).
7. ${entidades.length <= 2 ? `Con ${entidades.length} entidad(es), NO uses "promedio del grupo", "mediana", "lider sectorial" como estadistica — son observaciones puntuales. Nombra a las entidades por nombre.` : `Con grupo pequeño (3-5 entidades), moderar lenguaje estadistico: "promedio" si, "mediana" o "percentil" no sin explicar.`}
8. **Menciona todas las entidades del grupo** en algun bullet, con contexto util (no relleno).
9. **Castellano peruano** (tu/tienes/puedes/estas). SIN voseo argentino (nada de vos/tenes/podes/moderá/decila).
10. **Preserva siempre la ñ**: campaña, año, señal, diseño, pequeña, acompañar.
11. **Sin emojis.** Es analisis financiero serio, no post de redes. Si necesitas resaltar, usa negrita (**palabras clave**) con mesura — 1-2 negritas por bullet maximo.
12. **No menciones clasificadoras de riesgo, revistas, periodicos ni marcas de terceros.**
13. **No uses jerga sin explicar**: "cuadrante", "peer group", "mediana", "outlier", "delta", "YoY", "spread" solo.

Output: JSON array de ${bulletsCount} bullets (cada bullet es un string). Nada mas — sin markdown fences, sin \`\`\`json, sin comentarios previos ni posteriores.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
