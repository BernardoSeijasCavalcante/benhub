FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

# Install dependencies including python/make/g++ for better-sqlite3 native compilation if needed
RUN apk add --no-cache python3 make g++ && \
    npm install && \
    apk del python3 make g++

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
