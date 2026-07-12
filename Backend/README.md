# MACI C# Backend

This is the C# ASP.NET Core backend for the MACI app.

## Prerequisites

- .NET 9.0 SDK installed

## Running the Backend

1. Navigate to the Backend directory:
   ```bash
   cd Backend
   ```

2. Restore dependencies:
   ```bash
   dotnet restore
   ```

3. Run the backend:
   ```bash
   dotnet run
   ```

The backend will start at `http://localhost:5000`

## API Endpoints

### POST /api/ai/process

Processes a prompt and returns generated code files.

Request body:
```json
{
  "prompt": "Your prompt here",
  "apiSettings": {
    "provider": "groq",
    "apiKey": "your-api-key",
    "model": "llama-3.3-70b-versatile"
  }
}
```

Response:
```json
{
  "files": [
    {
      "name": "main.py",
      "path": "app/main.py",
      "language": "python",
      "content": "...",
      "description": "...",
      "category": "config"
    }
  ]
}
```

## Swagger UI

You can access the Swagger UI at `http://localhost:5000/swagger` for testing the API.
