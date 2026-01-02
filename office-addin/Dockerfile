FROM node:20-slim

WORKDIR /app

# Install global tools
RUN npm install -g office-addin-dev-certs office-addin-debugging

# Copy project files
COPY package.json .
RUN npm install

COPY . .

# Generate certs inside container (Note: Host browser needs to trust this, 
# or we use a volume to persist certs created on host if possible. 
# For now, we generate in container and user trusts the URL manually)
RUN npx office-addin-dev-certs install --machine

EXPOSE 3000

CMD ["npm", "start"]
