FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -e . && \
    pip install --no-cache-dir uvicorn starlette
EXPOSE 3000
CMD ["python", "-m", "yahoo_finance_server", "--transport", "http", "--host", "0.0.0.0", "--port", "3000"]
