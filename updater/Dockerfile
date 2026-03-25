FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-buildx docker-cli-compose tar

WORKDIR /app

COPY updater/package.json ./package.json
COPY updater/server.js ./server.js

CMD ["node", "/app/server.js"]
