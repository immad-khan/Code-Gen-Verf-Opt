# VeriFlow: Complete Project File Structure & Architectural Blueprint

This document contains the complete folder structure and an exhaustive file-by-file inventory of the **VeriFlow** project. For every directory and file, it details **what it is**, **why it sits in that location**, and **how it fits into the broader verification and repair pipeline**.

---

## 1. High-Level Architecture Overview

VeriFlow is an automated Python code generation, multi-stage static/dynamic verification, and iterative LLM program repair system built upon the empirical taxonomy of **Dou et al.** and enhanced with multi-source diagnostic feedback.

The system is organized into distinct subsystems:
- **`Backend/`**: ASP.NET Core 10 Web API powering real-time code synthesis, Docker sandbox orchestration, AST/Pytest/Mypy/Radon/Semgrep verification handlers, taxonomy classification, and the research repair engine.
- **`Backend.Tests/`**: Automated xUnit test suite (321+ unit tests) validating LLM provider integrations, code block extractors, test step locking, canonical hashing, and repair prompt fidelity.
- **`Maci.ExperimentRunner/`**: Standalone, headless .NET console runner designed for high-throughput batch evaluation across 1,163 benchmark problems (HumanEval+, MBPP+, APPS+).
- **`src/`**: Modern React 19 + TypeScript + Vite + Tailwind CSS single-page web workbench demonstrating the live panel workflow (`Prompt -> Interface -> Tests (Lock) -> Code -> Verify -> Repair`).
- **`landing_page/`**: Production marketing showcase and multi-step authentication portal.
- **`Docker/`**: Docker build context defining `veriflow-sandbox:3.11`, an isolated, non-networked runtime container for safe Python execution.
- **`data/`**: Canonical benchmark datasets (HumanEval+, MBPP+, APPS+), SQLite experiment databases, and curated viva demo candidate logs.
- **`shared/`**: JSON schema contracts (`taxonomy.v1.json`, `taxonomy_conformance.json`) ensuring strict cross-runtime consistency between .NET and Python.
- **`scripts/`**: Automation scripts for full canonical validation, candidate extraction, and report generation.
- **`tivr/`**: Python reference package containing the baseline taxonomy mapper, hypothesis property tests, and metric evaluation routines.

```
MACI/
├── Backend/                    # ASP.NET Core 10 Web API & Core Engine
│   ├── Controllers/            # HTTP endpoints (AI, Benchmark, Verification, Repair, Auth)
│   ├── Data/                   # Entity Framework Core database context & entities
│   ├── Models/                 # DTOs, request/response models, and taxonomy types
│   └── Services/               # Core business logic & processing engines
│       ├── Experiments/        # Batch execution and process monitoring
│       ├── Repair/             # Dou et al. & Improved repair prompt engines
│       ├── Taxonomy/           # Taxonomy definition loaders & template renderers
│       └── Verification/       # Chain-of-responsibility verification pipeline & Docker handlers
├── Backend.Tests/              # 321+ xUnit tests for the .NET backend
├── Maci.ExperimentRunner/      # Headless CLI benchmark runner for HumanEval+, MBPP+, APPS+
├── src/                        # React 19 / TypeScript / Vite frontend workbench
│   ├── api/                    # HTTP client configuration & endpoint routes
│   ├── components/             # UI components and 6-step viva demo views
│   ├── lib/                    # Comparison algorithms & paper reference models
│   ├── services/               # Frontend API service adapters
│   ├── state/                  # Context providers and reactive state stores
│   └── utils/                  # String formatting and line diff utilities
├── landing_page/               # Marketing portal & authentication flow
├── Docker/                     # Docker sandbox definitions (veriflow-sandbox:3.11)
├── data/                       # Datasets, SQLite experiment stores & demo problem logs
├── shared/                     # Universal JSON schemas for taxonomy & conformance
├── scripts/                    # Maintenance, validation, and data export scripts
├── tivr/                       # Python reference implementation & test suite
└── Root Configuration Files    # Vite, Tailwind, TypeScript, Solution, and CI files
```

---

