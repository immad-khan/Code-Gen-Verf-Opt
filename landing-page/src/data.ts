export const TRY_URL = "#try";

export type Technique = {
  n: number;
  title: string;
  desc: string;
  tag: "Paper" | "Extension";
  category: string;
  tool: string;
  file: string;
};

export const techniques: Technique[] = [
  {
    n: 1,
    title: "Syntax / AST Parsing",
    desc: "Compiles Python to an AST via ast.parse(). Catches unclosed brackets, missing colons, invalid syntax and indentation defects.",
    tag: "Paper",
    category: "A.1 Incomplete Syntax · A.2 Indentation",
    tool: "ast.parse()",
    file: "VerificationService.cs:L293–343",
  },
  {
    n: 2,
    title: "Import / API Hallucination Detection",
    desc: "Walks ast.Import and ast.ImportFrom nodes and tests each with importlib.import_module() to expose hallucinated packages.",
    tag: "Paper",
    category: "A.3 Library Import Error",
    tool: "importlib",
    file: "VerificationService.cs:L347–400",
  },
  {
    n: 3,
    title: "Isolated Test Execution",
    desc: "Spawns an isolated sandbox and runs pytest -v --tb=short against the generated unit tests to measure the pass rate.",
    tag: "Paper",
    category: "C.1 – C.4 Functional Bugs",
    tool: "pytest",
    file: "VerificationService.cs:L403–485",
  },
  {
    n: 4,
    title: "Runtime Error Detection",
    desc: "Parses execution traces to catch unhandled crashes: NameError, TypeError, IndexError, KeyError, ZeroDivisionError.",
    tag: "Paper",
    category: "B.1 – B.5 Runtime Bugs",
    tool: "trace parser",
    file: "VerificationService.cs:L487–534",
  },
  {
    n: 5,
    title: "Type Checking",
    desc: "Runs mypy --ignore-missing-imports to find parameter mismatches, type conflicts and return-type contract violations.",
    tag: "Extension",
    category: "Static type contracts before runtime",
    tool: "mypy",
    file: "VerificationService.cs:L538–607",
  },
  {
    n: 6,
    title: "Complexity & Maintainability",
    desc: "Computes McCabe Cyclomatic Complexity and the Maintainability Index through radon.complexity and radon.metrics.",
    tag: "Paper",
    category: "RQ1 · Cyclomatic complexity & LOC",
    tool: "radon",
    file: "VerificationService.cs:L609–726",
  },
  {
    n: 7,
    title: "Security Scan",
    desc: "Runs semgrep scan --config p/python to detect injection risks, insecure regex and hardcoded secrets.",
    tag: "Extension",
    category: "Industry-standard security hardening",
    tool: "semgrep",
    file: "VerificationService.cs",
  },
];

export const rounds = [
  {
    code: "V₀",
    title: "Initial Verification",
    desc: "The LLM's first attempt (G₀) is run through all 7 techniques. Baseline bugs are captured and tagged by taxonomy.",
    passed: 8,
    total: 12,
    tone: "slate" as const,
  },
  {
    code: "V₁",
    title: "After Repair Round 1",
    desc: "V₀ traces + taxonomy hints drive an R₁ self-critique. The regenerated code is re-verified end to end.",
    passed: 11,
    total: 12,
    tone: "purple" as const,
  },
  {
    code: "V₂",
    title: "After Repair Round 2",
    desc: "Episodic memory of prior failures powers a second bounded R₂ repair, confirming the bugs are eradicated.",
    passed: 12,
    total: 12,
    tone: "magenta" as const,
  },
];

export const pipeline = [
  { n: 1, title: "Prompt", phase: "Problem Input", desc: "User specifies requirements and API settings." },
  { n: 2, title: "Generate", phase: "G₀ — Initial Synthesis", desc: "Initial Python code generation without feedback." },
  { n: 3, title: "Verif. R0", phase: "V₀ — Initial Diagnostics", desc: "7-technique checks on initial code; identifies syntax, imports, and test failures." },
  { n: 4, title: "Repair R1", phase: "R₁ — Self-Critique Round 1", desc: "Synthesizes a self-critique prompt carrying V₀ compiler traces and taxonomy hints (A.1–C.4) to repair the code." },
  { n: 5, title: "Verif. R1", phase: "V₁ — Post-Round 1 Checks", desc: "Runs real verification on Round 1 repaired code. Evaluates pass rate improvement." },
  { n: 6, title: "Repair R2", phase: "R₂ — Episodic Memory Round 2", desc: "Second bounded repair iteration carrying previous failure history to eliminate remaining bugs." },
  { n: 7, title: "Verif. R2", phase: "V₂ — Post-Round 2 Checks", desc: "Runs real verification on Round 2 repaired code to confirm bug eradication." },
  { n: 8, title: "Final Results", phase: "Dou et al. Research Summary", desc: "Comprehensive comparison report: RSR %, Bug Evolution Matrix (V₀ → V₁ → V₂), pass-rate trajectory, and a side-by-side Before/After diff." },
];

export const bugMatrix = [
  { code: "A.1", name: "Syntax", v: [2, 0, 0] },
  { code: "A.3", name: "Imports", v: [1, 0, 0] },
  { code: "B.x", name: "Runtime", v: [3, 1, 0] },
  { code: "C.x", name: "Functional", v: [4, 1, 0] },
];
