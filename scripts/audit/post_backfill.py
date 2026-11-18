"""Post-backfill COOPAC: refresh MVs + recompute PE para todos los periodos.

TCP keepalives obligatorios: refresh_all_marts(TRUE) puede tardar varios
minutos sin tráfico; sin keepalives el NAT/firewall corta el socket y el
cliente recibe "server closed the connection unexpectedly" aunque el
servidor siga vivo. keepalives_idle=30s fuerza heartbeat TCP cada 30s.
"""
import psycopg2, sys, time
sys.stdout.reconfigure(encoding="utf-8")
DSN = "postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable"
conn = psycopg2.connect(
    DSN,
    keepalives=1,
    keepalives_idle=30,
    keepalives_interval=10,
    keepalives_count=5,
)
conn.autocommit = True
cur = conn.cursor()

print("=== Post-Backfill COOPAC ===")

# 1. Refresh MVs (via refresh_all_derived para incluir compute_PE automáticamente — V217)
#    Pero para cada periodo COOPAC individualmente, para que compute_PE corra.
cur.execute("""
    SELECT DISTINCT periodo
    FROM raw.eeff_observacion
    WHERE tipo_entidad LIKE 'COOPAC_%'
    ORDER BY periodo
""")
periodos = [r[0] for r in cur.fetchall()]
print(f"\n1. Periodos COOPAC a procesar: {len(periodos)}")
print(f"   Rango: {periodos[0]} - {periodos[-1]}")

# 2. Refresh all MVs una sola vez (no por periodo)
print("\n2. Refresh all MVs marts...")
t0 = time.time()
cur.execute("SELECT COUNT(*) FROM marts.refresh_all_marts(TRUE) WHERE success")
n_ok = cur.fetchone()[0]
print(f"   {n_ok} MVs refrescadas en {time.time()-t0:.1f}s")

# 3. Compute PE para cada periodo COOPAC
print("\n3. Compute PE por periodo COOPAC...")
t0 = time.time()
for p in periodos:
    t1 = time.time()
    cur.execute("SELECT COUNT(*) FROM marts.compute_kpis_punto_equilibrio(%s)", (p,))
    n = cur.fetchone()[0]
    print(f"   {p}: {n} entidades ({time.time()-t1:.1f}s)")
print(f"\n   Total: {time.time()-t0:.1f}s")

# 4. Verificación: SAN BLAS histórico
print("\n4. SAN BLAS rendimiento histórico (post-fix):")
cur.execute("""
    SELECT periodo, ROUND(valor::numeric * 100, 2)
    FROM marts.fact_kpis_mensuales
    WHERE nomb_correg = 'COOPAC SAN BLAS' AND moneda = 'TOTAL'
      AND kpi_codigo = 'pe_rendimiento_cartera'
    ORDER BY periodo
""")
for r in cur.fetchall():
    print(f"   {r[0]}: {r[1]}%")

cur.close()
conn.close()
