/**
 * Types del dominio publicaciones — articulos long-form para LinkedIn.
 *
 * Introducido por V154 — genera articulos con Claude Haiku basados en la
 * data actual del cliente + periodo, con 4 temas iniciales (benchmarking,
 * coyuntura macro, DuPont, evolucion PE). Cada draft es propiedad del
 * usuario que lo crea (workflow: draft -> reviewed -> published).
 */

export type PublicacionTema =
  | "benchmarking_sectorial"
  | "calidad_cartera"
  | "coyuntura_macro"
  | "dupont_rentabilidad"
  | "evolucion_pe_segmento"
  | "mora_visual"
  | "rentabilidad_visual";

export const PUBLICACION_TEMAS: PublicacionTema[] = [
  "benchmarking_sectorial",
  "calidad_cartera",
  "coyuntura_macro",
  "dupont_rentabilidad",
  "evolucion_pe_segmento",
  "mora_visual",
  "rentabilidad_visual",
];

/**
 * Chart SVG embebido en el articulo. El markdown incluye placeholder
 * `[[CHART:${id}]]` que la UI reemplaza al renderizar. Persistido en
 * admin.publicaciones.charts (JSONB, V164).
 */
export type PublicacionChart = {
  id: string;
  tipo: "line" | "bar";
  titulo: string;
  subtitulo: string;
  /** SVG completo listo para embed (incluye viewBox, styles inline). */
  svg: string;
  /** Descripcion textual del chart para accesibilidad y SEO. */
  altText: string;
};

export type PublicacionStatus = "draft" | "reviewed" | "published" | "archived";

export const PUBLICACION_STATUS: PublicacionStatus[] = [
  "draft",
  "reviewed",
  "published",
  "archived",
];

export type Publicacion = {
  id: string;
  tema: PublicacionTema;
  titulo: string;
  contenidoMd: string;
  hashtags: string[];
  /** Charts SVG embebidos. Vacio si el articulo es solo texto. */
  charts: PublicacionChart[];
  clienteSlug: string | null;
  periodo: number;
  entidadPropia: string;
  peerGroup: string[];
  model: string;
  promptVersion: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number | null;
  status: PublicacionStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdBy: string;
  publishedBy: string | null;
};

/** Resumen para la lista (menos campos, no expone contenido completo). */
export type PublicacionListItem = {
  id: string;
  tema: PublicacionTema;
  titulo: string;
  periodo: number;
  entidadPropia: string;
  clienteSlug: string | null;
  status: PublicacionStatus;
  updatedAt: string;
  createdAt: string;
  publishedAt: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
};

/**
 * Input al service de generacion. El contexto se pasa como JSON grounded
 * — el prompt template lo formatea como tabla legible para el LLM.
 */
export type GeneratePublicacionInput = {
  tema: PublicacionTema;
  clienteSlug: string;
  entidadPropia: string;
  peerGroup: string[];
  periodo: number;
  /** Data especifica del tema (ver prompts/*.ts para shape esperado). */
  contexto: Record<string, unknown>;
  /**
   * Charts pre-generados (SVG server-side) que se persisten con la
   * publicacion. Los ids referenciados en `contenidoMd` como
   * `[[CHART:${id}]]` se resuelven contra este array al renderizar.
   * Cero charts = articulo solo-texto (backward compatible).
   */
  charts?: PublicacionChart[];
};

/**
 * Payload interno pasado a los prompt templates.
 */
export type PublicacionPromptContext = GeneratePublicacionInput & {
  periodoLabel: string;
};

/** Resultado del LLM parseado. */
export type GeneratedPublicacion = {
  titulo: string;
  contenidoMd: string;
  hashtags: string[];
};

/** Metadata + contenido para persistir. */
export type GeneratePublicacionResult = {
  publicacion: Publicacion;
  fromCache: false; // Publicaciones nunca vienen de cache (cada draft es unico).
};