## 2. Root Configuration & Deployment Files

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `VeriFlow.slnx` | Modern XML-based .NET Solution file linking `Backend.csproj`, `Backend.Tests.csproj`, and `Maci.ExperimentRunner.csproj`. | Solution root: allows building and running all .NET projects with a single `dotnet build` or inside Visual Studio / JetBrains Rider. |
| `package.json` | Node.js project manifest defining frontend dependencies (React 19, Lucide, Tailwind, Vite) and build scripts (`dev`, `build`, `lint`). | Project root: standard entry point for Node package management and Vite frontend tooling. |
| `package-lock.json` | Deterministic lockfile for npm dependencies ensuring reproducible builds across development and CI. | Project root: guarantees identical dependency trees across environments. |
| `tsconfig.json` | Root TypeScript compiler configuration defining path aliases, strict type checking, and JSX compilation rules. | Project root: standard TypeScript config consumed by IDEs, language servers, and Vite. |
| `vite.config.ts` | Configuration for Vite build tool and dev server (plugins, server ports, proxy rules, single-file bundling). | Project root: Vite's root configuration file. |
| `Dockerfile` | Multi-stage production container build for deploying the unified web application. | Project root: standard location for container image builds in deployment pipelines (e.g. Render, Railway). |
| `.dockerignore` | Prevents unnecessary build artifacts (`node_modules`, `bin/`, `obj/`, `.git`) from being copied into Docker build contexts. | Project root: optimizes Docker build speed and container layer sizes. |
| `.gitignore` | Excludes temporary build files, IDE metadata, database files, and secrets from version control. | Project root: git version control exclusion contract. |
| `.env` | Local environment variables for developer secrets (OpenRouter API keys, Groq keys, port overrides). | Project root: automatically loaded by Vite and local runner processes. |
| `pytest.ini` | Pytest global configuration file specifying test discovery paths, warning filters, and custom markers. | Project root: standard configuration file for running root-level or sandbox pytest commands. |
| `requirements-dev.txt` | Python development requirements (pytest, mypy, radon, semgrep, hypothesis, astor). | Project root: used to configure the host or CI Python environment for development. |
| `requirements-prepare.txt`| Python dependencies required for benchmark dataset extraction, decompression, and preparation. | Project root: isolates dataset download/preparation dependencies from core runtime dependencies. |
| `run_config.json` | Global configuration file defining LLM model parameters, temperature, token limits, and benchmark targets. | Project root: central configuration file shared across batch scripts and experimental runs. |
| `vercel.json` | Vercel platform deployment manifest defining route rewrites, headers, and SPA static fallbacks. | Project root: used when deploying the frontend single-page application to Vercel. |
| `BASE PAPER.pdf` | The foundational research paper (*"Automatic Program Repair via Multi-Turn Self-Critique"* by Dou et al.). | Project root: canonical reference document for the theoretical foundation and bug taxonomy. |
| `base_paper_text.txt` | Plain-text transcription of the base research paper for fast programmatic search and verification. | Project root: developer and agent reference for taxonomy formulas, prompts, and empirical tables. |
| `implementation_plan.md` | Master technical specification and phased architectural plan for the VeriFlow project. | Project root: persistent roadmap detailing milestones, phase definitions, and constraints. |
| `project_walkthrough.md` | Comprehensive walkthrough explaining the core concepts, verification stages, and repair loops. | Project root: developer onboarding and technical documentation. |
| `usecases_classes_specification.md` | Detailed class diagrams, domain model specifications, and UML use case definitions. | Project root: software engineering design reference for backend interfaces and data structures. |

---

## 3. Backend Subsystem (`Backend/`)

The ASP.NET Core 10 backend provides high-performance API endpoints, thread-safe memory stores, Docker sandbox orchestration, and the core repair engine.

### 3.1. Project Root Files
- **`Backend/Backend.csproj`**: C# project manifest defining .NET 10 target, nullable reference types, NuGet dependencies (`Microsoft.AspNetCore.OpenApi`, `System.Text.Json`, `Microsoft.EntityFrameworkCore.Sqlite`), and shared JSON file linkages.
- **`Backend/Program.cs`**: Web application bootstrap and dependency injection root. Registers controllers, CORS policies, HTTP clients for 6 LLM providers, `IDockerSandbox`, `ILockedTestStore`, `ITestGenerationService`, `IBenchmarkDatasetService`, and the verification pipeline.
- **`Backend/appsettings.json`**: Runtime configuration specifying LLM provider base URLs, default models, temperature profiles (`SendTemperature`, `MaxOutputTokens`), and connection strings.
- **`Backend/requirements.txt`**: Python dependencies required inside backend worker environments.
- **`Backend/README.md`**: Backend service overview, API documentation, and startup instructions.

