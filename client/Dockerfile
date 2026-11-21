# Stage 1: build the React app
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first
COPY package*.json ./
RUN npm config set fetch-retries 5 && npm config set fetch-timeout 300000 && npm ci
COPY . .
RUN npm run build

# Stage 2: serve it with nginx
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
