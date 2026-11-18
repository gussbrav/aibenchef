"""
Checklist preventivo post-publicación SBS.

Corre los 5 chequeos que debería hacer el operador después de cada cierre:
  1. ¿SBS publicó todos los archivos?
  2. ¿Hay drift de cabecera? (V219)
  3. ¿La data entró al dashboard? (cartera > 0)
  4. ¿Sanity vs XLS? (sample entidades conocidas)
  5. ¿KPIs en banda esperada?

Output: reporte markdown en stdout.
"""
import psycopg2, sys, argparse
sys.stdout.reconfigure(encoding="utf-8")

DSN = "postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable"


def check_1_archivos(cur, periodo):
    cur.execute("""
        SELECT COUNT(*) FILTER (WHERE status = 'procesado') AS ok,
               COUNT(*) FILTER (WHERE status = 'no_publicado_sbs') AS pendiente,
               COUNT(*) FILTER (WHERE status NOT IN ('procesado','no_publicado_sbs')) AS error,
               COUNT(*) AS total
        FROM raw.archivos_descargados
        WHERE periodo = %s
    """, (periodo,))
    r = cur.fetchone()
    print(f"\n## 1️⃣  Archivos SBS periodo {periodo}")
    print(f"- Procesados: **{r[0]}**/{r[3]}")
    print(f"- Pendientes SBS: {r[1]}")
    print(f"- Errores: {r[2]}")
    if r[2] > 0:
        cur.execute("""
            SELECT grupo, topico, status, substring(error_mensaje, 1, 80)
            FROM raw.archivos_descargados
            WHERE periodo = %s AND status NOT IN ('procesado','no_publicado_sbs')
            LIMIT 10
        """, (periodo,))
        print("  ERRORES:")
        for e in cur.fetchall():
            print(f"    {e[0]:15s} {e[1]:18s} {e[2]:15s} {e[3] or '-'}")
    if r[1] > 0:
        cur.execute("""
            SELECT grupo, topico FROM raw.archivos_descargados
            WHERE periodo=%s AND status='no_publicado_sbs'
            ORDER BY grupo LIMIT 10
        """, (periodo,))
        pendientes = cur.fetchall()
        print(f"  Pendientes (SBS aún no publicó): " + ", ".join(f"{g[0]}/{g[1]}" for g in pendientes[:5]))
    # veredicto
    if r[2] == 0 and r[0] > 0:
        print("  → ✅ OK")
    elif r[2] == 0 and r[1] > 0:
        print("  → ⏳ Esperando SBS (no acción)")
    else:
        print("  → 🚨 Hay errores — revisar logs del container")


def check_2_drift(cur, periodo):
    cur.execute("""
        SELECT payload->>'tipo_entidad' AS nivel, payload->>'sheet' AS sheet,
               status, actual_value::int AS n_cuentas,
               payload->'muestra' AS muestra
        FROM admin.data_quality_checks
        WHERE check_type = 'fila_sin_match_cabecera'
          AND periodo = %s AND reviewed_at IS NULL
        ORDER BY status DESC, nivel, sheet
    """, (periodo,))
    rows = cur.fetchall()
    print(f"\n## 2️⃣  Drift de cabecera (V219)")
    if not rows:
        print("- ✅ Cabecera sincronizada con XLS — ninguna cuenta nueva detectada")
    else:
        print(f"- ⚠️ {len(rows)} sheet(s) con drift")
        for nivel, sheet, status, n, muestra in rows:
            print(f"  [{status}] {nivel or '?':12s} {sheet or '?':12s} — {n} cuenta(s) desconocidas")
            if muestra:
                # muestra es jsonb con lista de [orden, nombre]
                primeras = muestra[:3] if isinstance(muestra, list) else []
                for item in primeras:
                    if isinstance(item, list) and len(item) == 2:
                        print(f"      · orden={item[0]}: {item[1]}")
        print("  → Decisión: (a) renombrar o (b) catalogar como cuenta nueva")