### 3.2. Controllers (`Backend/Controllers/`)
- **`AiController.cs`**:
  - `POST /api/ai/process`: Synthesizes code via LLM in fenced ```python blocks (prompt + confirmed interface only, never tests).
  - `POST /api/ai/interface`: Extracts contract (`NAME`, `SIGNATURE`, `DOC`) from requirements using lightweight parsing.
  - `POST /api/ai/tests`: Generates pytest test cases from prompt + interface (zero access to solution code).
  - `POST /api/ai/tests/validate`: Executes pre-lock Docker checks (`ast.parse`, `pytest --collect-only`, stub execution).
  - `POST /api/ai/tests/lock`: Locks tests with canonical SHA-256 hash in `LockedTestStore`.
- **`BenchmarkController.cs`**:
  - `GET /api/benchmark/problems`: Lists benchmark problems with filtering by tier (HumanEval+, MBPP+, APPS+).
  - `GET /api/benchmark/problems/{benchmark}/{problemId}`: Returns problem prompt, interface, test count, preview of first 5 tests, and pre-locks tests in `LockedTestStore`.
- **`VerificationController.cs`**:
  - `POST /api/verification`: Executes multi-stage verification in Docker against `lockedTestHash`. Rejects mismatched or missing hashes.
- **`OptimizationController.cs`**:
  - `POST /api/optimization/repair`: Runs iterative repair ($k=2$) in `dou` or `improved` mode against locked tests.
  - `POST /api/optimization/compare`: Executes shared Round 0 followed by parallel `dou` and `improved` branches.
- **`AuthController.cs`**:
  - `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/otp`: Authentication and user management endpoints.
- **`HealthController.cs`**:
  - `GET /api/health`: Health probe reporting Docker daemon availability, sandbox image presence, and system status.

### 3.3. Core Business Services (`Backend/Services/`)
- **`AiService.cs`**: Orchestrates LLM communication across all 6 supported providers (`openrouter`, `openai`, `deepseek`, `groq`, `anthropic`, `gemini`). Manages model profiles, empty content handling for reasoning models, and authorization headers.
- **`ILlmClient.cs`**: Interface and behavioral profile definitions (`ModelProfile`) specifying per-model temperature sending rules and token limits.
- **`BenchmarkDatasetService.cs`**: Direct filesystem loader for HumanEval+, MBPP+, and APPS+ datasets. Formats APPS+ stdin/stdout test harnesses and extracts preview test blocks.
- **`IDockerSandbox.cs` & `DockerSandbox.cs`**: Safe Docker container process launcher executing commands inside `veriflow-sandbox:3.11` with memory limits, CPU quotas, `--network none`, and automatic cleanup.
- **`TestHashUtility.cs`**: Universal SHA-256 calculation utility operating over normalized text (UTF-8, LF line endings, trimmed end). Shared across UI and CLI.
- **`LockedTestStore.cs`**: Thread-safe in-memory cache of locked test suites keyed by SHA-256 hash. Enforces strict read-only immutability.
- **`TestGenerationService.cs`**: Generates isolated pytest suites from prompt + interface, executes Docker sanity checks, builds stub solutions, detects vacuous tests that pass on stubs, and locks test suites.
- **`FencedCodeBlockParser.cs`**: Robust parser for single-file (`solution.py`) and multi-file (`### File: path`) fenced Markdown blocks.
- **`InterfaceDefinitionParser.cs`**: Fast, non-JSON line parser extracting `NAME: ...`, `SIGNATURE: ...`, `DOC: ...` into structured `InterfaceDefinition` records.
- **`OptimizationService.cs`**: High-level coordinator for repair iterations, budget tracking, and summary calculation.
- **`VerificationService.cs`**: Facade delegating verification requests to the Chain of Responsibility verification pipeline.
- **`KeepAliveService.cs`**: Background worker preventing container or server idle timeouts on cloud hosting platforms.

### 3.4. Repair Engine (`Backend/Services/Repair/`)
- **`RepairPromptBuilder.cs`**: Constructs repair critique prompts. In `dou` mode: adheres strictly to the paper's Figure 6 prompt and feedback rules. In `improved` mode: injects tagged sections (`[visible-test-detail]`, `[prompt-only]`, `[static-analysis]`, `[history]`).
- **`RepairFiles.cs`**: Utility filtering editable source files from read-only test files and formatting file paths.
- **`RepairAccounting.cs`**: Token counting, reasoning token tracking, and cost accounting per repair iteration.
- **`RepairRequestValidator.cs`**: Validates incoming repair requests to ensure locked tests are untouched and files are well-formed.
- **`RepairResponseParser.cs`**: Extracts repaired code blocks from LLM responses and maps them back to the active files.

