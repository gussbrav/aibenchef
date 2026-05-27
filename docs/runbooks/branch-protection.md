# Runbook — Branch protection

> Reglas que protegen `main` y `production` de pushes directos no revisados.

## Filosofía

Las 3 capas de defensa contra bugs en este repo:

| Capa | Donde | Tiempo | Responsable |
|---|---|---|---|
| 1. **Pre-push hook** | Local del dev | ~3s | `.githooks/pre-push` (ruff + smoke tests) |
| 2. **CI obligatorio en PR** | GitHub Actions | 5-10 min | `.github/workflows/ci.yml` |
| 3. **Branch protection server-side** | GitHub settings | inmediato | Settings → Branches |

Capa 3 es la única **no bypassable** por el dev (las otras dos se saltan con `--no-verify`).

---

## main — rama de desarrollo

| Setting | Valor |
|---|---|
| Require a pull request before merging | ✅ |
| Require approvals | **1** |
| Dismiss stale pull request approvals when new commits are pushed | ✅ |
| Require status checks to pass before merging | ✅ |
| Status checks requeridos | `web — Next.js`, `data-platform — Python`, `data-platform — integration (testcontainers)` |
| Require branches to be up to date before merging | ✅ |
| Require conversation resolution before merging | ✅ |
| Require linear history | ✅ (no merges con `--no-ff`) |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

## production — rama de despliegue

| Setting | Valor |
|---|---|
| Require a pull request before merging | ✅ |
| Require approvals | **1** |
| Require status checks to pass | ✅ (mismos jobs que main) |
| Restrict who can push | Solo el admin (Gus) |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

EasyPanel apunta a `production`. Promotion main → production se hace via PR
fast-forward (ver [deploy.md](./deploy.md)).

---

## Cómo aplicar (UI)

1. Repo → **Settings** → **Branches**
2. **Add branch protection rule** para `main`
3. Configurar checkboxes según la tabla de arriba
4. Repetir para `production`

## Cómo aplicar (gh CLI)

```sh
# Requiere GitHub Pro o repo público + gh autenticado
gh api repos/:owner/:repo/branches/main/protection \
  --method PUT \
  --input docs/runbooks/branch-protection.main.json

gh api repos/:owner/:repo/branches/production/protection \
  --method PUT \
  --input docs/runbooks/branch-protection.production.json
```

## Verificar que funciona

```sh
git checkout main
echo "test" >> README.md
git commit -am "test directo"
git push origin main
# DEBE FALLAR con: "remote rejected: protected branch hook declined"
```

---

## Bypass legítimo (admins)

Si tienes que mergear sin reviewer (hotfix solo, ej.):

```sh
gh pr merge <num> --admin --squash
```

Esto queda registrado en el log del PR. **No** se debe usar para bypass routinario.

## Bypass de emergencia (cuando GitHub está caído)

Pegar el push a `main` con `--no-verify` solo funciona si tienes admin **y**
las protections están temporalmente deshabilitadas. Procedimiento:

1. Settings → Branches → Edit `main` rule → uncheck "Require status checks"
2. Push el hotfix
3. **Inmediatamente** re-activar la regla
4. Postmortem documentado en `docs/incidents/`
