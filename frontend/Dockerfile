# Production Dockerfile for A4C-FrontEnd React Application
# Expects dist/ folder to be pre-built by GitHub Actions workflow
# This avoids needing the infrastructure/ directory in Docker context

FROM nginx:alpine AS production

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy nginx configuration files
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf

# Copy pre-built React application (built by GitHub Actions workflow)
COPY dist /usr/share/nginx/html

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Expose port 80
EXPOSE 80

# Run nginx
CMD ["nginx", "-g", "daemon off;"]