### 3.5. Verification Chain of Responsibility (`Backend/Services/Verification/`)
- **`IVerificationPipeline.cs` & `VerificationPipeline.cs`**: Coordinates the sequential execution of verification handlers.
- **`VerificationContext.cs`**: Shared execution context passed through the pipeline, containing files, execution results, findings, and timings.
- **`IVerificationHandler.cs`**: Base interface for all modular verification checks.
- **`SyntaxAstVerificationHandler.cs`**: Runs `python3 -m py_compile` and `ast.parse` in Docker to catch Type A (Syntax) bugs immediately.
- **`ImportVerificationHandler.cs`**: Inspects module imports and detects missing or hallucinated third-party dependencies.
- **`PytestVerificationHandler.cs`**: Executes pytest against the solution code, capturing failing test names, tracebacks, and assertion differences.
- **`RuntimeTraceVerificationHandler.cs`**: Traces execution errors (Type B: ZeroDivisionError, IndexError, KeyError, TypeError).
- **`MypyVerificationHandler.cs`**: Runs static type analysis using Mypy to catch type mismatches and invalid method invocations.
- **`RadonVerificationHandler.cs`**: Computes cyclomatic complexity and maintainability index metrics.
- **`SemgrepVerificationHandler.cs`**: Executes local, offline Semgrep rules in Docker to flag security flaws and antipatterns.
- **`PythonToolHealthService.cs` & `PythonToolStartupValidator.cs`**: Validates that all verification tools (pytest, mypy, radon, semgrep) are installed and accessible inside the Docker environment.
- **`VerificationPythonScripts.cs`**: Inlined Python helper scripts executed inside the sandbox for AST extraction and tracing.

### 3.6. Taxonomy Services (`Backend/Services/Taxonomy/`)
- **`TaxonomyDefinition.cs`**: C# data structure representing the Dou et al. 3-level hierarchical bug taxonomy (Type A: Syntax, Type B: Runtime, Type C: Functional).
- **`TaxonomyDefinitionLoader.cs`**: Reads `shared/taxonomy.v1.json` to load canonical bug types and feedback templates.
- **`TaxonomyMapper.cs`**: Maps verification findings and compiler tracebacks to specific taxonomy codes (e.g. A.1, B.3, C.1).
- **`TaxonomyProvider.cs`**: Service providing the cached taxonomy definition and mapper instances across the backend.
- **`PromptRenderer.cs`**: Template rendering engine substituting `{solution}`, `{error log}`, `{checklist}`, and `{evidence_block}` into prompt templates.

### 3.7. Models & Data Entities (`Backend/Models/`, `Backend/Data/`)
- **`InterfaceDefinition.cs`**: Contract model storing `Name`, `Signature`, `Docstring`, and `IsStdinStdout`.
- **`TestStepModels.cs`**: DTOs for `GenerateTestsRequest`, `ValidateTestsRequest`, `ValidateTestsResponse`, `LockTestsRequest`, `LockTestsResponse`.
- **`CodeGenerationException.cs`**: Exception thrown when fenced code extraction fails, carrying the raw LLM response for UI inspection.
- **`GeneratedCodeFile.cs`**: Represents a synthesized code file (`Name`, `Path`, `Content`, `Category`).
- **`ProcessPromptRequest.cs`**: DTO for prompt submission carrying requirements, interface, and model settings.
- **`RunResult.cs`**: Complete execution trajectory model tracking problem metadata, locked test hash, rounds, token usage, and verdict.
- **`VerificationModels.cs` & `LegacyVerificationModels.cs`**: Output models containing check statuses, metrics, and findings.
- **`OptimizationModels.cs` & `LegacyOptimizationModels.cs`**: DTOs representing repair iterations, critiques, bug evolutions, and summaries.
- **`ApiSettings.cs`**: Client provider configuration (`Provider`, `ApiKey`, `Model`, `CustomEndpoint`).
- **`AppDbContext.cs` & `DatabaseConfiguration.cs`**: Entity Framework Core database context and SQLite configuration for historical runs.
- **`AuditGenerationEntity.cs`, `OptimizationEntity.cs`, `UserEntity.cs`, `VerificationEntity.cs`**: Persistent database records.

---

## 4. Backend Unit Tests (`Backend.Tests/`)

