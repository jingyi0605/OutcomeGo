"""Consistency checker for Spec 012 (requirements <-> design <-> tasks).

Usage: python3 -I specs/012-桌面端一键本地部署/docs/check_spec.py specs/012-桌面端一键本地部署
Exit code 0 means every check passed; 1 means at least one problem was printed.

Checks:
  1. Design section references (§n.n) used anywhere resolve to a design heading.
  2. Every task has the required fields, unique id, existing dependencies, no cycles.
  3. Every task carries a non-empty 技术规划 and a 指标 that contains something checkable.
  4. Bidirectional trace: the tasks a requirement lists are exactly the tasks whose
     对应需求 cite that requirement (tasks that cite 全部需求 are exempt).
  5. Every acceptance criterion is named by at least one task (not just the requirement).
  6. Every requirement appears in design section 1.2 and in the design 7.4 table.
  7. Task references to open questions (Qn) exist in design section 8.2.
"""
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
req = (root / "requirements.md").read_text(encoding="utf-8")
des = (root / "design.md").read_text(encoding="utf-8")
tsk = (root / "tasks.md").read_text(encoding="utf-8")
problems = []


def tid_key(tid):
    return tuple(int(x) for x in tid.split("."))


# ---------------------------------------------------------------- requirements
criteria = {}
req_task_lists = {}
current = None
for line in req.splitlines():
    m = re.match(r"^### (非功能)?需求 (\d+)：", line)
    if m:
        current = ("N" if m.group(1) else "R", int(m.group(2)))
        criteria[current] = 0
        req_task_lists[current] = None
        continue
    if re.match(r"^## ", line):
        current = None
    if current and re.match(r"^\d+\. ", line):
        criteria[current] += 1
    m = re.match(r"^设计：.*任务：([\d.、，, ]+)。$", line)
    if current and m:
        req_task_lists[current] = set(re.findall(r"\d+\.\d+", m.group(1)))
for key, listed in req_task_lists.items():
    if listed is None:
        problems.append(f"{key[0]}{key[1]} 缺少『设计：…任务：…』行")

# --------------------------------------------------------------------- design
design_sections = set(re.findall(r"^#{2,4} (\d+(?:\.\d+)*)[ .]", des, re.M))
for name, text in (("requirements", req), ("tasks", tsk), ("design", des)):
    bad = sorted({s for s in re.findall(r"§(\d+(?:\.\d+)*)", text) if s not in design_sections})
    if bad:
        problems.append(f"{name} 引用了不存在的设计章节: {bad}")
sec12 = des.split("### 1.3")[0]
sec74 = des.split("### 7.4")[1].split("## 8.")[0]
for kind, n in criteria:
    label = "非功能需求" if kind == "N" else "需求"
    if kind == "R" and not re.search(rf"`requirements.md` 需求 {n}(?!\d)", sec12):
        problems.append(f"design §1.2 没有列出需求 {n}")
    if not re.search(rf"\| `requirements.md` {label} {n} \|", sec74):
        problems.append(f"design §7.4 缺少 {label} {n}")

# ---------------------------------------------------------------------- tasks
REQUIRED = ["状态", "这一步到底做什么", "做完你能看到什么", "先依赖什么", "开始前先看", "技术规划",
            "主要改哪里", "这一步先不做什么", "怎么算完成", "指标", "怎么验证", "对应需求", "对应设计"]
tasks = {}
for blk in re.split(r"(?m)^- \[[ x]\] ", tsk)[1:]:
    head = re.match(r"(\d+\.\d+) (.*)", blk)
    tid = head.group(1)
    if tid in tasks:
        problems.append(f"重复的任务编号 {tid}")
    fields = {}
    keys = [(m.group(1), m.start(), m.end()) for m in re.finditer(r"(?m)^  - ([^：\n]+)：", blk)]
    for i, (k, s, e) in enumerate(keys):
        end = keys[i + 1][1] if i + 1 < len(keys) else len(blk)
        fields[k] = blk[e:end].strip()
    tasks[tid] = {"title": head.group(2).strip(), "fields": fields}

