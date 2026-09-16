FROM node:22-alpine
WORKDIR /app
COPY src/mock/server.mjs /app/server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