xUnit test project containing 321 automated tests ensuring 100% regression safety.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `Backend.Tests.csproj` | Test project file referencing `Backend.csproj`, xUnit 2.9, and `Microsoft.AspNetCore.Mvc.Testing`. | `Backend.Tests/` root: standard .NET test project configuration. |
| `LlmClientTests.cs` | Validates HTTP payloads, headers, reasoning tokens, and error handling for all 6 providers (OpenRouter, OpenAI, Groq, Anthropic, Gemini, DeepSeek). | Validates Phase A provider integrations with mock HTTP message handlers. |
| `GenerationPhaseBTests.cs` | Tests generation prompt isolation, fenced block parsing, single retry behavior, raw response extraction, and 422 HTTP responses. | Validates Phase B generation behavior and error handling. |
| `FencedBlockParserTests.cs` | Unit tests for single-file extraction, multi-file parsing (`### File: path`), and handling of nested backticks. | Unit tests for `FencedCodeBlockParser.cs`. |
| `InterfaceDefinitionParserTests.cs`| Unit tests parsing `NAME:`, `SIGNATURE:`, and `DOC:` lines from LLM responses across varied formatting. | Unit tests for `InterfaceDefinitionParser.cs`. |
| `TestStepPhaseCTests.cs` | Validates canonical SHA-256 normalization, `LockedTestStore` integrity, Docker stub sanity checks, pre-lock warnings, and benchmark loaders. | Validates Phase C test review, locking, and dataset endpoints. |
| `RepairPromptBuilderTests.cs` | Ensures `dou` mode prompts match Figure 6 exactly, tests are excluded, and compiler feedback rules are respected. | Research engine fidelity tests for `RepairPromptBuilder.cs`. |
| `RepairRequestValidatorTests.cs` | Tests rejection of tampered locked test suites, missing files, or invalid iterations. | Security and integrity tests for repair requests. |
| `RepairAccountingTests.cs` | Verifies token accounting, cost calculations, and latency tracking. | Unit tests for `RepairAccounting.cs`. |
| `RepairResponseParserTests.cs` | Tests extraction of repaired code blocks from LLM repair outputs. | Unit tests for `RepairResponseParser.cs`. |
| `TaxonomySmokeTests.cs` | Tests loading of `shared/taxonomy.v1.json`, category mapping, and prompt template rendering. | Unit tests for taxonomy definitions and renderers. |
| `SharedFilesTests.cs` | Verifies that shared JSON schema files are properly linked and copied to build output directories. | Conformance tests for shared data contracts. |
| `EvidenceDemonstratorTests.cs` | Validates end-to-end evidence generation for multi-stage verification results. | Integration tests for verification evidence output. |
| `ExperimentsCatalogTests.cs` & `ExperimentRunServiceTests.cs` | Tests for batch experiment discovery, run catalogs, and process launchers. | Unit tests for experiment management services. |
| `OptimizationModelsSerializationTests.cs` & `VerificationModelsSerializationTests.cs` | Validates JSON serialization and deserialization compatibility between backend and frontend DTOs. | Data contract compatibility tests. |

---

## 5. Headless Experiment Runner (`Maci.ExperimentRunner/`)

A high-performance CLI tool designed for automated, unattended batch evaluation across benchmark suites without web server overhead.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `Maci.ExperimentRunner.csproj` | .NET 10 console application project referencing `Backend.csproj`. | `Maci.ExperimentRunner/` root: project file for CLI runner. |
| `Program.cs` | Command-line entry point parsing arguments (`--benchmark`, `--model`, `--provider`, `--mode`, `--limit`, `--k`). | CLI execution coordinator. |
| `run_config.json` | Runner-specific configuration defaults (model profiles, timeouts, database paths). | Local configuration file for CLI runs. |
| `Config/ExperimentConfig.cs` | Strongly-typed options class mapping CLI flags and configuration files. | Configuration management. |
| `Datasets/IBenchmarkDataset.cs` | Common interface for benchmark dataset loaders. | Polymorphic dataset abstraction. |
| `Datasets/HumanEvalPlusDataset.cs` | Dataset loader for HumanEval+ (164 coding tasks with extended inputs). | Specialized loader for HumanEval+. |
| `Datasets/MbppPlusDataset.cs` | Dataset loader for MBPP+ (399 tasks). | Specialized loader for MBPP+. |
| `Datasets/AppsPlusDataset.cs` | Dataset loader for APPS+ (600 tasks across introductory, interview, competition tiers). | Specialized loader for APPS+. |
| `Datasets/BenchmarkProblem.cs` | Universal benchmark problem model (`ProblemId`, `Prompt`, `EntryPoint`, `Tests`, `Difficulty`). | Shared data model for benchmark tasks. |
| `Execution/ExperimentEngine.cs` | Core batch execution loop: iterates over problems, synthesizes code, runs Docker verification, and triggers repairs. | Main engine orchestrating batch experiments. |
| `Execution/PromptBuilder.cs` | Builds benchmark generation and repair prompts. | Prompt generation for the CLI runner. |
| `Execution/CodeExtractor.cs` | Extracts Python code blocks from LLM generation and repair responses. | Response parsing in the CLI runner. |
| `Execution/DeepSeekClient.cs` | Direct client for DeepSeek and OpenRouter reasoning models. | Dedicated LLM client for batch benchmarking. |
| `Sandbox/IDockerSandbox.cs` & `DockerSandbox.cs` | Executes containerized pytest and verification inside `veriflow-sandbox:3.11`. | Safe Docker isolation for benchmark execution. |
| `Storage/IExperimentStorage.cs` & `SqliteExperimentStorage.cs` | Persists run trajectories, token counts, error taxonomy classifications, and verdicts into `data/experiments.db`. | Database persistence layer for research results. |
| `Classification/BugClassifier.cs` | Classifies test failures into Dou et al. Taxonomy categories (A, B, C). | Failure classification in the runner. |

