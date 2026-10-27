"""
TIVR — Taxonomy-guided Iterative Verification and Repair.
prompts.py — template renderer, generation prompts, Dou feedback, and the
repair-prompt builders for every Repair_Mode (design.md §1 "Template
rendering", §3 "Generation prompts" / "Repair prompt builders").

Every prompt text comes from the shared Taxonomy_Definition
(``shared/taxonomy.v1.json``); this module only selects templates and fills
their declared variables.

Rendering (identical algorithm in Python and C#): a single pass over the
template with ``\\{([^{}\\r\\n]+)\\}``. A match whose name is a declared
variable of the template is replaced by the supplied value; any other match is
left verbatim. Substituted values are never rescanned, so problem text that
contains ``{solution}`` or code braces stays intact. A missing declared
variable raises ``TemplateError`` (a programming error, never user-facing).

Advisory findings (``VerificationReport.advisory``) are never read here, so no
Repair_Mode can leak them into a prompt (Req. 11.12).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Mapping, Sequence

from .schemas import Diagnosis, Location, MappedFinding, VerificationReport
from .taxonomy_def import PLACEHOLDER_RE, TaxonomyDefinition, load_definition

MAX_EVIDENCE_ITEMS = 3          # Req. 11.5, 11.6, 11.8
MAX_LESSONS = 2                 # Req. 11.8

GENERATION_STYLES = ("dou", "tivr")
DEFAULT_GENERATION_STYLE = "dou"
REPAIR_MODES = ("dou", "dou_no_bt", "generic", "evidence_only", "taxonomy_only", "full")
OPTIONAL_REPAIR_MODES = ("intervenor", "dou_intervenor")   # task 7.13

# Signal prefixes whose evidence is an interpreter error report (Dou_Feedback).
_ERROR_REPORT_STAGES = ("syntax", "import", "collection", "runtime")
_NO_CODE_SIGNAL = "no_code_output"
_TIMEOUT_SIGNAL = "timeout"

# Fixed filler text for blocks a mode withholds or that are empty (design §3).
EVIDENCE_ONLY_DIAGNOSIS = "* (see evidence below)"
WITHHELD_EVIDENCE = "(withheld in this configuration)"
NO_DIAGNOSIS = "* No diagnosis produced."
NO_EVIDENCE = "* No evidence captured."


class TemplateError(Exception):
    """Unknown template or missing declared variable (programming error)."""


# ---- definition access -------------------------------------------------

@lru_cache(maxsize=1)
def _default_definition() -> TaxonomyDefinition:
    return load_definition()


def _defn(definition: TaxonomyDefinition | None) -> TaxonomyDefinition:
    return definition if definition is not None else _default_definition()


# ---- rendering -----------------------------------------------------------

def render(template_id: str, variables: Mapping[str, Any],
           definition: TaxonomyDefinition | None = None) -> str:
    """Render a definition template in a single pass (see module docstring)."""
    d = _defn(definition)
    try:
        tpl = d.prompts[template_id]
    except KeyError:
        raise TemplateError(f"unknown prompt template {template_id!r}") from None
    declared = set(tpl.variables)
    missing = [v for v in tpl.variables if v not in variables]
    if missing:
        raise TemplateError(f"template {template_id!r} is missing variable(s): "
                            + ", ".join(repr(m) for m in missing))
    values = {name: str(variables[name]) for name in declared}

    def _sub(match: Any) -> str:
        name = match.group(1)
        return values[name] if name in declared else match.group(0)

    # re.sub scans the template once; replacement text is never rescanned.
    return PLACEHOLDER_RE.sub(_sub, tpl.text)


# ---- task access -----------------------------------------------------------

def _task_prompt(task: Any) -> str:
    """Task_Record ``prompt``: accepts a str, a mapping, or an object with ``.prompt``."""
    if isinstance(task, str):
        return task
    if isinstance(task, Mapping):
        return task["prompt"]
    return task.prompt


# ---- generation prompts (Req. 2.6, 2.7) ------------------------------------

def generation_prompt(style: str | None, task: Any,
                      definition: TaxonomyDefinition | None = None) -> str:
    """Initial generation prompt. ``dou`` (default) substitutes the task prompt verbatim."""
    style = DEFAULT_GENERATION_STYLE if style is None else style
    prompt = _task_prompt(task)
    if style == "dou":
        return render("dou_generation", {"Programming problem": prompt}, definition)
    if style == "tivr":
        return render("tivr_generation", {"spec": prompt.strip()}, definition)
    raise ValueError(f"invalid generation prompt style {style!r} "
                     f"(expected one of: {', '.join(GENERATION_STYLES)})")


# ---- Dou feedback -------------------------------------------------------------

def _is_error_report(f: MappedFinding) -> bool:
    if f.signal == _NO_CODE_SIGNAL:
        return True
    return f.signal.split(":", 1)[0] in _ERROR_REPORT_STAGES


def _error_report(f: MappedFinding, d: TaxonomyDefinition) -> str:
    if f.evidence.strip():
        return f.evidence
    if f.signal == _NO_CODE_SIGNAL:
        return d.dou_feedback["no_code"]
    return f.message


def dou_feedback(report: VerificationReport,
                 definition: TaxonomyDefinition | None = None) -> str:
    """Dou_Feedback over the report's correctness findings.

    timeout → the fixed time-limit sentence; syntax/import/collection/runtime
    or no_code_output → the interpreter error report of the first three such
    findings joined by a blank line; functional only → the fixed sentence.
    """
    d = _defn(definition)
    findings = report.correctness
    if any(f.signal == _TIMEOUT_SIGNAL for f in findings):
        return d.dou_feedback["timeout"]
    errors = [f for f in findings if _is_error_report(f)]
    if errors:
        return "\n\n".join(_error_report(f, d) for f in errors[:MAX_EVIDENCE_ITEMS])
    return d.dou_feedback["functional"]


# ---- diagnosis / evidence helpers ---------------------------------------------

def _primary_name(diag: Diagnosis, d: TaxonomyDefinition) -> str:
    if diag.primary and diag.primary in d.primary_types:
        return d.primary_types[diag.primary].name
    return diag.primary or d.unmapped.id


def _secondary_name(diag: Diagnosis, d: TaxonomyDefinition) -> str:
    if diag.secondary:
        return diag.secondary
    if diag.category in d.categories:
        return d.categories[diag.category].name
    return d.unmapped.name


def _repair_hint(diag: Diagnosis, d: TaxonomyDefinition) -> str:
    if diag.repair_hint:
        return diag.repair_hint
    if diag.category in d.categories:
        return d.categories[diag.category].repair_hint
    return d.unmapped.repair_hint


def _confidence(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _location(loc: Location | None) -> str:
    if loc is None:
        return ""
    return f" [{loc.file}:{loc.line}]" if loc.line is not None else f" [{loc.file}]"


def _diagnosis_block(report: VerificationReport, d: TaxonomyDefinition) -> str:
    lines: list[str] = []
    for diag in report.diagnoses:
        lines.append(render("diagnosis_line", {
            "primary": _primary_name(diag, d),
            "secondary": _secondary_name(diag, d),
            "confidence": _confidence(diag.confidence),
        }, d))
        lines.append(render("guidance_line", {"repair_hint": _repair_hint(diag, d)}, d))
    return "\n".join(lines) or NO_DIAGNOSIS


def _evidence_block(report: VerificationReport, d: TaxonomyDefinition) -> str:
    lines: list[str] = []
    for f in report.correctness[:MAX_EVIDENCE_ITEMS]:
        lines.append(render("evidence_line", {
            "signal": f.signal, "location": _location(f.location), "message": f.message,
        }, d))
        if f.evidence.strip():
            lines.append("```\n" + f.evidence.rstrip("\n") + "\n```")
    return "\n".join(lines) or NO_EVIDENCE


def _generic_evidence(report: VerificationReport) -> str:
    items = [f.evidence if f.evidence.strip() else f.message
             for f in report.correctness[:MAX_EVIDENCE_ITEMS]]
    return "\n\n".join(items) or NO_EVIDENCE


def _lessons_block(lessons: Sequence[str], iteration: int, d: TaxonomyDefinition) -> str:
    recent = list(lessons)[-MAX_LESSONS:]
    if iteration < 2 or not recent:
        return ""
    return "\n" + render("lessons_header", {}, d) + "\n".join(recent) + "\n"


# ---- lessons -------------------------------------------------------------------

def lesson_from(report: VerificationReport, iteration: int,
                definition: TaxonomyDefinition | None = None) -> str:
    """One-line lesson (with its ``* `` bullet) from a failed repair iteration."""
    d = _defn(definition)
    if report.diagnoses:
        diag = report.diagnoses[0]
        primary, secondary = _primary_name(diag, d), _secondary_name(diag, d)
        summary = diag.evidence_summary or (
            report.correctness[0].message if report.correctness else "")
    else:
        primary, secondary = d.unmapped.id, d.unmapped.name
        summary = report.correctness[0].message if report.correctness else ""
    return render("lesson", {
        "iteration": iteration, "primary": primary, "secondary": secondary,
        "evidence_summary": summary or "verification still failing",
    }, d)


# ---- repair prompts (Req. 11.1–11.8, 11.12) -----------------------------------

def build_repair_prompt(mode: str, task: Any, code: str, feedback: VerificationReport,
                        iteration: int, k: int, lessons: Sequence[str],
                        definition: TaxonomyDefinition | None = None) -> str:
    """Build the repair prompt for ``mode`` from ``feedback`` (advisory never read)."""
    d = _defn(definition)
    prompt = _task_prompt(task)

    if mode in ("dou", "dou_no_bt"):
        return render("dou_critique", {
            "prompt": prompt,
            "solution": code,
            "error log": dou_feedback(feedback, d),
            "checklist": d.checklist_text() if mode == "dou" else "",
        }, d)

    if mode == "generic":
        return render("generic_repair", {
            "spec": prompt.strip(), "code": code.strip(),
            "evidence_block": _generic_evidence(feedback),
        }, d)

    if mode in ("evidence_only", "taxonomy_only", "full"):
        diagnosis = (EVIDENCE_ONLY_DIAGNOSIS if mode == "evidence_only"
                     else _diagnosis_block(feedback, d))
        evidence = (WITHHELD_EVIDENCE if mode == "taxonomy_only"
                    else _evidence_block(feedback, d))
        lessons_text = _lessons_block(lessons, iteration, d) if mode == "full" else ""
        return render("tivr_repair", {
            "spec": prompt.strip(), "code": code.strip(),
            "iteration": iteration, "budget": k,
            "diagnosis_block": diagnosis, "evidence_block": evidence,
            "lessons_block": lessons_text,
        }, d)

    if mode in OPTIONAL_REPAIR_MODES:
        raise ValueError(f"repair mode {mode!r} is optional and not built by build_repair_prompt")
    raise ValueError(f"invalid repair mode {mode!r} "
                     f"(expected one of: {', '.join(REPAIR_MODES)})")


__all__ = [
    "MAX_EVIDENCE_ITEMS", "MAX_LESSONS", "GENERATION_STYLES", "DEFAULT_GENERATION_STYLE",
    "REPAIR_MODES", "OPTIONAL_REPAIR_MODES", "TemplateError",
    "render", "generation_prompt", "dou_feedback", "lesson_from", "build_repair_prompt",
]
