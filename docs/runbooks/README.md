# Runbooks Aibenchef

Procedimientos operativos. Cada uno responde "qué hago si necesito X".

## Índice

| Runbook | Cuándo consultar |
|---|---|
| [branch-protection.md](./branch-protection.md) | Configurar reglas de proteccion en main/production |
| [deploy.md](./deploy.md) | Promover main → production y deployar en EasyPanel |
| [pre-push-hook.md](./pre-push-hook.md) | Instalar/debuggear el hook local |
| [testing.md](./testing.md) | Correr/escribir tests + cobertura |

## 3 capas de defensa contra bugs

```
[ Capa 1 ] Pre-push hook local (~3s)
           └─ ruff check + format + smoke tests
                          ↓
[ Capa 2 ] CI obligatorio en PR (~5-10 min)
           └─ Lint + format + pytest unit + pytest integration (Docker)
                          ↓
[ Capa 3 ] Branch protection server-side
           └─ Requiere CI verde + 1 review + linear history
```

Solo la capa 3 es no-bypassable. Las otras dos se pueden saltar con
`--no-verify` (pre-push) o `gh pr merge --admin` (branch protection),
pero son la red de seguridad principal en el día a día.

## Workflow estándar

```sh
# 1. Crear feature branch
git checkout -b feature/<descripcion>

# 2. Hacer cambios + commits

# 3. Push (capa 1 corre aqui)
git push -u origin feature/<descripcion>

# 4. Abrir PR (capa 2 corre aqui)
gh pr create --base main --fill

# 5. Esperar CI verde + review

# 6. Mergear (capa 3 valida server-side)
gh pr merge --squash --auto

# 7. Eventualmente, promover a production (ver deploy.md)
```