---

## 6. Frontend Subsystem (`src/`)

A React 19 single-page application built with TypeScript, Vite, and Tailwind CSS. Implements the 6-step live panel demonstration workflow.

### 6.1. Core Application Files
- **`src/main.tsx`**: React DOM application entry point rendering `<App />`.
- **`src/App.tsx`**: Main application state coordinator managing navigation across the 6 pipeline steps, active settings, locked test hashes, and backend API calls.
- **`src/types.ts`**: TypeScript type definitions defining all data structures (`PipelineStep`, `LockedTestSuite`, `InterfaceDefinition`, `BenchmarkProblemDetail`, `RunResult`, `ApiSettings`, `OptimizationResponse`).
- **`src/analyzer.ts`**: Client-side static analyzer implementing 12 inspection techniques (security, complexity, naming, style) for immediate offline feedback.
- **`src/prompt-presets.ts`**: Curated template library of common algorithms, REST utilities, and data structures.
- **`src/index.css`**: Tailwind CSS directives, custom CSS variables, and dark-theme color definitions.
- **`src/vite-env.d.ts`**: Vite environment type declarations.

### 6.2. Pipeline Step Components (`src/components/`)
- **`Step1Input.tsx`**: Step 1 component offering two modes: freeform requirement composer with presets, or tabbed benchmark dataset picker. Proposes target interface contracts.
- **`BenchmarkPicker.tsx`**: Live benchmark browser allowing selection from HumanEval+, MBPP+, or APPS+. Previews problem prompts, contract types, and first 5 read-only tests.
- **`Step2Interface.tsx`**: Step 2 component for contract review and editing (`NAME`, `SIGNATURE`, `DOC`, or stdin/stdout).
- **`StepTestsReview.tsx`**: Step 3 component for test review. Generates pytest suites (isolated from solution code), runs Docker sanity checks, detects stub-passing tests, locks with SHA-256, and allows unlocking for new runs.
- **`Step2CodeOutput.tsx`**: Step 4 component displaying synthesized code in fenced blocks with syntax highlighting and file tree navigation.
- **`Step3Verification.tsx`**: Step 5 component showing multi-check verification results (AST, Pytest, Mypy, Radon, Semgrep) against locked tests, bug taxonomy distribution, and overall verdicts.
- **`Step4Optimization.tsx`**: Step 6 component providing the repair workbench (Dou et al. baseline vs Improved mode vs Compare side-by-side) with diff viewers, prompt inspectors, and token metrics.
- **`Step8FinalResults.tsx`**: Comparative evolution summary showing bug reduction across rounds, final code diffs, and verification metrics.
- **`PipelineNav.tsx`**: Sticky top navigation bar showing the 6 primary stages with active states, completion checks, and locked indicators.
- **`Header.tsx`**: Global header showing branding, user session, and persistent active provider and model badges.
- **`ApiSettingsModal.tsx`**: Modal for configuring API keys and models for all 6 providers with real connection test buttons.
- **`ExportModal.tsx`**: Modal allowing export of generated code, verification reports, and run results as Markdown or JSON.
- **`HistoryPage.tsx`**: Displays previous generation runs stored in local storage.
- **`ProfilePage.tsx`**: User profile and session management view.
- **`ProcessingOverlay.tsx`**: Full-screen modal overlay displaying live progress indicators and agent execution logs during background operations.
- **`VisualFileTree.tsx`**: Interactive visual file tree for navigating multi-file generated projects.
- **`PrintReport.tsx`**: Print-optimized stylesheet and layout for exporting PDF audit reports.
- **`PythonApiHarness.tsx`**: Debugging utility for testing raw backend endpoints directly from the browser.

