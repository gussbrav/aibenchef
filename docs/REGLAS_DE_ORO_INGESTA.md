# Reglas de Oro — Ingesta de archivos SBS

Documento vivo de las **inconsistencias reales** encontradas en los `.xls`
mensuales del SBS y las reglas que el código debe respetar siempre.

Cada regla viene de un bug real que costó depurar. Si agregás un parser
nuevo para un tópico, revisá ESTA lista primero.

---

## R1. La fecha NO siempre es un string

**Bug**: el `BaseOficinasImporter` solo manejaba string `"2020-01-31"` y
datetime. CMAC pone la fecha como **Excel serial number** (`46112.0` =
2026-03-31). El parser fallaba con `"No pude extraer fecha"` para los
85 archivos CMAC del 2026.

**Regla**: cualquier extractor de fecha debe soportar **4 formatos**:

| Formato | Ejemplo | Quién lo usa |
|---|---|---|
| datetime object Python | `datetime(2026, 3, 31)` | Algunos archivos (poco común) |
| String ISO `YYYY-MM-DD` | `"2020-01-31"` | Banca Múltiple (B-*) |
| String `DD/MM/YYYY` | `"31/01/2020"` | Variantes antiguas |
| **Excel serial number** | `46112.0` | **CMAC, CRAC, EDPYME** (C-*) |
| String numérico (serial) | `"46112"` | Edge case |

Convertir serial: `epoch = datetime(1899, 12, 30); fecha = epoch + timedelta(days=serial)`

Ver: `monthly_oficinas_importer._excel_serial_to_date()`.

---

## R2. El encoding de los headers está roto

**Bug**: los `.xls` de SBS están guardados en Excel 2003 XML/HTML con
encoding latin1 mal etiquetado. Caracteres con tilde aparecen como:

- `"Código de oficina"` → puede llegar como `"C\xefdigo de oficina"` o `"C?digo de oficina"`
- `"Depósitos a la Vista"` → `"Dep\xefsitos a la Vista"`

**Regla**: nunca matchear headers con strings exactos. Usar:

```python
# Bueno: tolerante a tildes corruptas
elif "oficina" in m and ("digo" in m or "codigo" in m or "c?digo" in m):

# Malo: rompe con encoding latin1 mal
elif m == "codigo de oficina":
```

Y aplicar `unicodedata.normalize("NFD", s)` + filtrar combining chars
para normalizar tildes válidas.

---

## R3. La hoja NO siempre se llama "DataSF" o "Data"

Los archivos individuales del SBS (los .xls que vienen del scrape) tienen
nombres de hojas variables:

| Tópico / Grupo | Sheet name |
|---|---|
| EEFF Banca Múltiple | `BG_*`, `GYP_*`, `ER_*` (varias hojas) |
| Oficinas Banca Múltiple (B-2358) | `"50"` |
| Oficinas CMAC (C-1234) | `"CM"` |
| xlsx consolidado del cliente | `DataSF`, `DataSF_2` |

**Regla**: NO hardcodear sheet name. Estrategias:
1. Leer la primera hoja (cuando hay una sola)
2. Buscar la hoja por contenido (ej. "que tenga 'Empresa' en header_row")
3. Filtrar por prefijo si hay convención (ej. `startswith("bg_")` para balance)

---

## R4. El header_row varía entre tópicos

**Bug**: el parser asumía que la fila de headers principales era siempre
fila 5 (índice 4). En CMAC el header está en **fila 4** (índice 3).

**Regla**: detectar el header_row dinámicamente buscando "Empresa" en
las primeras 10 filas:

```python
for r in range(0, 10):
    for c in range(0, 6):
        v = sheet.cell(r, c)
        if v and "empresa" in _strip_accents(str(v)).lower():
            header_row = r
            break
```

---

## R5. Las celdas tienen forward-fill implícito

Los .xls de SBS usan **merged cells visualmente**, pero al leer crudo
solo la primera fila del grupo tiene el valor. Las siguientes tienen
`None`.

Ejemplo (oficinas):

```
R7: BANCO DE CREDITO | Amazonas | Bagua       | Bagua     | 632 | ...
R8: None             | None     | Chachapoyas | Chachapoyas | 1   | ...
R9: None             | None     | Utcubamba   | Bagua Grande| 3   | ...
R10: None            | Ancash   | Casma       | Casma     | 30  | ...
```

**Regla**: implementar **forward-fill** en el parser para columnas
"agrupadoras": Empresa, Departamento, Provincia, Distrito.

```python
current_empresa = None
for r in range(data_start, sheet.n_rows):
    v = sheet.cell(r, c_empresa)
    if v:
        current_empresa = v
    # current_empresa hereda el último valor no-None
```

NO hacer forward-fill en columnas de valores (saldos, codigo_oficina) —
esos sí pueden ser None legítimamente.

---

## R6. Las entidades vienen en MAYÚSCULAS y con anotaciones

**Bug**: el peer_group del cliente dice `"Mibanco"` pero el .xls
trae `"MIBANCO"`, `"BANCO DE CREDITO**"`, `"FINANCIERA COMPARTAMOS¹"`.

**Reglas**:
1. **Guardar el raw tal cual** en `empresa_sbs` (con mayúsculas y asteriscos).
2. **Resolver el nomb_correg** vía vista mart con 4 estrategias en cascada:
   - `dw.normalizar_entidad(empresa_sbs)` (busca aliases en `dw.entidad_alias`)
   - Match contra `dw.dim_entidad.empresa_sbs` en UPPER
   - Match case-insensitive contra `dw.dim_entidad.nomb_correg`
   - `INITCAP(raw)` como fallback (`"MIBANCO"` → `"Mibanco"`)
