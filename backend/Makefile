# 1. Build the Docker image (from project root)
docker-compose build --no-cache

# 2. Start the container in detached mode
docker-compose up -d

# 3. View container logs
docker-compose logs -f app

# 4. Check container status
docker-compose ps -a

# 5. Stop and remove container
docker-compose down

# Test root endpoint (returns 404 - expected)
curl http://localhost:3000

# Test API base endpoint (returns 404 - expected)
curl http://localhost:3000/api

# Test Swagger UI (API documentation)
curl http://localhost:3000/api/docs
