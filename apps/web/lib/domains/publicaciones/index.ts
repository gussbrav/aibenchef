// IMPORTANTE — este barrel re-exporta service.ts que tiene "server-only".
// Los client components NO deben importar desde este barrel; deben usar
// paths especificos client-safe: `./meta`, `./types`.
// Server components y API routes pueden usar este barrel sin problema.
export {
  generatePublicacion,
  listPublicaciones,
  getPublicacion,
  updatePublicacion,
  archivePublicacion,
  PublicacionesError,
} from "./service";
export { PUBLICACION_TEMAS_META } from "./meta";
export type {
  Publicacion,
  PublicacionListItem,
  PublicacionStatus,
  PublicacionTema,
  GeneratePublicacionInput,
} from "./types";
export { PUBLICACION_TEMAS, PUBLICACION_STATUS } from "./types";
