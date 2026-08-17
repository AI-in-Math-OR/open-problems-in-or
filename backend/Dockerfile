FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV UPLOAD_DIR=/data/uploads
ENV PYTHONUNBUFFERED=1

EXPOSE 8081

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8081}"]