### 6.3. Shared UI & Specialized Panels
- **`src/components/common/`**: Reusable atomic UI components (`Badge.tsx`, `DataTable.tsx`, `RetryButton.tsx`, `AsyncState.tsx`, `NotAvailable.tsx`).
- **`src/components/experiments/`**: Advanced batch experiment visualization views (`ExperimentsView.tsx`, `RunList.tsx`, `RunDetail.tsx`, `EvolutionMatrix.tsx`, `AblationTable.tsx`, `TrajectoryBrowser.tsx`, `StartRunForm.tsx`).
- **`src/components/inspector/`**: Deep-dive repair inspection components (`RepairInspector.tsx`, `FileDiff.tsx`, `IterationDetail.tsx`, `EvolutionChart.tsx`).
- **`src/components/shell/`**: Application shell layout, live accessibility regions, and offline status indicators (`AppShell.tsx`, `SectionNav.tsx`, `OfflineIndicator.tsx`, `LiveRegionProvider.tsx`).
- **`src/components/workbench/`**: Modular stage components for workbench-style navigation (`Stepper.tsx`, `GenerateStage.tsx`, `VerifyStage.tsx`, `DiagnoseStage.tsx`).

### 6.4. Services, State, & Utilities
- **`src/services/aiService.ts`**: Frontend API client for code generation, interface extraction, test generation, test locking, benchmark fetching, and provider ping tests.
- **`src/services/verificationService.ts`**: Frontend client calling `POST /api/verification` with `lockedTestHash`.
- **`src/services/optimizationService.ts`**: Frontend client calling `POST /api/optimization/repair` with mode, source flags, and locked test hash.
- **`src/state/workbench.ts` & `src/state/WorkbenchContext.tsx`**: React context managing stage progression, active code snapshots, and diagnostic findings.
- **`src/state/useHealth.ts` & `src/state/usePolling.ts`**: Hooks for backend health monitoring and background run polling.
- **`src/utils/diff.ts`**: Unified line-by-line diff algorithm highlighting changes between repair iterations.
- **`src/utils/cn.ts`**: Tailwind class name merging utility (`clsx` + `twMerge`).
- **`src/lib/compare.ts`**: Logic for side-by-side run result comparison.
- **`src/lib/paperReference.ts`**: Reference constants and empirical baseline figures from Dou et al.
- **`src/lib/repairSettings.ts`**: Configuration models for repair parameters and information sources.

---

## 7. Landing Page Sub-App (`landing_page/`)

A standalone marketing and authentication portal that seamlessly transfers authenticated sessions into the main VeriFlow workbench.

| Directory / File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `landing_page/package.json` | Package manifest for the landing page sub-app. | Sub-app root. |
| `landing_page/src/App.tsx` | Landing page layout rendering Hero, Features, Pipeline Demo, and Results. | Root view of the landing portal. |
| `landing_page/src/auth.ts` | Local session manager tracking user tokens, demo accounts, and login state. | Authentication logic shared with main app. |
| `landing_page/src/components/Hero.tsx` | High-impact hero section explaining VeriFlow's contract-first synthesis. | Landing page hero view. |
| `landing_page/src/components/Pipeline.tsx` | Interactive interactive visual demonstrating the 6-step pipeline. | Interactive product demonstration. |
| `landing_page/src/components/Techniques.tsx` | Overview of the 12 verification techniques and Dou et al. bug taxonomy. | Technical capability showcase. |
| `landing_page/src/components/Results.tsx` | Empirical results table highlighting repair success rates against baselines. | Scientific validation showcase. |
| `landing_page/src/components/AuthPage.tsx` | Full-screen authentication modal supporting Email/Password, OTP, Google, and GitHub. | Central authentication dialog. |
| `landing_page/src/components/auth/` | Modular authentication stepper components (`MethodStep.tsx`, `DetailsStep.tsx`, `OtpStep.tsx`, `ForgotStep.tsx`, `VerifiedScreen.tsx`). | Encapsulated login/registration workflow. |

---

## 8. Docker Sandbox Subsystem (`Docker/`)

Defines the isolated execution boundary ensuring no untrusted code ever runs on the host system.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `Docker/sandbox.Dockerfile` | Dockerfile building `veriflow-sandbox:3.11`. Installs Python 3.11, pytest, mypy, radon, and offline Semgrep rules. Configures non-root user and unbuffered I/O. | Central definition for the secure runtime container. |

---

## 9. Data Subsystem (`data/`)

