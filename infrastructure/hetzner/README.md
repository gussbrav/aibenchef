# Hetzner manual deploy (fallback)

**No es la ruta principal de deploy.** El path recomendado es via EasyPanel:
ver [`docs/SETUP_EASYPANEL.md`](../../docs/SETUP_EASYPANEL.md).

Los archivos en este directorio sirven como:

1. **Fallback**: si EasyPanel se cae o decidimos migrar, podemos levantar todo el stack
   con `docker-compose.production.yml` directo en cualquier VPS.
2. **Referencia**: muestra explicito todos los servicios, sus variables y como interactuan.
3. **Local-prod parity**: el mismo compose se puede correr en otro server idéntico.

## Cuando usarlos

- EasyPanel no esta disponible.
- Querés un staging en otro VPS aparte.
- Migración de provider (Hetzner -> otro).

## Como activar este modo (si fuera necesario)

1. SSH al VPS limpio.
2. `bash bootstrap.sh` (como root, una vez).
3. `su - aibenchef && cd ~/aibenchef/infrastructure/hetzner`.
4. `cp .env.production.example .env.production && nano .env.production`.
5. `bash deploy.sh`.

**Importante:** si corre en un VPS donde EasyPanel YA usa los puertos 80/443, este
docker-compose va a fallar al levantar Caddy. Hay que cambiar los puertos a 8080/8443
y poner Aibenchef detrás de Traefik de EasyPanel via dominio interno.
