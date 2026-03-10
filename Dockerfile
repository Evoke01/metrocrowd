FROM python:3.11.8-slim

WORKDIR /app

COPY metrocrowd-api/requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

COPY metrocrowd-api/ .

CMD uvicorn main:app --host 0.0.0.0 --port $PORT
