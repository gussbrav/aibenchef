# Runbook — Pre-push hook

## Qué es

Script en `.githooks/pre-push` que corre **antes** de cada `git push`:

1. Detecta archivos Python tocados desde el último push
2. Corre `ruff check` sobre ellos (~1s)
3. Corre `ruff format --check` (~0.5s)
4. Si tocaste `src/` o `tests/`, corre tests rápidos (`-m "not slow and not integration"`)

Total: <3s en el caso común. **Capa 1 de defensa contra bugs**.

## Instalación (una sola vez)

```sh
bash .githooks/install.sh
```

Equivale a `git config core.hooksPath .githooks`. El config queda en
`.git/config` local — no se commitea.

## Verificar que está activo

```sh
git config --get core.hooksPath
# debe imprimir: .githooks
```

## Bypass de emergencia

```sh
git push --no-verify
```

Cuándo es válido:
- CI ya validó el branch antes (working ya merged)
- Push WIP a una feature branch propia que nadie más usa
- GitHub Actions caído pero necesitas mover trabajo a otra máquina

**Nunca** usar `--no-verify` para mergear a `main` o `production`.

## Errores comunes

### `ruff check encontro errores`

```sh
cd data-platform
uv run ruff check --fix .
# Revisar diff antes de commitear
```

### `archivos sin formatear`

```sh
cd data-platform
uv run ruff format .
git add -u
git commit --amend --no-edit  # o nuevo commit
```

### `tests fallidos`

```sh
cd data-platform
uv run pytest -q -m "not slow and not integration" -v
```

Identificar el test específico que falla y arreglar (no commitear código roto).

## Performance

| Tamaño del cambio | Tiempo esperado |
|---|---|
| 1-3 archivos | <2s |
| 10 archivos | ~3s |
| Refactor grande (>50 archivos) | 5-8s |

Si toma >10s, perfila con:

```sh
time bash .githooks/pre-push origin https://...
```

Si tests son los lentos, agregar `@pytest.mark.slow` al test culpable.
