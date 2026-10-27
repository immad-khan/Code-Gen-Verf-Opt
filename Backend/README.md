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

### POST /api/verification

Runs 7-technique real execution verification (AST parsing, Import resolution, Pytest suite, Isolated runtime, Mypy type checking, Radon complexity, Semgrep security).

Request body:
```json
{
  "files": [ ... ]
}
```

### POST /api/optimization/repair

Executes the Dou et al. 2026 methodology:
1. **Taxonomy Diagnosis**: Maps verification issues to Dou et al. taxonomy (Type A: Syntax A.1–A.3, Type B: Runtime B.1–B.5, Type C: Functional C.1–C.4).
2. **Self-Critique Repair Loop**: Carries machine-verified compiler feedback and category guidance into repair prompts.
3. **2 Iterations Budget**: Bounded k=2 repair loop tracking bug evolution across iterations and calculating Repair Success Rate (RSR).

Request body:
```json
{
  "files": [ ... ],
  "originalPrompt": "Prompt description",
  "apiSettings": { ... },
  "verificationResult": { ... },
  "maxIterations": 2
}
```

## Swagger UI

You can access the Swagger UI at `http://localhost:5000/swagger` for testing the API.
