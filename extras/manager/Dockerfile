# The manager add-on: obsidian-stack, run on request from obsidian-mcp. It
# needs the Docker CLI with Compose (from the official docker:cli image) and
# the few tools obsidian-stack itself uses.
FROM docker:28-cli
RUN apk add --no-cache bash python3 openssl curl coreutils findutils gawk grep sed iproute2 ncurses
COPY manager.py /manager/manager.py
ENTRYPOINT ["python3", "/manager/manager.py"]
