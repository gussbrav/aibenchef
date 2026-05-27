# Runbook — Deploy a producción (EasyPanel)

## Filosofía

- **EasyPanel apunta a la rama `production`**, no a `main`.
- `main` es la rama de desarrollo: recibe features via PR con CI verde.
- `production` solo avanza por **fast-forward desde main**, cuando estamos
  seguros de salir a usuarios reales.
- Cada deploy es **manual** desde el dashboard de EasyPanel (no auto-push).

## Flujo

```
feature/x ──PR──> main (CI verde + 1 review) ──FF──> production ──> EasyPanel manual deploy
```

---

## Promotion main → production

### Opción A — fast-forward (recomendado)

Cuando no hay nada en production que no esté en main (caso común):

```sh
git checkout production
git pull origin production
git merge --ff-only origin/main
git push origin production
```

Si `--ff-only` falla, **NO** fuerces el merge. Revisa por qué production tiene
commits que main no — probablemente alguien hizo hotfix directo en production
y debes traerlo a main primero.

### Opción B — PR main → production

Cuando quieres review explícito del lote a deployar:

```sh
gh pr create --base production --head main \
  --title "Deploy $(date +%Y-%m-%d)" \
  --body "## Changes\n$(git log production..main --oneline)"
```

---

## Hotfix directo en production

Solo cuando el bug es crítico y main tiene features no-listas-para-prod:

```sh
git checkout production
git pull
git checkout -b hotfix/<descripcion>
# … fix …
git commit -am "fix: descripcion"
git push origin hotfix/<descripcion>
gh pr create --base production --head hotfix/<descripcion>
# Merge cuando CI verde
# DESPUES: backport a main
git checkout main
git cherry-pick <sha-del-hotfix>
git push
```

---

## Deploy en EasyPanel

1. https://easypanel.host → proyecto `aibenchef`
2. Servicio `web` → **Source** → confirmar branch = `production`
3. **Deploy** (botón) → espera el log hasta "Application started"
4. Smoke test: https://aibenchef.azoramind.com/dashboard/admin/archivos
5. Verificar que el commit deployado coincide con `git rev-parse origin/production`

## Rollback rápido

EasyPanel guarda los últimos N builds. Para rollback:

1. EasyPanel → servicio → **Deployments** → encontrar el deploy anterior estable
2. Click "Redeploy" sobre ese commit
3. Mientras tanto, en local:
```sh
git checkout production
git reset --hard <sha-anterior-estable>
git push --force-with-lease origin production
```

Documentar en `docs/incidents/<fecha>-<resumen>.md` el porqué.

---

## Cuándo deployar

| Cambio | ¿Deployar inmediato? |
|---|---|
| Bug fix crítico (data corruption, login roto) | ✅ Sí (hotfix) |
| Feature nueva probada en main >24h | ✅ Sí |
| Refactor sin cambio funcional | ✅ Sí, en próximo deploy regular |
| Cambio de migration | ⚠️  Solo si hay backup reciente + ventana de mantenimiento |
| Cambio de DSN / credenciales | ⚠️  Coordinar con admin de panel.azoramind.com |
