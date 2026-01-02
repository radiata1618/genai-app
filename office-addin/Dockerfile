FROM node:20-slim

WORKDIR /app

# Install global tools
RUN npm install -g office-addin-dev-certs office-addin-debugging

# Copy project files
COPY package.json .
RUN npm install

COPY . .

# Generate certs inside container but DO NOT try to install them to system trust store (which needs sudo)
# We just need the files to exist.
RUN npx office-addin-dev-certs install --days 365 || true

EXPOSE 3000

CMD ["npm", "start"]