3. **Limpiar anotaciones decorativas** SOLO para display (asteriscos, superíndices unicode, "N/" footnotes). Ver `limpiarNombreEntidad()` en `informe/queries.ts`.

Ver: `marts.v_oficinas_por_entidad` (V047).

---

## R7. La fila "Total general" debe excluirse

Los .xls SBS terminan con una fila `"Total general"` que suma todas las
oficinas/montos. Si no se filtra, aparece como una "entidad" más.

**Regla**: skip cuando `empresa_sbs.lower().startswith("total")` o cuando
empieza con "total general" / "total".

---

## R8. Los archivos de un mes pueden no estar publicados

SBS publica con delay de 30-45 días. Para el mes actual o el inmediato
anterior pueden NO existir los .xls → HTTP 404.

**Regla**: en el scraper, NO marcar 404 como error crítico. Loggear como
`download.not_published` y seguir. El runbook
(`docs/runbooks/ingestion-failed.md`) dice lo mismo.

---

## R9. UPSERT idempotente — NO INSERT plano

**Bug potencial**: si un import se interrumpe a mitad, re-correrlo con
INSERT plano causaría duplicados o errores de PK.

**Regla**: TODO importer usa `INSERT ... ON CONFLICT ... DO UPDATE SET`.
La PK lógica que define "misma fila" varía por tabla:

| Tabla | Constraint UNIQUE |
|---|---|
| `raw.eeff_observacion` | (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo) |
| `raw.creditos_depositos_oficina` | (periodo, empresa_sbs, codigo_oficina, producto, departamento_distrito) |

Re-correr el mismo import = no-op. Re-correr el scrape = no-op (skip_if_exists default).

---

## R10. Validar el detector ANTES del import masivo

**Bug**: importé 425 archivos y descubrí que CMAC fallaba al final.
Hubo que arreglar el parser y re-correr.

**Regla**: antes de un import masivo (rango grande de períodos × grupos),
hacer **dry-run en 1 archivo de cada grupo**:

```python
# Test layout + fecha en los 5 grupos
for grupo in ['banca_multiple', 'financiera', 'cmac', 'crac', 'edpyme']:
    p = next(Path(f'./local-data/raw/{grupo}/...').rglob('*.xls'))
    sheets = read_xls(p)
    layout = _detect_column_layout(sheets[0])
    fecha = _extract_fecha_cierre(sheets[0])
    print(f'{grupo}: layout={layout} fecha={fecha}')
    assert layout is not None, f'{grupo} falla layout'
    assert fecha is not None, f'{grupo} falla fecha'
```

---

## R11. El `tipo_entidad` se detecta del PATH, no del contenido

El archivo `.xls` no dice "soy de BANCOS" o "soy de CMAC". Hay que
detectarlo del path de origen (`./local-data/raw/cmac/...` → CMAC).

**Regla**: el detector busca en `path.parts` un componente que matchee
el mapa `_TIPO_ENTIDAD_BY_FOLDER`. Si el scraper deposita archivos en
otra estructura (ej. nombres legacy `01_Entidad_Banca_Multiple`), el
mapa también soporta esos.

Si nada matchea, fallback al prefijo del filename (`B-` → BANCOS,
`C-` → CMAC u otra caja).

---

## R12. NO importar archivos de OTROS tópicos por error

**Bug**: corrí `aibenchef import monthly-oficinas ./local-data/raw` y
procesó todos los `.xls` recursivamente, incluyendo archivos de EEFF
del tópico 01 (`B-3101-*.xls` Financieras EEFF). Resultado: 445
errores ("No pude detectar layout").

**Regla**: filtrar por path o nombre de archivo:
- Path debe incluir `creditos_depositos_geo` (la carpeta del tópico)
- O `--include-pattern` en el CLI

**TODO**: agregar filtro `--topico` al import command para que solo
procese archivos del tópico esperado.

---

## R13. Test antes de commit

Antes de pushear un parser nuevo:
1. Correr con UN archivo: `aibenchef import monthly-X ./path/sample.xls`
2. Verificar `rows_inserted > 0` y `errors = []`
3. Query en DB: `SELECT COUNT(*) FROM raw.X WHERE source_file = 'sample.xls'`
4. Si OK, escalar al rango completo

---

## Checklist para parsers nuevos (futuros tópicos)

- [ ] Auto-detecta sheet name (no hardcoded)
- [ ] Auto-detecta header_row buscando palabra clave en primeras 10 filas
- [ ] Matching de headers tolerante a tildes corruptas (`_strip_accents` + substring)
- [ ] Detección de fecha soporta 4 formatos (datetime / ISO string / DD/MM/YYYY / serial)
- [ ] Forward-fill implementado para columnas agrupadoras (si aplica)
- [ ] Detecta tipo_entidad del path (con fallback al nombre del archivo)
- [ ] Skip filas "Total general" / "Total" / sin clave única
- [ ] INSERT con ON CONFLICT DO UPDATE (idempotente)
- [ ] Test con 1 archivo de cada grupo ANTES del import masivo
- [ ] Filtro por path o pattern para no procesar archivos de otros tópicos
- [ ] Logs estructurados con `log.info(...)` y campos (no f-strings)