for tid, t in tasks.items():
    for f in REQUIRED:
        if not t["fields"].get(f):
            problems.append(f"任务 {tid} 缺少或为空: {f}")
    plan, metric = t["fields"].get("技术规划", ""), t["fields"].get("指标", "")
    if len(plan) < 40:
        problems.append(f"任务 {tid} 的技术规划过短（{len(plan)} 字）")
    if not (re.search(r"\d", metric) or "`" in metric):
        problems.append(f"任务 {tid} 的指标里既没有数字也没有命令，无法判定通过与否")
    for d in re.findall(r"\d+\.\d+", t["fields"].get("先依赖什么", "")):
        if d not in tasks and not any(d == x for x in re.findall(r"(?m)^- \[[ x]\] (\d+\.\d+) ", tsk)):
            problems.append(f"任务 {tid} 依赖不存在的任务 {d}")
    for q in re.findall(r"\bQ\d+\b", " ".join(t["fields"].values())):
        if not re.search(rf"\| {q} \|", des):
            problems.append(f"任务 {tid} 引用了不存在的待确认项 {q}")

deps = {tid: re.findall(r"\d+\.\d+", t["fields"].get("先依赖什么", "")) for tid, t in tasks.items()}
state = {}


def visit(node, path):
    if state.get(node) == 2:
        return
    if state.get(node) == 1:
        problems.append("依赖环: " + " -> ".join(path + [node]))
        return
    state[node] = 1
    for d in deps.get(node, []):
        visit(d, path + [node])
    state[node] = 2


for node in tasks:
    visit(node, [])

# ----------------------------------------------------------- trace both ways
def expand(text, rid):
    out = set()
    for a, b in re.findall(r"(\d+\.\d+)–(\d+\.\d+)", text):
        lo, hi = int(a.split(".")[1]), int(b.split(".")[1])
        out |= {f"{a.split('.')[0]}.{i}" for i in range(lo, hi + 1)}
    out |= set(re.findall(r"\d+\.\d+", re.sub(r"\d+\.\d+–\d+\.\d+", "", text)))
    return {x for x in out if x.split(".")[0] == str(rid)}


cites = {}
for tid, t in tasks.items():
    line = t["fields"].get("对应需求", "")
    if "全部需求" in line:
        cites[tid] = "ALL"
        continue
    c = {}
    for m in re.finditer(
        r"(非功能)?需求 (\d+)(?: / 验收 ([\d.、，–, ]+?))?(?=，需求|、需求|，非功能|、非功能|$|，|、(?!\d))", line
    ):
        key = ("N" if m.group(1) else "R", int(m.group(2)))
        c.setdefault(key, set())
        if m.group(3):
            c[key] |= expand(m.group(3), key[1])
    for key, crit in c.items():
        for x in crit:
            if int(x.split(".")[1]) > criteria.get(key, 0):
                problems.append(f"任务 {tid} 引用了不存在的验收标准 {x}")
    cites[tid] = c

for key, listed in req_task_lists.items():
    if listed is None:
        continue
    citing = {tid for tid, c in cites.items() if c != "ALL" and key in c}
    for tid in listed - citing:
        problems.append(f"{key[0]}{key[1]} 的任务列表含 {tid}，但任务 {tid} 的『对应需求』没有引用它")
    for tid in citing - listed:
        problems.append(f"任务 {tid} 引用了 {key[0]}{key[1]}，但该需求的任务列表没有列出 {tid}")
    for tid in listed:
        if tid not in tasks:
            problems.append(f"{key[0]}{key[1]} 的任务列表含不存在的任务 {tid}")

named = set()
for tid, c in cites.items():
    if c == "ALL":
        continue
    for key, crit in c.items():
        for x in crit:
            named.add((key, x))
for key, n in criteria.items():
    for i in range(1, n + 1):
        if (key, f"{key[1]}.{i}") not in named:
            problems.append(f"验收标准 {key[0]}{key[1]}.{i} 没有任何任务在『对应需求』里点名")

# ---------------------------------------------------------------------- report
print(f"需求 {sum(1 for k in criteria if k[0] == 'R')} 条，非功能需求 {sum(1 for k in criteria if k[0] == 'N')} 条，"
      f"验收标准 {sum(criteria.values())} 条，任务 {len(tasks)} 个")
if problems:
    print(f"发现 {len(problems)} 个问题:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("核对通过")
