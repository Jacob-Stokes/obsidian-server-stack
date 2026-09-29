# Obsidian's own official headless client for Obsidian Sync, installed
# straight from npm — same distribution channel Obsidian publishes it
# through. Nothing here is a fork or copy of anyone else's packaging.
# See ../../THIRD_PARTY_NOTICES.md.
FROM node:22-alpine

RUN npm install --global obsidian-headless@0.0.14 \
    && (deluser --remove-home node 2>/dev/null || true)

RUN addgroup -g 1000 obsidian \
    && adduser -u 1000 -G obsidian -h /home/obsidian -s /bin/sh -D obsidian \
    && mkdir -p /vault /data/config /home/obsidian/.config \
    && chown -R 1000:1000 /vault /data /home/obsidian

WORKDIR /app
COPY --chown=1000:1000 entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV HOME=/home/obsidian
ENV XDG_CONFIG_HOME=/data/config
USER 1000:1000
ENTRYPOINT ["/app/entrypoint.sh"]
