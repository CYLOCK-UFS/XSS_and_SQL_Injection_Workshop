FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY database ./database
COPY src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
