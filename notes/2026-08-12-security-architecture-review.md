# Revisión de seguridad y arquitectura — 2026-08-12

Análisis del estado actual del repositorio con foco en robustez operativa,
mantenibilidad, coste del VPS y observabilidad.

---

## Lo que ya está sólido (no tocar)

- SQL 100% parametrizado (postgres.js tagged templates), sin riesgo de inyección.
- Validación con zod en todos los endpoints con límites duros (radio ≤ 5 000 m,
  limit ≤ 200/2 000, lat/lng con rangos forzados).
- Sin sinks de XSS en el frontend (sin `dangerouslySetInnerHTML` ni `innerHTML`).
- `execFile` con args hardcodeados en el worker → sin riesgo de command injection.
- La BD no está expuesta a internet (bind en `127.0.0.1:5432` en prod).
- TLS automático con Caddy + Let's Encrypt.
- Sin secretos hardcodeados en el código.
- Contrato HTTP compartido en `packages/shared` con zod → única fuente de verdad.
- Observabilidad y DR ya bien diseñados (GoAccess, UptimeRobot, `restore-data.sh`
  con transacción atómica + validación de integridad).

---

## 1. Robustez operativa — prioridad máxima

### 1.1 El CI no valida nada antes de desplegar ⚠️

`deploy.yml` hace build + SSH deploy en cada push a `main`, pero **no ejecuta
`test`, `typecheck` ni `lint`**. La API corre TypeScript directamente con `tsx`
en producción (sin compilación), así que un error de tipos puede llegar a
producción y explotar en runtime.

**Qué hacer:**
- Crear un workflow `ci.yml` separado que corra en `pull_request` y `push`:
  `pnpm typecheck`, `pnpm -r test`, `pnpm lint`, `pnpm audit --audit-level=high`.
- `deploy.yml` pasa a depender del éxito de CI (`needs:` o `workflow_run`).
- Regla de rama en `main`: PR obligatoria + CI verde.
- **Ojo:** `pnpm lint` tiene fallos de baseline conocidos (ver AGENTS.md). El
  gate de lint hay que introducirlo tras limpiar ese baseline, o arrancarlo como
  no-bloqueante hasta entonces.

### 1.2 El build ocurre en el servidor y no hay rollback limpio

El deploy hace `git pull --ff-only` + `docker compose build api` **en el VPS**.
Problemas:
- El build compite por CPU/RAM con la app en producción.
- Sin imágenes versionadas → el rollback es "git revert + rebuild".

**Qué hacer:**
- Construir la imagen de la API en CI y publicarla en GHCR
  (`ghcr.io/…:sha-<commit>`).
- El VPS solo hace `pull` + `up -d` → más rápido, reproducible.
- Rollback = `up -d` con el tag del commit anterior.

### 1.3 Migrate + refine + up en un bloque SSH sin salvaguarda

Si `migrate up` falla a mitad, la app puede reiniciar contra un esquema
inconsistente.

**Qué hacer:**
- Hacer un `pg_dump` rápido justo antes de migrar (aunque los datos sean
  regenerables, evita un rebuild de 30 min por un fallo de migración).
- Verificar que cada migración nueva tenga un `down` documentado o esté marcada
  como irreversible.

### 1.4 Todo corre como root

Los contenedores no tienen directiva `USER` → corren como root por defecto.
El deploy opera como `root@host`.

**Qué hacer:**
- Añadir `USER node` en `deploy/Dockerfile.api`.
- Crear un usuario `deploy` no-root en el VPS con acceso a Docker.
  Reduce el radio de impacto de cualquier compromiso.

### 1.5 Backups: plan válido hoy con un punto ciego

El DR "datos regenerables desde el PC" es correcto, pero depende de que el PC del
mantenedor conserve los `serving.dump` → único punto de fallo físico.

**Qué hacer ahora:**
- Copiar el último dump a almacenamiento barato (bucket S3/B2/Backblaze con
  lifecycle policy, o segundo disco externo).

**Qué preparar antes de lanzar feedback de usuarios:**
- El propio doc `docs/15-observability.md` lo dice: ese día los datos ya no son
  regenerables. Tener el `pg_dump` nocturno de la tabla de feedback listo
  **antes** de lanzar la función.

### 1.6 Higiene de release: `.dockerignore` y `.env.production`

- `.dockerignore` no excluye `.env*` y el Dockerfile hace `COPY . .` → un `.env`
  en el contexto de build se hornearía en la imagen.
- `.env.production` está trackeado en git. Se cree que solo contiene
  `VITE_API_URL=/api` (público), pero conviene **confirmarlo y moverlo a un
  patrón ignorado** para evitar fugas futuras.

**Qué hacer:**
- Añadir `**/.env*` a `.dockerignore`.
- Verificar `.env.production` y añadir el patrón a `.gitignore`.

---

## 2. Arquitectura y mantenibilidad

### 2.1 `tsx` en producción vs. build compilado

Correr con `tsx` está bien para iterar; en producción significa sin type-check
en el arranque, más RAM y la imagen arrastra `pnpm` + todo el código fuente.

**Qué hacer (cuando toque):**
- Compilar la API con `tsc`/`tsup`/esbuild como parte del build de CI.
- Imagen multi-stage: build stage → runtime `node:22-slim` mínimo.
- Beneficios: imagen ~50-70% más pequeña, arranque más rápido, menos RAM.

