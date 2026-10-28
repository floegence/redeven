# Build scripts/build_center.sh output for Linux before building this image.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 redeven-center \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin redeven-center \
    && install -d -o 10001 -g 10001 -m 0700 /var/lib/redeven-center \
    && useradd --uid 10002 --gid 10001 --no-create-home --shell /usr/sbin/nologin redeven-connector \
    && install -d -o 10002 -g 10001 -m 0750 /run/redeven-connector
COPY --chown=10001:10001 redeven-center /opt/redeven-center/redeven-center
COPY --chown=10001:10001 ui/ /opt/redeven-center/ui/
USER 10001:10001
EXPOSE 8443
ENTRYPOINT ["/opt/redeven-center/redeven-center"]
CMD ["serve", "--state-root", "/var/lib/redeven-center", "--listen", "0.0.0.0:8443", "--assets", "/opt/redeven-center/ui", "--connector-socket", "/run/redeven-connector/connector.sock", "--connector-user", "10002"]
