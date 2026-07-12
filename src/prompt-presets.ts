export interface PromptPreset {
  id: string;
  title: string;
  description: string;
  category: string;
  prompt: string;
}

export const PRESET_PROMPTS: PromptPreset[] = [
  {
    id: 'py-library-api',
    title: 'FastAPI Library Management API',
    description: 'Python FastAPI service with SQLAlchemy, JWT auth, member lookup, book reservations, and pytest coverage.',
    category: 'Python · FastAPI',
    prompt: 'Generate a complete Python FastAPI Library Management API using SQLAlchemy and Pydantic. Include routers, services, models, schemas, database session, and pytest tests. Then audit the generated Python code with Ruff, Bandit, mypy, and pip-audit across all 12 techniques.'
  },
  {
    id: 'py-ecommerce-api',
    title: 'E-Commerce Order Service',
    description: 'Python FastAPI checkout microservice with Stripe, Pydantic validation, and async SQLAlchemy.',
    category: 'Python · Microservice',
    prompt: 'Build a Python FastAPI e-commerce order service with cart validation, Stripe payment processing, async SQLAlchemy transactions, and Hypothesis property tests. Audit for SQL injection, hardcoded secrets, and dependency CVEs.'
  },
  {
    id: 'py-ml-pipeline',
    title: 'ML Data Ingestion Pipeline',
    description: 'Python pandas + scikit-learn feature pipeline with typed dataclasses and pytest fixtures.',
    category: 'Python · Data/ML',
    prompt: 'Create a Python data ingestion and feature engineering pipeline using pandas and scikit-learn with typed dataclasses, config via pydantic-settings, and pytest. Audit for unsafe deserialization, eval usage, and pandas performance anti-patterns.'
  },
  {
    id: 'py-flask-portal',
    title: 'Flask Patient Record Portal',
    description: 'Python Flask REST API with SQLAlchemy, role-based auth, Fernet encryption, and audit logging.',
    category: 'Python · Healthcare',
    prompt: 'Develop a secure Python Flask patient record API with JWT auth, cryptography.Fernet encryption at rest, prescription endpoints, and pytest. Audit for PII logging, weak crypto, and injection sinks.'
  }
];
