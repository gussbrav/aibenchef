/**
 * GET    /api/v1/governance/tags          — lista con filtros (autenticado).
 * POST   /api/v1/governance/tags          — agrega tag (admin only).
 * DELETE /api/v1/governance/tags?id=N     — remueve tag (admin only).
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  type ColumnTag,
  getColumnTagService,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const VALID_TAGS = new Set<ColumnTag>([
  "pii",
  "sensitive",
  "calculated",
  "deprecated",
  "experimental",
  "public",
  "regulatory",
  "financial",
]);

const addBody = z.object({
  schemaName: z.string().min(1).max(64),
  tableName: z.string().min(1).max(128),
  columnName: z.string().min(1).max(128),
  tag: z.enum([
    "pii",
    "sensitive",
    "calculated",
    "deprecated",
    "experimental",
    "public",
    "regulatory",
    "financial",
  ]),
  note: z.string().max(512).nullable().optional(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});

    const url = new URL(req.url);
    const tagsParam = url.searchParams.get("tags");
    const tags = tagsParam
      ? (tagsParam.split(",").filter((t) => VALID_TAGS.has(t as ColumnTag)) as ColumnTag[])
      : undefined;

    const filter = {
      schemaName: url.searchParams.get("schema") ?? undefined,
      tableName: url.searchParams.get("table") ?? undefined,
      columnName: url.searchParams.get("column") ?? undefined,
      tags,
      limit: url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : undefined,
    };

    const rows = await getColumnTagService().list(filter);
    return { rows, total: rows.length };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const json = await req.json();
    const parsed = addBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const entry = await getColumnTagService().add(parsed.data, session.user.id);

    await recordAuditEvent({
      category: "governance",
      action: "column_tag_added",
      severity: "info",
      actorId: session.user.id,
      actorEmail: session.user.email,
      resource: `${entry.schemaName}.${entry.tableName}.${entry.columnName}`,
      metadata: { tag: entry.tag, note: entry.note },
    });

    return entry;
  });
}

export async function DELETE(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) {
      throw new ValidationError("id requerido y debe ser numerico", { id });
    }

    await getColumnTagService().remove(id);

    await recordAuditEvent({
      category: "governance",
      action: "column_tag_removed",
      severity: "info",
      actorId: session.user.id,
      actorEmail: session.user.email,
      resource: `column_tag:${id}`,
      metadata: { id },
    });

    return { ok: true };
  });
}
