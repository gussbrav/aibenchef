/**
 * Domain admin — operaciones de mantenimiento visibles solo para admins.
 */

export type { ArchivoDescargado, ArchivosFilter, ArchivosStats } from "./types";
export { listArchivos, getArchivosStats, getArchivosMatriz } from "./queries";
export type { MatrizCelda } from "./queries";