def check_3_data_entro(cur, periodo):
    # Sospechosas = entidad con activo > 0 pero vigente = 0.
    # Las subdivide en:
    #   - "nuevas": el periodo previo tenía vigente > 0 → caída súbita (posible bug del parser)
    #   - "persistentes": el periodo previo también tenía vigente = 0 → inactiva legítima (liquidación/dormant)
    # Solo las "nuevas" deberían preocupar al operador — las persistentes son parte del universo SBS.
    cur.execute("""
        SELECT r.tipo_entidad,
               COUNT(DISTINCT b.nomb_correg) AS total,
               COUNT(DISTINCT b.nomb_correg) FILTER (WHERE b.cta_a > 0) AS activas,
               COUNT(DISTINCT b.nomb_correg) FILTER (WHERE b.cta_a4_1 > 0) AS con_vigente,
               COUNT(DISTINCT b.nomb_correg) FILTER (WHERE b.cta_a > 0 AND b.cta_a4_1 = 0) AS sospechosas,
               ROUND(AVG(b.cta_a4_1) FILTER (WHERE b.cta_a4_1 > 0)::numeric, 0) AS avg_vigente
        FROM marts.v_eeff_balance_ancho b
        JOIN marts.mv_eeff_resultados_ancho r
          ON r.periodo=b.periodo AND r.nomb_correg=b.nomb_correg AND r.moneda=b.moneda
        WHERE b.periodo = %s AND b.moneda = 'TOTAL'
        GROUP BY r.tipo_entidad
        ORDER BY r.tipo_entidad
    """, (periodo,))
    rows = cur.fetchall()
    print(f"\n## 3️⃣  ¿Data entró al dashboard?")
    if not rows:
        print("- 🚨 Sin data en balance ancho — pipeline rotísimo")
        return
    print(f"  {'nivel':12s} {'total':>6s} {'activas':>8s} {'con_vig':>8s} {'sospech':>8s} {'avg_vig':>12s}")
    sospechosas_total = 0
    for r in rows:
        tipo, total, activas, con_vig, sospechosas, avg_vig = r
        sospechosas_total += sospechosas
        if sospechosas > 0:
            flag = "🚨"
        elif activas > 0 and con_vig / activas < 0.85:
            flag = "⚠"
        else:
            flag = "✓"
        print(f"  {flag} {tipo:12s} {total:>6d} {activas:>8d} {con_vig:>8d} {sospechosas:>8d} {str(avg_vig):>12s}")
    if sospechosas_total == 0:
        print("  → ✅ Cero entidades con activo > 0 sin cartera vigente — pipeline OK")
        return
    # desglose: nuevas (caída súbita) vs persistentes (inactiva histórica)
    cur.execute("""
        WITH actual AS (
            SELECT nomb_correg, cta_a AS activo, cta_a4_1 AS vigente, cta_a4_3 AS atrasada
            FROM marts.v_eeff_balance_ancho
            WHERE periodo = %s AND moneda='TOTAL' AND cta_a > 0 AND cta_a4_1 = 0
        ),
        previo AS (
            SELECT DISTINCT ON (nomb_correg) nomb_correg, cta_a4_1 AS vigente_prev, periodo AS periodo_prev
            FROM marts.v_eeff_balance_ancho
            WHERE periodo < %s AND moneda='TOTAL'
              AND nomb_correg IN (SELECT nomb_correg FROM actual)
            ORDER BY nomb_correg, periodo DESC
        )
        SELECT a.nomb_correg,
               ROUND(a.activo::numeric, 0),
               ROUND(a.atrasada::numeric, 0),
               ROUND(COALESCE(p.vigente_prev, 0)::numeric, 0),
               p.periodo_prev
        FROM actual a
        LEFT JOIN previo p USING (nomb_correg)
        ORDER BY a.activo DESC
    """, (periodo, periodo))
    detalle = cur.fetchall()
    nuevas = [d for d in detalle if d[3] and d[3] > 0]
    persistentes = [d for d in detalle if not d[3] or d[3] == 0]
    if nuevas:
        print(f"  → 🚨 {len(nuevas)} entidad(es) con CAÍDA SÚBITA de vigente>0 a 0 — revisar parser/XLS:")
        for e in nuevas:
            print(f"    · {e[0][:40]:40s} activo={e[1]:>10} atr={e[2]:>8} (vig_prev={e[3]} en {e[4]})")
    if persistentes:
        print(f"  → ℹ️ {len(persistentes)} entidad(es) con vigente=0 PERSISTENTE (inactiva/liquidación — OK):")
        for e in persistentes:
            print(f"    · {e[0][:40]:40s} activo={e[1]:>10} atr={e[2]:>8}")


