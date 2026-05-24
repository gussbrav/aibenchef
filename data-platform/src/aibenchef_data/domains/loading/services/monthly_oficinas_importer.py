"""MonthlyOficinasImporter — carga los .xls mensuales SBS de tópico 08
(CREDITOS_Y_DEPOSITOS_GEOGRAFICA_SBS) a raw.creditos_depositos_oficina.

A diferencia de BaseOficinasImporter (que lee un xlsx consolidado tipo
"CREDITOS Y DEPOSITOS POR OFICINAS.xlsx" con sheet DataSF), este importer
lee los .xls individuales del SBS — uno por (grupo, periodo).

Formato del .xls SBS:
    - Hoja unica (nombre numerico tipo "50")
    - Filas 1-4: cabeceras decorativas (titulo, fecha, "(En miles de soles)")
    - Fila 5: header principal: Empresa | Ubicacion | Codigo Oficina |
              Depositos a la Vista | Depositos de Ahorro | Depositos a Plazo |
              Total Depositos | Creditos Directos | Total Creditos
    - Fila 6: sub-header: Departamento | Provincia | Distrito | MN | ME | Total
    - Fila 7+: data
    - Columna A (Empresa): forward-fill (solo aparece en primera fila del grupo)
    - Columnas B/C/D (Dpto/Prov/Distrito): forward-fill
    - Columna E: Codigo Oficina (int)
    - Resto: valores monetarios en miles de soles

Estandarizacion de nombres:
    - empresa_sbs se almacena tal cual (MAYUSCULAS, con asteriscos, etc.)
    - La vista marts.v_oficinas_por_entidad (V047) resuelve el nomb_correg
      canonico con 4 estrategias en cascada (normalizar_entidad / match
      empresa_sbs en UPPER / match nomb_correg / INITCAP fallback).
"""

from __future__ import annotations

import re
import time
import unicodedata
from pathlib import Path

import psycopg

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)


_TIPO_ENTIDAD_BY_FOLDER = {
    "banca_multiple": "BANCOS",
    "01_entidad_banca_multiple": "BANCOS",
    "financiera": "FINANCIERAS",
    "02_entidad_empresas_financiera": "FINANCIERAS",
    "cmac": "CMAC",
    "03_entidad_cajamunicipales": "CMAC",
    "crac": "CRAC",
    "04_entidad_cajarurales": "CRAC",
    "edpyme": "EDPYMES",
    "05_entidad_edpymes": "EDPYMES",
}