Hosts benchmark problem definitions, raw test files, curated viva demo candidates, and historical experiment databases.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `data/humaneval_plus.jsonl` | 164 HumanEval+ coding problems with prompt, entry point, canonical solution, and 80x extended test inputs. | Primary algorithmic benchmark dataset. |
| `data/mbpp_plus.jsonl` | 399 MBPP+ programming problems with comprehensive pytest assertions. | Primary utility benchmark dataset. |
| `data/apps_plus_selected.jsonl` | 600 selected APPS+ problems across introductory, interview, and competition tiers with stdin/stdout test cases. | Complex competitive programming dataset. |
| `data/demo_problems.json` | Registry of real problems with notes ("passes first try", "fails dou, improved fixes") populated exclusively from real runs. | Source of truth for live panel demonstrations. |
| `data/experiments.db` | SQLite database storing trajectories, bug taxonomy classifications, token counts, and verdicts for all runs. | Persistent empirical experiment store. |
| `data/download_evalplus_datasets.py`| Python script downloading official EvalPlus releases and verifying checksums. | Dataset ingestion utility. |
| `data/sample_apps_plus.py` | Stratified sampling script selecting 600 balanced APPS+ problems. | Dataset preparation utility. |

---

## 10. Shared Data Contracts (`shared/`)

Universal JSON schema files referenced by both .NET and Python to prevent cross-language drift.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `shared/taxonomy.v1.json` | Canonical Dou et al. bug taxonomy definition: definitions, subcategories (A.1–C.1), prompt templates, and checklists. | Single source of truth for bug classifications and prompts. |
| `shared/taxonomy_conformance.json` | Golden test suite verifying that both .NET and Python map compiler tracebacks to identical taxonomy categories. | Cross-platform conformance verification contract. |

---

## 11. Automation Scripts (`scripts/`)

Python maintenance and report generation utilities.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `scripts/export_demo_candidates.py` | Scans `data/experiments.db` and exports real problem runs into `data/demo_problems.json` with execution metrics and dates. | Populates demo problems without manual data entry. |
| `scripts/validate_all_canonical.py` | Executes canonical solutions for all 1,163 problems inside Docker to establish a 99.8% baseline pass rate. | Dataset validation and environment sanity checking. |
| `scripts/generate_reports.py` | Aggregates database runs and outputs HTML and Markdown ablation and comparison reports into `reports/`. | Scientific reporting and table generation. |

---

## 12. Python Reference Prototype (`tivr/`)

The Python research package implementing Dou et al. and the TIVR reference pipeline.

| File | Purpose | Why It Sits Here |
| :--- | :--- | :--- |
| `tivr/taxonomy.py` & `taxonomy_def.py` | Python implementation of the 3-level bug taxonomy and JSON schema loader. | Reference taxonomy classification logic. |
| `tivr/verifier.py` & `verify_cli.py` | Standalone Python verification runner executing syntax, pytest, and lint checks. | Reference verification pipeline. |
| `tivr/prompts.py` | Python prompt builders for `dou_critique`, `generic_repair`, and `tivr_repair`. | Reference prompt rendering logic. |
| `tivr/repair_loop.py` | Python multi-turn critique and repair loop ($k=2$). | Reference repair loop implementation. |
| `tivr/llm_client.py` | Python client for LLM interaction with retry and token tracking. | Reference LLM client. |
| `tivr/tests/` | 35+ pytest and Hypothesis property-based tests verifying taxonomy mapping, schema validation, and prompt fidelity. | Python unit and property test suite. |

---

## 13. Summary Matrix by Subsystem

| Subsystem | Primary Language | Role in VeriFlow | Tests / Verification |
| :--- | :--- | :--- | :--- |
| **`Backend/`** | C# (.NET 10) | Real-time Web API, Sandbox Runner, Repair Engine | 321 xUnit tests in `Backend.Tests/` |
| **`Backend.Tests/`** | C# (.NET 10) | Unit and integration testing | `dotnet test` (100% green) |
| **`Maci.ExperimentRunner/`** | C# (.NET 10) | Headless batch evaluation across 1,163 problems | Validated via pilot runs and canonical checks |
| **`src/`** | TypeScript (React 19) | Interactive 6-step workbench for live demos | `npm run build` (0 errors, Vite bundle) |
| **`landing_page/`** | TypeScript (React 19) | Marketing portal and authentication flow | Bundled via Vite |
| **`Docker/`** | Dockerfile / Linux | Secure non-networked Python execution boundary | Verified via `com.docker.backend.exe` |
| **`data/`** | JSON / JSONL / SQLite | Datasets (1,163 problems) and trajectory storage | Verified with canonical validation script |
| **`shared/`** | JSON Schema | Single source of truth for taxonomy & prompts | Shared between .NET and Python |
| **`scripts/`** | Python 3 | Data export, report generation, and validation | Automation utilities |
| **`tivr/`** | Python 3 | Reference prototype and property tests | Verified via `pytest tivr/tests` |
