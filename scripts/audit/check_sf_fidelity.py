"""Check rapido: comparar activo total XLS vs DB para muestra SF Sep 2026."""
import psycopg2, sys
sys.stdout.reconfigure(encoding="utf-8")
DSN = "postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable"
conn = psycopg2.connect(DSN)
cur = conn.cursor()

# Top 5 bancos por activo Sep 2026
cur.execute("""
    SELECT b.nomb_correg,
           ROUND(COALESCE(b.cta_a,0)::numeric, 0) AS activo_total,
           ROUND(COALESCE(b.cta_a4_1,0)::numeric, 0) AS vigentes,
           ROUND(COALESCE(b.cta_a4_2,0)::numeric, 0) AS refi,
           ROUND(COALESCE(b.cta_a4_3,0)::numeric, 0) AS atrasada
    FROM marts.v_eeff_balance_ancho b
    JOIN marts.mv_eeff_resultados_ancho r
      ON r.nomb_correg = b.nomb_correg AND r.periodo = b.periodo AND r.moneda = b.moneda
    WHERE b.periodo = 202609 AND b.moneda = 'TOTAL'
      AND r.tipo_entidad = 'BANCOS'
    ORDER BY b.cta_a DESC NULLS LAST LIMIT 5
""")
print("Top 5 BANCOS Sep 2026:")
print(f"  {'entidad':40s} {'activo':>12} {'vigentes':>12} {'refi':>10} {'atrasada':>10}")
for r in cur.fetchall():
    print(f"  {r[0][:40]:40s} {r[1]:>12} {r[2]:>12} {r[3]:>10} {r[4]:>10}")

# Distribucion de entidades con cta_a4_1 = 0 para cada subsistema SF
print("\nEntidades SF con cta_a4_1 (Vigentes) = 0 en Sep 2026 — sintoma del mismo bug:")
for tipo in ['BANCOS', 'FINANCIERAS', 'CMAC', 'CRAC', 'EDPYMES']:
    cur.execute("""
        SELECT
            COUNT(*) FILTER (WHERE COALESCE(b.cta_a4_1,0) = 0) AS vigente_cero,
            COUNT(*) AS total
        FROM marts.v_eeff_balance_ancho b
        JOIN marts.mv_eeff_resultados_ancho r
          ON r.nomb_correg = b.nomb_correg AND r.periodo = b.periodo AND r.moneda = b.moneda
        WHERE b.periodo = 202609 AND b.moneda = 'TOTAL' AND r.tipo_entidad = %s
    """, (tipo,))
    r = cur.fetchone()
    print(f"  {tipo:12s}: {r[0]}/{r[1]} entidades con vigentes=0")

cur.close()
conn.close()
