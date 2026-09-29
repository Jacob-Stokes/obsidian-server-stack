FROM node:22.22.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/server.mjs ./server.mjs
COPY src/frontmatter.mjs ./frontmatter.mjs
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
