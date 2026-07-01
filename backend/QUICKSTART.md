# SLOMS Backend — Quick Start

## Development (PostgreSQL localhost)

```bash
cp .env.dev .env
npm install
npm run prisma:generate
npm run start:dev
```

Ensure a PostgreSQL instance is running on `localhost:5432` and the database exists.

### Git hooks (one-time, per clone)

`core.hooksPath` isn't versioned by git, so each clone needs to opt in once:

```bash
git config core.hooksPath .githooks
```

This enables a pre-commit hook that runs `eslint --fix` + `prettier --write`
on staged `.ts` files (see `lint-staged` in `package.json`) — catches
formatting issues before they fail CI instead of after.

## Production

```bash
cp .env.prod .env
# Edit .env with actual credentials
npm run build
npm start
```

---

**Notes:**
- API available at `http://localhost:3000/api`
- Swagger UI at `http://localhost:3000/api/docs`
- Startup logs print the connected database URL (password masked)
- Both dev and prod use PostgreSQL — default port `5432`