def _safe_text(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _to_int(v) -> int | None:
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return int(v)
        s = str(v).strip()
        if not s:
            return None
        return int(float(s))
    except (ValueError, TypeError):
        return None


def _to_numeric(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _strip_accents(s: str) -> str:
    """Quitar tildes para matching robusto de headers."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def _detect_tipo_entidad(path: Path) -> str:
    """Detecta el tipo_entidad del archivo por la carpeta padre (grupo).

    Busca en el path componentes que matcheen _TIPO_ENTIDAD_BY_FOLDER.
    """
    for part in path.parts:
        norm = part.lower()
        if norm in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[norm]
    # Fallback: si el filename empieza con "B-" -> banca multiple, "C-" -> cajas
    name = path.name.upper()
    if name.startswith("B-"):
        return "BANCOS"  # incluye Financieras tambien, no es perfecto
    if name.startswith("C-"):
        return "CMAC"
    return "DESCONOCIDO"


def _extract_fecha_cierre(sheet) -> tuple[int, str] | None:
    """Busca la fecha en las primeras 6 filas y devuelve (periodo, fecha_iso).

    El .xls SBS pone la fecha en la fila 2 col 0 con formato "2020-01-31"
    o "31/01/2020" o datetime objeto Python.
    """
    for r in range(0, 6):
        for c in range(0, 3):
            v = sheet.cell(r, c)
            if v is None:
                continue
            # Si ya es datetime
            if hasattr(v, "year") and hasattr(v, "month"):
                anio = int(v.year)
                mes = int(v.month)
                if 2000 <= anio <= 2050 and 1 <= mes <= 12:
                    return (anio * 100 + mes, f"{anio:04d}-{mes:02d}-{v.day:02d}")
            s = str(v).strip()
            # Match YYYY-MM-DD
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
            if m:
                anio, mes, dia = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 2000 <= anio <= 2050 and 1 <= mes <= 12:
                    return (anio * 100 + mes, f"{anio:04d}-{mes:02d}-{dia:02d}")
            # Match DD/MM/YYYY
            m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
            if m:
                dia, mes, anio = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 2000 <= anio <= 2050 and 1 <= mes <= 12:
                    return (anio * 100 + mes, f"{anio:04d}-{mes:02d}-{dia:02d}")
    return None


def _detect_column_layout(sheet) -> dict[str, int] | None:
    """Detecta posiciones de columnas leyendo las filas 5 y 6 (headers).

    Devuelve dict con keys: empresa, depto, prov, dist, cod_of, dep_vista_total,
    dep_ahorro_total, dep_plazo_total, dep_total, cred_directos_total, cred_total
    (no todas garantizadas — depende del archivo).
    """
    layout: dict[str, int] = {}
    # Buscar fila con "Empresa" y "Codigo Oficina" - usualmente fila 5
    header_row = None
    for r in range(3, 10):
        for c in range(0, 6):
            v = sheet.cell(r, c)
            if v is None:
                continue
            s = _strip_accents(str(v)).lower().strip()
            if "empresa" in s and r < 8:
                header_row = r
                break
        if header_row is not None:
            break
    if header_row is None:
        return None

    # Fila 5: encabezados principales | Fila 6: sub-encabezados
    main = [sheet.cell(header_row, c) for c in range(0, sheet.n_cols)]
    sub = [sheet.cell(header_row + 1, c) for c in range(0, sheet.n_cols)]

    for c in range(0, len(main)):
        m = _strip_accents(str(main[c] or "")).lower().strip()
        s = _strip_accents(str(sub[c] or "")).lower().strip()
        if m == "empresa":
            layout["empresa"] = c
        elif s == "departamento":
            layout["depto"] = c
        elif s == "provincia":
            layout["prov"] = c
        elif s == "distrito":
            layout["dist"] = c
        elif "codigo oficina" in m or "codigo de oficina" in m:
            layout["cod_of"] = c
        elif "depositos a la vista" in m and "total" in s:
            layout["dep_vista_total"] = c
        elif "depositos de ahorro" in m and "total" in s:
            layout["dep_ahorro_total"] = c
        elif "depositos a plazo" in m and "total" in s:
            layout["dep_plazo_total"] = c
        elif "total depositos" in m:
            layout["dep_total"] = c
        elif "creditos directos" in m and "total" in s:
            layout["cred_directos_total"] = c
        elif "total creditos" in m:
            layout["cred_total"] = c

    layout["_data_start_row"] = header_row + 2
    return layout if "cod_of" in layout else None


class MonthlyOficinasImporter:
    """Importer de .xls mensuales SBS topico 08 — uno por (grupo, periodo).

    Procesa archivos como:
        local-data/raw/<grupo>/creditos_depositos_geo/<anio>/<mes>/<file>.xls

    O archivos sueltos como:
        Extraer data de pagina SBS/01_Entidad_Banca_Multiple/08_..._SBS/2020/B-2358-en2020.xls
    """

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 5_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_oficinas.start", path=str(path))

        try:
            sheets = read_xls(path)
        except Exception as e:
            raise ValidationError(f"No pude leer {path}: {e}") from e
        if not sheets:
            raise ValidationError(f"Sin hojas en {path}")

        sheet = sheets[0]
        log.info("monthly_oficinas.sheet", name=sheet.name, rows=sheet.n_rows, cols=sheet.n_cols)

        fecha_info = _extract_fecha_cierre(sheet)
        if fecha_info is None:
            raise ValidationError(f"No pude extraer fecha de {path}")
        periodo, fecha_iso = fecha_info

        layout = _detect_column_layout(sheet)
        if layout is None:
            raise ValidationError(
                f"No pude detectar layout de columnas en {path}. "
                f"Esperaba header con 'Empresa' y 'Codigo Oficina'."
            )
        log.info("monthly_oficinas.layout", periodo=periodo, layout=layout)

        tipo_entidad = _detect_tipo_entidad(path)
        data_start = int(layout["_data_start_row"])

        # Forward-fill: empresa, depto, prov, distrito persisten hacia abajo
        # hasta que aparezca un valor nuevo.
        current_empresa: str | None = None
        current_depto: str | None = None
        current_prov: str | None = None
        current_dist: str | None = None

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        c_emp = layout["empresa"]
        c_dep = layout.get("depto", -1)
        c_pro = layout.get("prov", -1)
        c_dis = layout.get("dist", -1)
        c_cod = layout["cod_of"]
        c_dvt = layout.get("dep_vista_total", -1)
        c_dat = layout.get("dep_ahorro_total", -1)
        c_dpt = layout.get("dep_plazo_total", -1)
        c_dtot = layout.get("dep_total", -1)
        c_cdt = layout.get("cred_directos_total", -1)
        c_ctot = layout.get("cred_total", -1)

        for r in range(data_start, sheet.n_rows):
            try:
                # Forward-fill columns
                v_emp = _safe_text(sheet.cell(r, c_emp))
                if v_emp:
                    current_empresa = v_emp
                if c_dep >= 0:
                    v_dep = _safe_text(sheet.cell(r, c_dep))
                    if v_dep:
                        current_depto = v_dep
                if c_pro >= 0:
                    v_pro = _safe_text(sheet.cell(r, c_pro))
                    if v_pro:
                        current_prov = v_pro
                if c_dis >= 0:
                    v_dis = _safe_text(sheet.cell(r, c_dis))
                    if v_dis:
                        current_dist = v_dis

                # Skip "Total general" y filas sin codigo oficina
                cod = _to_int(sheet.cell(r, c_cod))
                if cod is None:
                    skipped += 1
                    continue
                if not current_empresa or not current_depto:
                    skipped += 1
                    continue
                if current_empresa.lower().startswith("total"):
                    skipped += 1
                    continue

                # Saldos
                dep_total = _to_numeric(sheet.cell(r, c_dtot)) if c_dtot >= 0 else None
                cred_total = _to_numeric(sheet.cell(r, c_ctot)) if c_ctot >= 0 else None

                depto_dist = f"{current_depto}_{current_dist or '(sin)'}"

                rows.append(
                    (
                        periodo,
                        fecha_iso,
                        current_empresa,
                        None,  # empresa (nombre corto, no esta en xls SBS)
                        None,  # empresa_benchmark
                        tipo_entidad,
                        None,  # clasificacion
                        None,  # mayor_50_pct_cb
                        current_depto,
                        current_prov,
                        current_dist,
                        depto_dist,
                        None,  # region_caqp
                        None,  # region_caqp_sp
                        cod,
                        "TOTAL",  # producto - una sola fila por oficina sumando todo
                        None,  # saldo_mn (no separado por moneda en este parser inicial)
                        None,  # saldo_me
                        dep_total if dep_total is not None else cred_total,  # saldo_total como proxy
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {r}: {e}")
                if len(errors) > 50:
                    break

        log.info("monthly_oficinas.parsed", rows=len(rows), skipped=skipped, periodo=periodo)

        if not rows:
            return ImportResult(
                source="monthly_oficinas",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        insert_sql = """
            INSERT INTO raw.creditos_depositos_oficina (
                periodo, fecha_cierre, empresa_sbs, empresa, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_cb,
                departamento, provincia, distrito, departamento_distrito,
                region_caqp, region_caqp_sp, codigo_oficina,
                producto, saldo_mn, saldo_me, saldo_total, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa_sbs, codigo_oficina, producto, departamento_distrito)
            DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                provincia = EXCLUDED.provincia,
                distrito = EXCLUDED.distrito,
                saldo_total = EXCLUDED.saldo_total,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """

        inserted = 0
        for i in range(0, len(rows), self._batch_size):
            batch = rows[i : i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(insert_sql, batch)
            await self._conn.commit()
            inserted += len(batch)

        log.info(
            "monthly_oficinas.done",
            inserted=inserted,
            skipped=skipped,
            periodo=periodo,
            duration_s=round(time.perf_counter() - start, 2),
        )

        return ImportResult(
            source="monthly_oficinas",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
