# osmium-tool for local OSM .pbf filtering/export (ADR-007, full-Spain path).
# Built once; the worker runs it via `docker run`. See docs/13 / the OSM pipeline.
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends osmium-tool ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["osmium"]
