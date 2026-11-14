FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir \
    pytest==8.3.5 \
    mypy==1.15.0 \
    radon==6.0.1 \
    semgrep==1.185.0 \
    numpy \
    scipy

WORKDIR /sandbox
