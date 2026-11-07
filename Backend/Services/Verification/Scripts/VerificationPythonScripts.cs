namespace Backend.Services.Verification.Scripts;

public static class VerificationPythonScripts
{
    public const string AstParseScript = """
import ast, sys, json, os

results = []
target = sys.argv[1]
for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            relpath = os.path.relpath(filepath, target)
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    ast.parse(fh.read(), filename=relpath)
                results.append({'file': relpath, 'ok': True})
            except SyntaxError as e:
                results.append({'file': relpath, 'ok': False, 'line': e.lineno, 'message': str(e)})
print(json.dumps(results))
""";

    public const string ImportCheckScript = """
import ast, sys, json, os, importlib

results = []
checked = set()
target = sys.argv[1]
sys.path.insert(0, target)
for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    tree = ast.parse(fh.read())
            except:
                continue
            relpath = os.path.relpath(filepath, target)
            for node in ast.walk(tree):
                mod = None
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        mod = alias.name.split('.')[0]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mod = node.module.split('.')[0]
                if mod and mod not in checked:
                    checked.add(mod)
                    local_path = os.path.join(target, mod)
                    if os.path.isdir(local_path) or os.path.isfile(local_path + '.py'):
                        results.append({'module': mod, 'ok': True, 'local': True})
                        continue
                    try:
                        importlib.import_module(mod)
                        results.append({'module': mod, 'ok': True})
                    except ImportError:
                        results.append({'module': mod, 'ok': False, 'message': f"Module '{mod}' not found"})
                    except Exception as e:
                        results.append({'module': mod, 'ok': True, 'warning': str(e)})
print(json.dumps(results))
""";

    public const string CodeMetricsScript = """
import ast, sys, json, os

def cyclomatic_complexity(tree):
    decision_nodes = (ast.If, ast.For, ast.While, ast.ExceptHandler,
                      ast.With, ast.Assert, ast.comprehension)
    count = 1
    for node in ast.walk(tree):
        if isinstance(node, decision_nodes):
            count += 1
        elif isinstance(node, ast.BoolOp):
            count += len(node.values) - 1
    return count

target = sys.argv[1]
total_loc = 0
total_comment = 0
total_code_lines = 0
all_cc = []
all_imports = set()
file_count = 0

for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            file_count += 1
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    lines = fh.readlines()
                non_blank = [l for l in lines if l.strip()]
                total_loc += len(non_blank)
                comment_lines = [l for l in non_blank if l.strip().startswith('#')]
                total_comment += len(comment_lines)
                total_code_lines += len(non_blank) - len(comment_lines)
                source = ''.join(lines)
                tree = ast.parse(source)
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        all_cc.append(cyclomatic_complexity(node))
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            all_imports.add(alias.name.split('.')[0])
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        all_imports.add(node.module.split('.')[0])
            except:
                pass

avg_cc = round(sum(all_cc) / len(all_cc), 2) if all_cc else 0
max_cc = max(all_cc) if all_cc else 0
comment_ratio = round(total_comment / total_code_lines, 3) if total_code_lines > 0 else 0

print(json.dumps({
    'total_loc': total_loc,
    'avg_cc': avg_cc,
    'max_cc': max_cc,
    'api_count': len(all_imports),
    'comment_ratio': comment_ratio,
    'file_count': file_count
}))
""";

    public const string RadonCcScript = """
import sys, json
try:
    from radon.complexity import cc_visit, cc_rank
except ImportError:
    print(json.dumps({'error': 'radon_not_installed'}))
    sys.exit(0)

import os
target = sys.argv[1]
results = []
for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            relpath = os.path.relpath(filepath, target)
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    source = fh.read()
                blocks = cc_visit(source)
                for b in blocks:
                    rank = cc_rank(b.complexity)
                    results.append({
                        'file': relpath,
                        'name': b.name,
                        'type': b.letter,
                        'lineno': b.lineno,
                        'complexity': b.complexity,
                        'rank': rank
                    })
            except Exception as e:
                results.append({'file': relpath, 'error': str(e)})
print(json.dumps(results))
""";

    public const string RadonMiScript = """
import sys, json
try:
    from radon.metrics import mi_visit, mi_rank
except ImportError:
    print(json.dumps({'error': 'radon_not_installed'}))
    sys.exit(0)

import os
target = sys.argv[1]
results = []
for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            relpath = os.path.relpath(filepath, target)
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    source = fh.read()
                mi = mi_visit(source, multi=True)
                rank = mi_rank(mi)
                results.append({'file': relpath, 'mi': round(mi, 2), 'rank': rank})
            except Exception as e:
                results.append({'file': relpath, 'mi': None, 'rank': 'X', 'error': str(e)})
print(json.dumps(results))
""";
}
