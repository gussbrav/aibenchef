/**
 * Prompt template para "Doctor Financiero — Punto de Equilibrio" v5.
 *
 * Correcciones sobre v4:
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
  version: "v5",
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
        ? `Bullet 1 — encuadre antes de la opinion:
Abre con un diagnostico del benchmark: que universo se compara, cuantas entidades, si la comparacion es solida o indicativa. Nombralas. Si el grupo es heterogeneo (COOPAC cerrada vs abierta, COOPAC vs SF, niveles distintos), dilo sin eufemismos. Lo que la data NO permite cerrar (mora real por segmento, mix de cartera, modelo de negocio) va tejido en el flujo, no como listicle. El bullet cierra con una afirmacion que oriente la lectura de los siguientes — no con la etiqueta "Encuadre:".

Bullet 2 — ${ctx.entidadPropia} contra si misma:
Donde esta su holgura hoy y como llego ahi. Si tiene historico: de donde viene (hace X meses estaba en Y pp), que movio la aguja (rendimiento, PE, o ambos). Si la holgura actual es estrecha, dilo. Si el grupo es homogeneo y util, puedes compararla con el otro; si no, evalua la entidad contra su propia trayectoria. Cierra con tu lectura — no con el tag "Diagnostico:".

Bullet 3 — el componente que mas pesa:
Identificar cual renglon del PE carga mas a ${ctx.entidadPropia} (Gastos Op, Gasto Financiero, o Provisiones) y como se movio en RATIO. CRITICO: no digas "redujo costos" ni "contrajo gastos" sin dato de monto absoluto. Si hay columna Cartera en la tabla de tendencia puedes afirmar que la cartera crecio X MM mientras el ratio bajo Y pp — y de ahi sacar conclusion. Sin eso, solo "el ratio mejoro X pp". Terminas con una recomendacion contundente — una, no tres — sin el tag "Prescripcion:".

Bullet 4 — prioridades + lo que falta para un diagnostico completo:
Dos o tres cosas que ${ctx.entidadPropia} debe hacer en los proximos trimestres, armadas como narrativa (no como lista "1) 2) 3)"). Despues, lo que no puedes diagnosticar con esta muestra: sin mora real no se sabe si el rendimiento es sostenible; sin composicion de cartera no se sabe el perfil de riesgo; en COOPAC, sin distinguir cerrada/abierta la comparacion queda renga. Si es util, cierra con una pregunta retadora que el directorio deberia poder responder.`
        : `Bullet 1 — encuadre antes de la opinion:
Abre diciendo que universo mirar (solo COOPAC / solo SF / mixto), el tamaño del peer group, y si la composicion es homogenea o heterogenea. Si hay N≥3 del mismo tipo puedes hablar de promedios y comparaciones; si hay mezcla declaralo y modera. Mencionar las limitaciones (mora real, mix de cartera, modelo de negocio) tejidas en el flujo, no como listicle. Cierra con una afirmacion que fije la lectura — no con el tag "Encuadre:".

Bullet 2 — ${ctx.entidadPropia} contra su historia y contra el grupo:
Donde esta su holgura hoy, como llego ahi (si hay historico), y donde queda en el ranking (#${posicionPropia} de ${entidades.length}) — pero solo si el ranking es significativo. Si hay mora real o ROE en el contexto, cruzalos: una holgura amplia con mora alta cuenta una historia distinta que una holgura justa con cartera limpia. Cierra con tu lectura.

Bullet 3 — el componente que mas pesa:
Cual renglon del PE carga mas en ${ctx.entidadPropia}, como se movio en RATIO, y que explica la dinamica. Nunca afirmes recorte de costos sin dato absoluto. Si hay columna Cartera en la tabla de tendencia puedes afirmar movimiento nominal. Compara con el grupo solo si tiene sentido. Cierra con una recomendacion contundente.

Bullet 4 — quien lidera por holgura y por que:
La entidad con mas aire sobre su PE, nombrala y describi de donde le viene el liderazgo: rendimiento agresivo, costos contenidos, o mix. Si el grupo es heterogeneo, aclara que el liderazgo puede no ser replicable a ${ctx.entidadPropia}. Cierra con una lectura sobre que puede inspirar a tu entidad — no con el tag "Oportunidad:".

Bullet 5 — el rezagado y el resto del grupo:
Entidad con menor holgura y el driver del problema. Despues, menciona cada entidad del grupo que no haya salido todavia, con una linea util de contexto (su tipo, su posicion en el eje rendimiento/eficiencia). Cierra con una lectura sobre la dinamica estructural del grupo — ej: "los de rendimiento alto pagan con costos altos; los eficientes operan en segmentos de bajo rendimiento".

Bullet 6 — prioridades + lo que falta:
Dos o tres acciones concretas para ${ctx.entidadPropia}, armadas como narrativa (no "1) 2) 3)"). Despues, lo que no se puede diagnosticar aun: mora real, composicion de cartera, modelo COOPAC cerrada/abierta, ratio de capital. Si tienes base para una prediccion condicional cuantitativa ("si la mora sube a X%, la holgura cae a Y"), dila. Si no, no la inventes.`;

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

## REGLA 0 — NO INVENTES NADA (NON-NEGOTIABLE):

Todas las cifras que usas tienen que salir EXACTAS de las tablas de arriba. No estimes, no extrapoles, no completes con tu "intuicion", no inventes montos ni mora ni ROE si no estan en el contexto. Si un dato no esta, NO lo mencionas — o lo mencionas explicitamente como "no disponible". Un analisis con cifras inventadas vale cero y pierde el contrato. Antes de escribir cada numero, volve a la tabla y confirma. Si no esta, cambia de angulo.

## VOZ EDITORIAL — ¿COMO SE ESCRIBE?

Tu modelo es el analista economico de prensa peruana seria (Semana Economica, El Comercio opinion, Gestion columnas de analistas con 20 años viendo entidades subir y caer). No eres consultor de manual, no eres estudiante de MBA, no eres chatbot. Afirmas, no catalogas. Opinion clara, especificidad cuantitativa, honestidad sobre lo que no sabes.

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
