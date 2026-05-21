/**
 * Tipos publicos del domain admin.
 */

export interface ArchivoDescargado {
  id: string;
  grupo: string;
  topico: string;
  periodo: number;
  anio: number;
  mes: number;
  nombreArchivo: string;
  pathLocal: string;
  sourceUrl: string;
  tamanioBytes: number;
  md5Hash: string | null;
  formato: string | null;
  status: "descargado" | "procesando" | "procesado" | "error" | "omitido";
  filasInsertadas: number | null;
  errorMensaje: string | null;
  procesadoEn: string | null;
  descargadoEn: string;
  actualizadoEn: string;
}

export interface ArchivosFilter {
  grupo?: string;
  topico?: string;
  status?: string;
  anio?: number;
  limit?: number;
  offset?: number;
}

export interface ArchivosStats {
  total: number;
  porStatus: Record<string, number>;
  porGrupo: Record<string, number>;
  porTopico: Record<string, number>;
  totalBytes: number;
  periodoMin: number | null;
  periodoMax: number | null;
}
