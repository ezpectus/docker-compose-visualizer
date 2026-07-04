export const SAMPLE_YAML = `services:
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - api
      - web
    networks:
      - frontend

  web:
    image: node:22-alpine
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      API_URL: http://api:8000
    depends_on:
      - api
    networks:
      - frontend

  api:
    build: ./api
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
      REDIS_URL: redis://cache:6379
    depends_on:
      - db
      - cache
    networks:
      - frontend
      - backend

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - backend

  cache:
    image: redis:7-alpine
    networks:
      - backend

networks:
  frontend:
  backend:

volumes:
  pgdata:
`;
