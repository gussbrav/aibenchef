/**
 * Domain: maestra de entidades financieras.
 *
 * Encapsula operaciones sobre dw.entidad_maestra + dw.entidad_nombre.
 * Uso comun: cuando el pipeline detecta una entidad nueva en el .xls SBS
 * (por conversion regulatoria o rebranding), el admin la registra desde
 * la UI en /dashboard/admin/renombres y esta funcion hace la insercion
 * transaccional en las dos tablas + opcional baja de la entidad
 * reemplazada.
 */

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/domains/shared";

export type TipoEntidad =
  | "BANCOS"
  | "FINANCIERAS"
  | "CMAC"
  | "CRAC"
  | "EDPYMES"
  | "BANCO_NACION"
  | "OTRO";

const TIPOS_VALIDOS: TipoEntidad[] = [
  "BANCOS",
  "FINANCIERAS",
  "CMAC",
  "CRAC",
  "EDPYMES",
  "BANCO_NACION",
  "OTRO",
];

export type CreateEntidadInput = {
  nombreCanonico: string;
  razonSocial?: string | null;
  tipoEntidad: TipoEntidad;
  /**
   * Si SBS trae la entidad con un nombre distinto al canonico (ej. en
   * MAYUSCULAS o con asterisco), se registra tambien como 'raw_sbs' para
   * que el pipeline lo mapee automaticamente en el proximo refresh.
   */
  nombreRawSbs?: string | null;
  esMicrofinanciera?: boolean;
  codigoSbs?: string | null;
  notas?: string | null;
  /**
   * Si viene, se marca la entidad indicada como con fecha de baja +
   * activa=false, y se agrega nota de conversion en ambas. Ideal para
   * casos como 'Financiera Efectiva -> Banco Efectiva' donde la nueva
   * REEMPLAZA a la vieja.
   */
  reemplazaEntidadId?: number | null;
  /** YYYY-MM-DD — fecha en que la vieja dejo de existir. Requerida si reemplazaEntidadId viene. */
  fechaBajaReemplaza?: string | null;
};

export type EntidadResumen = {
  id: number;
  nombreCanonico: string;
  tipoEntidad: TipoEntidad;
  activa: boolean;
};

