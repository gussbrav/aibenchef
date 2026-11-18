"""Verificar nombres_fuente de cuentas críticas vs XLS."""
import psycopg2, sys
sys.stdout.reconfigure(encoding="utf-8")
DSN = "postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable"
conn = psycopg2.connect(DSN)
cur = conn.cursor()

for te in ['COOPAC_N1', 'COOPAC_N2A', 'COOPAC_N2B', 'COOPAC_N3']:
    print(f"\n=== {te} balance — cuentas críticas ===")
    cur.execute("""
        SELECT codigo, orden, nombre, nombre_fuente, parent_codigo, valido_desde
        FROM dw.cabecera_maestra
        WHERE tipo_entidad = %s AND tipo_estado = 'balance'
          AND codigo IN ('A1','A2','A3','A4','A4.1','A4.2','A4.3','A4.3.1','A4.3.2','A4.4','A4.5','A5','A6','A7','A8','A_bir')
          AND valido_hasta IS NULL
        ORDER BY orden
    """, (te,))
    for r in cur.fetchall():
        f = r[3] or ''
        print(f"  {r[0]:8s} orden={r[1]:3} parent={r[4] or '-':6s} nombre={(r[2] or '')[:45]:45s} fuente={f[:45]}")

cur.close()
conn.close()
