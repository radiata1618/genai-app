FROM node:22-alpine

WORKDIR /app

# Windows + Docker ボリュームでも変更を拾いやすくする
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
ENV NEXT_WEBPACK_USEPOLLING=1

# 依存だけイメージに入れる
COPY package*.json ./
RUN npm install

# dev 用なのでソースは COPY しない（ホストをマウントする）

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]