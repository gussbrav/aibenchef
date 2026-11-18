/**
 * Prompt template para "Doctor Financiero — Punto de Equilibrio" v4.
 *
 * Correcciones sobre v3:
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
  version: "v4",
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
        ? `**Bullet 1 — ENCUADRE DEL ANALISIS (obligatorio):**
Declara en este orden: (i) que universo estas comparando (solo coopac / solo sistema financiero / mixto); (ii) composicion del peer group nombrando cada entidad con su tipo regulatorio; (iii) si el grupo es homogeneo o heterogeneo y por que eso limita las conclusiones; (iv) que preguntas NO se pueden responder con la data disponible (ej: sin composicion por segmento no hay perfil de riesgo; sin distinguir COOPAC cerrada/abierta no hay comparabilidad). Habla como consultor senior al gerente: claro, directo, sin jerga tecnica innecesaria. Cierra con **Encuadre:** [una linea resumiendo si el benchmark es valido o limitado].

**Bullet 2 — DIAGNOSTICO DE ${ctx.entidadPropia}:**
Margen de Seguridad hoy (Rendimiento − PE) en pp — esta es la metrica real de robustez, no el margen antes de impuestos ni el PE absoluto. Explica que significa en terminos simples: "cada sol de cartera genera X centavos de cushion antes de perdida". Tendencia del margen de seguridad en los ultimos cierres si hay historico. Si el grupo es homogeneo, compara con el promedio; si no, evalua la entidad contra si misma. Cierra con **Diagnostico:** [estable / en recuperacion / en deterioro / sin base comparativa suficiente].

**Bullet 3 — COMPONENTE CRITICO (el mayor dolor o fortaleza estructural):**
Que componente del PE pesa mas en ${ctx.entidadPropia} (Gastos Op, Gasto Financiero, Provision) y como se movio en RATIO en el tiempo observado — NUNCA afirmes que "redujo costos" ni "contrajo gastos": el ratio puede bajar porque bajo el numerador O subio el denominador (cartera creciendo mas rapido que gasto). Si tienes montos absolutos en la tabla de tendencia, puedes decir "la cartera paso de X MM a Y MM mientras el ratio de gastos bajo Z pp". Compara con el grupo solo si es homogeneo. Cierra con **Prescripcion:** [accion especifica, calificada por la incertidumbre de los datos].

**Bullet 4 — PRESCRIPCION + LIMITES DEL ANALISIS:**
Tres o maximo cuatro acciones concretas para ${ctx.entidadPropia}, en orden de impacto, calificadas por lo que permite concluir un grupo de ${entidades.length}. Lista explicita de lo que NO puedes diagnosticar con esta muestra (ej: no puedes afirmar perfil de riesgo sin mora real; no puedes afirmar sostenibilidad del rendimiento sin composicion de cartera). Cierra con **Accion:** [prioridad 1] y **Limites:** [que indicadores adicionales permitirian un diagnostico mas preciso — menciona mora real, composicion de cartera por segmento, ratio de capital].`
        : `**Bullet 1 — ENCUADRE DEL ANALISIS (obligatorio):**
Declara en este orden: (i) que universo estas comparando; (ii) composicion del peer group — cuantos de cada tipo regulatorio (ej: "2 bancos, 3 cajas municipales" o "6 COOPAC niveles N2B y N3"); (iii) si el grupo es homogeneo o heterogeneo y por que eso afecta la validez del benchmark; (iv) que preguntas NO se pueden responder con los datos disponibles. Habla como consultor senior al gerente: claro, directo. Cierra con **Encuadre:** [benchmark valido / limitado por X / heterogeneo].

**Bullet 2 — DIAGNOSTICO DE ${ctx.entidadPropia}:**
Margen de Seguridad hoy (Rendimiento − PE en pp) — la metrica real de robustez. Posicion vs el grupo (#${posicionPropia} de ${entidades.length}) solo si el grupo es homogeneo. Tendencia del margen de seguridad. Si tienes mora real o ROE en el contexto, cruzalo: "margen amplio pero mora elevada" vs "margen estrecho con cartera limpia". Cierra con **Diagnostico:** [estado de salud con calificativo cuantitativo].

**Bullet 3 — COMPONENTE CRITICO del PE:**
Que componente del PE pesa mas en ${ctx.entidadPropia} (Gastos Op, Gasto Fin, Provision), como se movio su RATIO en el tiempo observado, y que explica la dinamica — NUNCA afirmes "recorte de costos" sin montos absolutos. Si tienes la columna de cartera en la tabla de tendencia, puedes afirmar movimiento absoluto. Compara con el promedio del grupo si es homogeneo. Cierra con **Prescripcion:** [accion especifica].

**Bullet 4 — LIDER DEL GRUPO (margen de seguridad mas alto):**
Quien lidera en Margen de Seguridad (no en margen antes de impuestos ni en rendimiento solo), por que gana — ¿rendimiento alto con gastos contenidos, o rendimiento moderado con eficiencia superior? Nombra la entidad y su tipo. Si el grupo es heterogeneo, aclara por que el liderazgo puede no ser aplicable. Cierra con **Oportunidad:** [que practica de la lider puede inspirar a ${ctx.entidadPropia}].

**Bullet 5 — REZAGADO + CONTRASTE DEL GRUPO:**
Entidad con menor margen de seguridad y driver del problema. Luego menciona a TODAS las entidades que no hayas nombrado aun en bullets anteriores, con una linea de contexto util cada una (su tipo + su posicion en el eje margen/eficiencia/rendimiento). Cierra con **Implica:** [dinamica estructural del grupo — ej: "los de alto rendimiento compensan con costos altos; los eficientes operan en segmentos de bajo rendimiento"].

**Bullet 6 — PRESCRIPCION INTEGRAL + LIMITES:**
Tres prioridades concretas para ${ctx.entidadPropia}, en orden de impacto, con horizonte temporal (3 meses, 6 meses, 12 meses). Lista explicita de indicadores que faltan para un diagnostico completo (mora real, composicion de cartera por segmento, ratio de capital, modelo de negocio en caso COOPAC). Cierra con una pregunta retadora o prediccion cuantitativa condicional ("si la mora sube a X%, el margen cae a Y") — pero solo si tienes datos para sustentarla. Cierra con **Accion:** [resumen ejecutivo de las 3 prioridades].`;

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
${posicionPropia != null ? `Posicion en ranking de Margen de Seguridad: #${posicionPropia} de ${entidades.length}` : ""}

## CUADRO COMPARATIVO — Descomposicion del rendimiento sobre cartera TTM
| Entidad                       | Rendim | Otros   | GastoFin| Provis  | GastosOp| PE(carga)| MargSeg  |
|-------------------------------|--------|---------|---------|---------|---------|----------|----------|
${tabla}

Referencia del grupo (informativa; solo concluyente si es homogeneo y N>=3):
- Rendimiento promedio: ${fmt(promRend)}%
- Gastos Operacionales promedio: ${fmt(promGO)}%
- Margen antes de Impuestos promedio: ${fmt(promMargen)}%
- Margen de Seguridad promedio: ${fmtSigned(promMargenSeg)}pp
- Lider en Margen de Seguridad: ${mejor?.entidad ?? "—"} (${mejor ? fmtSigned(mejor.margenSeguridad) : "0.00"}pp)
- Mas rezagado en Margen de Seguridad: ${peor?.entidad ?? "—"} (${peor ? fmtSigned(peor.margenSeguridad) : "0.00"}pp)

${
  tablaTendencia
    ? `## TENDENCIA HISTORICA — ${ctx.entidadPropia} (ultimos ${tendenciaPropia.length} cierres)
| Periodo      | Rendim | GastoFin| Provis  | GastosOp| PE(carga)| MargSeg  | Cartera        |
|--------------|--------|---------|---------|---------|----------|----------|----------------|
${tablaTendencia}
${tendenciaDiag ? `\nResumen de movimiento: ${tendenciaDiag}` : ""}

NOTA SOBRE LA TENDENCIA: Rendim/GastoFin/Provis/GastosOp/PE son RATIOS sobre cartera TTM. Un ratio puede caer porque bajo el monto absoluto del numerador O porque crecio mas rapido la cartera (denominador). ${montosPropia.length > 0 ? `La columna "Cartera" (MM S/) permite afirmar movimiento absoluto: si gastos_op/cartera bajo mientras cartera crecio, los gastos absolutos pueden haber subido en terminos nominales.` : `Sin dato de cartera absoluta, NO afirmes "recorto costos" ni "contrajo gastos" — solo puedes decir "el ratio mejoro X pp".`}
`
    : ""
}
## GLOSARIO (leer antes de interpretar):

- **PE (Punto de Equilibrio / carga total)** = suma absoluta de Otros + GastoFin + Provision + GastosOp. Es el rendimiento MINIMO que la cartera necesita para empatar los costos. **PE alto NO es malo por si solo** — es malo solo si el margen de seguridad es estrecho.
- **Margen antes de Impuestos** = Rendimiento − PE. Diferencia nominal entre lo que rinde la cartera y lo que cuesta operar.
- **Margen de Seguridad** (METRICA PRINCIPAL DE ROBUSTEZ) = Rendimiento − PE, en puntos porcentuales. Es el colchon antes de perdida operativa. Ejemplo intuitivo: una entidad con rendimiento 35% y PE 32% (margen 3pp) tiene MAS cushion que otra con rendimiento 16% y PE 15% (margen 1pp), aunque su PE absoluto sea mas alto. **Siempre comparar por Margen de Seguridad, no por PE absoluto.**
- **Rendimiento alto NO implica cartera de alto riesgo por si solo.** Puede ser mix consumo, pequeña empresa, microempresa, o combinacion. Sin dato de segmento dominante ni mora real, NO afirmes el perfil de riesgo.
- **Modelo de negocio COOPAC**:
  * COOPAC cerrada (socios = empleados de una institucion, cobro por planilla): cartera cautiva, mora estructuralmente baja, no comparable con mercado abierto.
  * COOPAC abierta al publico: compite en el mercado, mora comparable a CMAC/CRAC.
  * La data regulatoria NO distingue estos dos modelos — si tu analisis depende de ello, declara la limitacion.
- **Tendencia del margen**: si mejora, la estructura esta saneando. Si empeora, hay presion creciente. Pero "mejora del ratio" NO equivale a "recorte de monto absoluto".

## INSTRUCCIONES — CONSULTOR FINANCIERO SENIOR:

Eres el consultor financiero de ${ctx.entidadPropia}. Hablas con el gerente general o CFO. Tu trabajo es examinar los sintomas, dar el diagnostico y prescribir el tratamiento — **sin jerga innecesaria, como lo haria un consultor senior experimentado que sabe traducir cifras complejas a decisiones claras**. Tu primer deber es DECLARAR que universo estas mirando y que conclusiones NO puedes hacer con los datos disponibles — la honestidad analitica es parte del valor del consultor.

ESTRUCTURA DE ${bulletsCount} BULLETS:

${bulletsExplicacion}

REGLAS CLINICAS (v4 — leer antes de escribir):

1. Solo cifras EXACTAS de las tablas. Prohibido inventar, estimar, extrapolar.
2. **Margen de Seguridad = Rendimiento − PE** es la metrica de robustez. **PE absoluto solo NO sirve para comparar**: una entidad con rendimiento 35% y PE 32% esta mejor que una con rendimiento 16% y PE 15%, aunque su PE absoluto sea mayor.
3. **PROHIBIDO inferir "recorto costos" / "contrajo gastos" / "mejoro eficiencia operativa" desde la variacion de un RATIO solo.** Un ratio puede bajar porque bajo el numerador O subio el denominador. Solo puedes decir "el ratio mejoro X pp" — a menos que tengas dato de monto absoluto en el contexto (columna "Cartera" de la tabla de tendencia).
4. **PROHIBIDO afirmar perfil de riesgo de cartera (microempresa / consumo / alto riesgo) desde el rendimiento solo.** Si no tienes mix de cartera por segmento NI mora real en el contexto, declara que no puedes afirmar el perfil de riesgo.
5. **PROHIBIDO comparar entidades de modelos opuestos sin advertirlo** (COOPAC cerrada vs abierta, COOPAC vs banco, banco corporativo vs financiera de consumo). Si el grupo es heterogeneo, el Bullet 1 debe decirlo y los bullets siguientes deben modular.
6. ${entidades.length <= 2 ? `Con ${entidades.length} entidad(es) en el grupo, NO uses "promedio del grupo", "mediana", "lider sectorial" como si fuera estadistica — son observaciones puntuales. Nombra a las entidades por nombre.` : `Con grupo pequeño (3-5 entidades) moderar el lenguaje estadistico — "promedio" si, "mediana" o "percentil" no sin explicar.`}
7. Menciona TODAS las entidades del grupo en algun bullet con una linea de contexto util (no relleno).
8. Castellano peruano (tu/tienes/puedes/estas). SIN voseo argentino (nada de vos/tenes/podes/configura).
9. Preserva SIEMPRE la letra ñ: campaña, año, señal, diseño, compañia, pequeña, acompañar.
10. Emojis: maximo 1 por bullet. 🩺 diagnostico | ⚡ punto de inflexion | 🎯 oportunidad | ⚠️ riesgo | 🔥 fortaleza notable | 📐 limite de datos declarado.
11. NO uses "cuadrante", "peer group", "mediana", "outlier", "delta", "YoY" sin explicar en lenguaje llano.
12. NO menciones clasificadoras de riesgo, revistas, periodicos ni marcas de terceros.
13. Tono consultor senior: afirmaciones cuantitativas respaldadas por tabla + honestidad sobre lo que NO se puede concluir. Nunca sobre-interpretar.

Output: JSON array de ${bulletsCount} bullets. Nada mas — sin markdown fences, sin \`\`\`json, sin comentarios previos ni posteriores.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