export async function listEntidades(): Promise<EntidadResumen[]> {
  const rows = await db.execute<{
    id: number;
    nomb_correg_canonico: string;
    tipo_entidad_actual: TipoEntidad;
    activa: boolean;
  }>(sql`
    SELECT id, nomb_correg_canonico, tipo_entidad_actual, activa
    FROM dw.entidad_maestra
    ORDER BY tipo_entidad_actual, nomb_correg_canonico
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    nombreCanonico: String(r.nomb_correg_canonico),
    tipoEntidad: r.tipo_entidad_actual,
    activa: Boolean(r.activa),
  }));
}

export async function createEntidad(
  actor: { email: string },
  input: CreateEntidadInput,
): Promise<{ id: number; nombreCanonico: string; reemplazaId: number | null }> {
  // Validaciones basicas
  const nombre = input.nombreCanonico.trim();
  if (!nombre) throw new ValidationError("nombreCanonico requerido", {});
  if (nombre.length > 200) throw new ValidationError("nombreCanonico muy largo", {});
  if (!TIPOS_VALIDOS.includes(input.tipoEntidad)) {
    throw new ValidationError(
      `tipoEntidad invalido. Validos: ${TIPOS_VALIDOS.join(", ")}`,
      { got: input.tipoEntidad },
    );
  }
  if (input.reemplazaEntidadId && !input.fechaBajaReemplaza) {
    throw new ValidationError(
      "Si reemplaza a otra entidad, fechaBajaReemplaza es requerida (YYYY-MM-DD)",
      {},
    );
  }
  if (input.fechaBajaReemplaza && !/^\d{4}-\d{2}-\d{2}$/.test(input.fechaBajaReemplaza)) {
    throw new ValidationError(
      "fechaBajaReemplaza debe ser YYYY-MM-DD",
      { got: input.fechaBajaReemplaza },
    );
  }

  // Chequeo de duplicado (case-insensitive) — el UNIQUE de la tabla
  // ya cubre pero queremos error claro antes de INSERT.
  const dup = await db.execute<{ id: number }>(sql`
    SELECT id FROM dw.entidad_maestra WHERE LOWER(nomb_correg_canonico) = LOWER(${nombre}) LIMIT 1
  `);
  if (dup.length > 0) {
    throw new ConflictError(`Ya existe una entidad con el nombre canonico '${nombre}'`, {});
  }

  // Validar que la entidad a reemplazar existe (si viene)
  let reemplazaData: { nombre: string } | null = null;
  if (input.reemplazaEntidadId) {
    const r = await db.execute<{ nomb_correg_canonico: string }>(sql`
      SELECT nomb_correg_canonico FROM dw.entidad_maestra WHERE id = ${input.reemplazaEntidadId}
    `);
    if (r.length === 0) {
      throw new NotFoundError(
        `Entidad a reemplazar id=${input.reemplazaEntidadId} no existe`,
        {},
      );
    }
    reemplazaData = { nombre: r[0]!.nomb_correg_canonico };
  }

  const razonSocial = input.razonSocial?.trim() || null;
  const nombreRawSbs = input.nombreRawSbs?.trim() || null;
  const notas = input.notas?.trim() || null;
  const codigoSbs = input.codigoSbs?.trim() || null;
  const esMicro = input.esMicrofinanciera ?? false;

  // Nota autogenerada + notas del usuario
  const notasFinales = [
    notas,
    reemplazaData
      ? `Reemplaza a "${reemplazaData.nombre}" (id=${input.reemplazaEntidadId}) por conversion regulatoria en ${input.fechaBajaReemplaza}.`
      : null,
    `Alta manual desde UI por ${actor.email} el ${new Date().toISOString().slice(0, 10)}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const fuenteAlta = `alta manual UI por ${actor.email}`;

  // Transaccion: 1 INSERT maestra + 1-2 INSERT nombre + 1 UPDATE opcional
  return await db.transaction(async (tx) => {
    const insertResult = await tx.execute<{ id: number }>(sql`
      INSERT INTO dw.entidad_maestra (
        nomb_correg_canonico, razon_social_actual, tipo_entidad_actual,
        codigo_sbs, es_microfinanciera, activa, notas
      ) VALUES (
        ${nombre}, ${razonSocial}, ${input.tipoEntidad},
        ${codigoSbs}, ${esMicro}, TRUE, ${notasFinales}
      )
      RETURNING id
    `);
    const id = Number(insertResult[0]!.id);

    // Nombre canonico
    await tx.execute(sql`
      INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
      VALUES (${id}, ${nombre}, 'canonico', TRUE, ${fuenteAlta})
    `);

    // Nombre raw SBS (si se especifica y difiere del canonico)
    if (nombreRawSbs && nombreRawSbs.toLowerCase() !== nombre.toLowerCase()) {
      await tx.execute(sql`
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (${id}, ${nombreRawSbs}, 'raw_sbs', TRUE, ${fuenteAlta})
      `);
    }

    // Marcar la vieja como con fecha de baja (si aplica)
    if (input.reemplazaEntidadId && input.fechaBajaReemplaza) {
      await tx.execute(sql`
        UPDATE dw.entidad_maestra
        SET fecha_baja = ${input.fechaBajaReemplaza}::date,
            activa = FALSE,
            notas = COALESCE(notas || E'\n', '') ||
                    ${`Reemplazada por "${nombre}" (id=${id}) el ${input.fechaBajaReemplaza}. Data historica preservada.`},
            updated_at = now()
        WHERE id = ${input.reemplazaEntidadId}
      `);
    }

    return {
      id,
      nombreCanonico: nombre,
      reemplazaId: input.reemplazaEntidadId ?? null,
    };
  });
}
