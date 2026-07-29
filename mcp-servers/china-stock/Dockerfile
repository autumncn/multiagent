FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server code
COPY china_stock_server.py .

# Expose MCP HTTP port
EXPOSE 3001

# Run the MCP server
CMD ["python", "-m", "china_stock_server", "--transport", "http", "--host", "0.0.0.0", "--port", "3001"]
