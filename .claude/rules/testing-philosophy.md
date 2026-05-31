# Testing Philosophy — Aibenchef

> Esta es la filosofia de testing del proyecto. Claude Code debe leerla antes de
> escribir cualquier test. Si un test propuesto viola alguna regla, no se merge.

---

## Principio fundamental

**Un test debe FALLAR si el codigo esta mal.**

Si pasa siempre, no es test, es decoracion. Si no podes explicar en una frase
*"este test fallaria si X rompe el codigo"*, no lo escribas.

---

## Reglas no negociables

### 1. Testea comportamiento, no implementacion

Mal:
```python
def test_get_user_returns_dict():
    assert isinstance(get_user(1), dict)
```

Bien:
```python
def test_get_user_inactivo_no_aparece_en_listado_default():
    """Given un usuario con status='inactivo', When listo usuarios sin
    filtros, Then no aparece en el resultado."""
    crear_usuario(id=1, status="inactivo")
    crear_usuario(id=2, status="activo")
    assert {u["id"] for u in listar_usuarios()} == {2}
```

El primer test pasa siempre. El segundo falla si la query no respeta el filtro
por defecto — que es lo que el negocio espera.

### 2. Parsers y transformaciones financieras: golden dataset obligatorio

El parser EEFF y cualquier otro parser de archivos SBS **debe** validarse
contra el dataset `tests/golden/` que contiene (entidad, periodo, cuenta) →
valor_esperado extraido del Excel canonico de Gus (`BASE EE.FF..xlsx` y
analogos).

Mocks de cabecera o data sintetica no reemplazan al golden. El bug del
footnote SBS (issue #15) y la confusion CMAC TOTAL_ACTIVO=TOTAL_PASIVO
(issue #13) hubieran sido detectados el dia 1 con golden data.

### 3. Invariantes del dominio: property-based con Hypothesis

Para reglas que deben cumplirse para *cualquier* input valido, usar
property-based. Ejemplos:

- `activos == pasivos + patrimonio` para cualquier (entidad, periodo)
- `0 <= ratio_mora <= 1`
- `TTM(periodo) == YTD(periodo) + YTD(dic_anio_previo) - YTD(mismo_mes_anio_previo)`
- `periodo % 100 BETWEEN 1 AND 12`

Property-based corre con cientos de ejemplos generados. Si UNO solo falla, te
devuelve el contraejemplo exacto.

### 4. Queries SQL: snapshot tests con Postgres real (testcontainers)

Mocks de DB son inutiles porque no replican el plan de query, los tipos
exactos, ni el comportamiento de funciones SBS-especificas
(`dw.resolver_nomb_correg_canonico`, `dw.raw_to_vigente`). Levantar
Postgres efimero con testcontainers es lo correcto.

Marcar con `@pytest.mark.integration`. CI las corre, dev local las salta
con `pytest -m "not integration"`.

### 5. Tests de regresion: comentario con bug ID

Cada test que existe por un bug encontrado en produccion debe tener un
docstring con el issue/PR donde se reporto. Esto permite rastrear el
historial y borrar el test solo si el codigo cambia de forma incompatible
con conciencia.

```python
def test_resolucion_sbs_un_asterisco(self):
    """REGRESION issue #15: '* Mediante Resolución SBS N° 1286-2019'
    causaba offset acumulado en orden, mal-asignando codigos contables."""
```

Naming: `TestNombreBug` o `test_xxx_regression` cuando aplica.

### 6. NO testear

No agregar tests para:

- Getters / setters / constructores triviales
- Comportamiento de libs externas (pandas, psycopg, drizzle, click)
- Type checking (eso lo hace mypy/tsc, no pytest)
- Configuracion estatica (variables hardcoded)
- Codigo que ya valida `pyright`/`mypy` strict

Si Claude propone un test asi, rechazar y pedir uno de los tipos validos
arriba.

---

## Antes de aceptar un test propuesto, responde 3 preguntas

1. **¿Si rompo el codigo, este test falla?** Tiene que ser SI explicito.
2. **¿Que invariante del dominio o que comportamiento del usuario verifica?**
   No "que la funcion existe", sino que regla de negocio cubre.
3. **¿Es golden / property / snapshot / regression / unit?** Si no encaja en
   ninguna categoria, probablemente no aporta.

Si no podes responder las 3, el test no se merge.

---

## Coverage como metrica

**Coverage NO es objetivo, es consecuencia.**

Apuntar a 100% coverage produce tests basura: mocks de todo, asserts triviales,
ramas testeadas por testearlas. Es el incentivo equivocado.

Apuntar a:
- 100% de invariantes financieras cubiertas por property-based
- 100% de bugs historicos cubiertos por regression con bug ID
- 1 golden dataset por parser de SBS
- Tests de integration para cada query SQL critica de marts/

El coverage emerge alto naturalmente cuando lo importante esta cubierto.

---

## Cuando es OK saltarse alguna regla

- Spike / POC explicito: no test. Borrar el codigo del spike o promoverlo
  con tests reales.
- Fix de typo / docs: no requiere test.
- Refactor sin cambio de comportamiento: tests existentes deben pasar sin
  modificarse. Si tenes que cambiar tests es porque cambiaste comportamiento.

---

## Referencias

- `tests/REFERENCE_GOOD_TEST.py` — plantillas canonicas
- `tests/golden/README.md` — como agregar al golden dataset
- `tests/property/` — ejemplos de Hypothesis
- `tests/integration/` — snapshot tests con Postgres