### 2.2 El contrato compartido es el mayor activo — explotarlo más

Ya hay zod en `packages/shared`. Oportunidades:
- Derivar los tipos del cliente **exclusivamente** de los schemas de `shared`
  para evitar drift entre `web/api.ts` y la API.
- Añadir un test de contrato que verifique que las respuestas reales de la API
  validan contra los schemas de `shared`.

### 2.3 El worker: frontera de responsabilidad

`openNow.ts` y el matcher versionado `censo-refinement.ts` ya son dueños únicos
de su lógica. Vale la pena documentar esa frontera en el código directamente para
que no se rompa accidentalmente.

A largo plazo, extraer un pequeño "framework de fuente" común (descarga → parse
→ normaliza → upsert con provenance) reduce la duplicación entre
`ingest-madrid.ts`, `ingest-barcelona.ts`, `ingest-diba.ts`, `ingest-andalucia.ts`.

### 2.4 SSRF en `crawl:hours` (baja urgencia, runs en PC)

Hace fetch de URLs `website` de OSM (datos no confiables). Tiene mitigaciones
pero **no bloquea IPs privadas/loopback** antes de hacer la petición. Un tag
`website` malicioso podría forzar peticiones a hosts internos.

**Qué hacer:** Añadir resolución + bloqueo de rangos RFC-1918/loopback antes
del fetch. Prioridad baja porque corre en el PC mantenedor, no en el VPS.

---

## 3. Coste y recursos del VPS

### 3.1 Sin límites de recursos → riesgo de OOM = caída total

No hay `mem_limit`/`cpus` en los servicios de `docker-compose.prod.yml`. Un
pico de Postgres o el build del deploy puede consumir toda la RAM del VPS.

**Qué hacer:**
- Añadir `mem_limit` por servicio en `docker-compose.prod.yml`.
- Configurar swap en el VPS como red de seguridad.

### 3.2 Tuning de Postgres para VPS pequeño

Config por defecto no está dimensionada para RAM baja. Ajustar:
`shared_buffers`, `work_mem`, `effective_cache_size`, `max_connections`
(alinearlo con el pool `max: 10` ya configurado).

### 3.3 Endpoints costosos sin rate limiting

`/stores/clusters` y `/stores/map` hacen agregación PostGIS sin throttle. Un
bot scrapeando el dataset dispara CPU/latencia para usuarios reales.

**Qué hacer:** `@fastify/rate-limit` (sin Redis, en memoria) → barato y
suficiente para esta escala.

---

## 4. Observabilidad (ya maduro — huecos menores)

- **Alerta activa en 5xx sostenidos:** UptimeRobot ve `/health` arriba aunque
  los endpoints reales fallen. Añadir un monitor que toque `/stores/nearby` con
  coordenadas fijas detectaría fallos reales de BD.
- **`request-id` + logs estructurados** en la API (Fastify lo trae de serie).
  Útil para correlacionar errores cuando algo raro pase en producción.
- Sentry sigue siendo opcional; con logs estructurados + status codes vais
  servidos por ahora.

---

## 5. Seguridad: resumen priorizado

| # | Ítem | Urgencia |
|---|---|---|
| 1 | Rate limiting (`@fastify/rate-limit`) | Media |
| 2 | No-root en contenedor y VPS deploy user | Alta |
| 3 | `.dockerignore` `**/.env*` + verificar `.env.production` | Alta |
| 4 | CI con `pnpm audit` + Dependabot + secret scanning | Alta |
| 5 | Bloqueo SSRF en `crawl:hours` | Baja |
| 6 | `@fastify/helmet` para security headers en la API proxied | Media |

---

## Plan por fases

### Fase 1 — Red de seguridad (bajo riesgo, alto retorno)
- [ ] Workflow `ci.yml`: typecheck + test + audit como gate antes del deploy.
- [ ] Habilitar Dependabot para dependencias npm.
- [ ] Límites de recursos (`mem_limit`) en `docker-compose.prod.yml` + swap en VPS.
- [ ] `.dockerignore` excluye `.env*` + verificar/mover `.env.production`.

### Fase 2 — Cadena de release
- [ ] Build de imagen en CI → GHCR → deploy con `pull` + rollback por SHA tag.
- [ ] `USER node` en `Dockerfile.api`.
- [ ] Usuario `deploy` no-root en el VPS.

### Fase 3 — Hardening API
- [ ] `@fastify/rate-limit` en endpoints costosos.
- [ ] `@fastify/helmet`.
- [ ] Logs estructurados + `request-id` en la API.
- [ ] Monitor UptimeRobot adicional contra `/stores/nearby`.

### Fase 4 — Optimización VPS
- [ ] Compilar la API (imagen multi-stage, `node:22-slim`).
- [ ] Tuning de Postgres para RAM disponible.

### Fase 5 — Deuda de arquitectura (a largo plazo)
- [ ] Framework común de ingesta para los workers.
- [ ] Test de contrato API↔shared.
- [ ] Bloqueo SSRF en `crawl:hours`.
- [ ] `pg_dump` nocturno de feedback **antes** de lanzar esa función.