def check_4_vs_xls(cur, periodo):
    # Sanity check: 5 entidades grandes con sus valores actuales
    print(f"\n## 4️⃣  Sanity check — top 5 entidades (comparar con XLS si hay duda)")
    cur.execute("""
        SELECT b.nomb_correg,
               ROUND(b.cta_a4_1::numeric, 0) AS vigente,
               ROUND(b.cta_a4_3::numeric, 0) AS atrasada,
               ROUND(b.cta_a::numeric, 0) AS activo_total
        FROM marts.v_eeff_balance_ancho b
        WHERE b.periodo = %s AND b.moneda = 'TOTAL'
          AND b.nomb_correg IN (
              'COOPAC SAN BLAS', 'COOPAC COOSUNAT', 'COOPAC MICROWD PERU',
              'Caja Arequipa', 'Banco de Crédito del Perú'
          )
        ORDER BY b.nomb_correg
    """, (periodo,))
    rows = cur.fetchall()
    if not rows:
        print("- (sin muestra disponible para el periodo)")
        return
    print(f"  {'entidad':35s} {'vigente':>12s} {'atrasada':>10s} {'activo':>14s}")
    for r in rows:
        print(f"  {r[0][:35]:35s} {str(r[1]):>12s} {str(r[2]):>10s} {str(r[3]):>14s}")
    print("  → Verifica con el XLS correspondiente que coincidan al kilo")


def check_5_kpis_banda(cur, periodo):
    cur.execute("""
        SELECT nomb_correg,
               ROUND(MAX(valor) FILTER (WHERE kpi_codigo='pe_rendimiento_cartera')::numeric * 100, 2) AS rend,
               ROUND(MAX(valor) FILTER (WHERE kpi_codigo='pe_margen_neto')::numeric * 100, 2) AS margen,
               ROUND(MAX(valor) FILTER (WHERE kpi_codigo='pe_punto_equilibrio')::numeric * 100, 2) AS pe
        FROM marts.fact_kpis_mensuales
        WHERE periodo = %s AND moneda='TOTAL'
          AND nomb_correg IN ('COOPAC SAN BLAS', 'COOPAC MICROWD PERU', 'CMAC Arequipa')
          AND kpi_codigo IN ('pe_rendimiento_cartera','pe_margen_neto','pe_punto_equilibrio')
        GROUP BY nomb_correg
        ORDER BY nomb_correg
    """, (periodo,))
    rows = cur.fetchall()
    print(f"\n## 5️⃣  KPIs de referencia")
    if not rows:
        print("- ⏳ PE no calculado todavía para este periodo")
        return
    bandas = {
        'COOPAC SAN BLAS':      (32, 40, 'rend'),  # rendimiento esperado 32-40%
        'COOPAC MICROWD PERU':  (18, 28, 'rend'),
        'CMAC Arequipa':        (14, 22, 'rend'),
    }
    print(f"  {'entidad':30s} {'rend':>8s} {'margen':>8s} {'PE':>8s}  banda OK?")
    for r in rows:
        min_, max_, _ = bandas.get(r[0], (0, 100, 'rend'))
        rend = float(r[1]) if r[1] is not None else 0
        banda_ok = "✓" if min_ <= rend <= max_ else "🚨"
        print(f"  {r[0][:30]:30s} {str(r[1]):>8s} {str(r[2]):>8s} {str(r[3]):>8s}  {banda_ok} (esperado {min_}-{max_}%)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periodo", type=int, required=True, help="YYYYMM")
    args = ap.parse_args()

    conn = psycopg2.connect(DSN); cur = conn.cursor()
    print(f"# Checklist preventivo — periodo {args.periodo}")
    check_1_archivos(cur, args.periodo)
    check_2_drift(cur, args.periodo)
    check_3_data_entro(cur, args.periodo)
    check_4_vs_xls(cur, args.periodo)
    check_5_kpis_banda(cur, args.periodo)
    cur.close(); conn.close()


if __name__ == "__main__":
    main()
