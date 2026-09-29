FROM alpine:3.20

RUN apk add --no-cache git openssh-client \
    && addgroup -g 1000 vault \
    && adduser -u 1000 -G vault -h /home/vault -s /bin/sh -D vault

COPY --chown=1000:1000 entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER 1000:1000
ENV HOME=/home/vault
ENTRYPOINT ["/entrypoint.sh"]
