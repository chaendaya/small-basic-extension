import json
import re
from pathlib import Path

STATE_RE = re.compile(r"^\s*State\s+(\d+)\s*$")
ITEM_RE  = re.compile(r"^\s*\[(.*)\]\s*:\s*(\d+)\s*$")

def normalize_key(inner: str) -> str:
    # inner: "T, ID, T, =, NT, Expr"
    parts = [p.strip() for p in inner.split(",")]
    parts = [p for p in parts if p not in ("T", "NT") and p != ""]
    return "[" + ", ".join(parts) + "]"

def convert(txt_path: str, include_empty_states: bool = True):
    lines = Path(txt_path).read_text(encoding="utf-8", errors="replace").splitlines()

    data = {}
    current_state = None
    max_state_seen = -1

    for line in lines:
        m_state = STATE_RE.match(line)
        if m_state:
            current_state = int(m_state.group(1))
            max_state_seen = max(max_state_seen, current_state)
            data.setdefault(str(current_state), [])
            continue

        m_item = ITEM_RE.match(line)
        if m_item and current_state is not None:
            key_inner = m_item.group(1)
            value = int(m_item.group(2))
            data[str(current_state)].append({
                "key": normalize_key(key_inner),
                "value": value
            })

    if include_empty_states:
        for s in range(max_state_seen + 1):
            data.setdefault(str(s), [])

    return data

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="input txt file path")
    ap.add_argument("-o", "--output", default="out.json")
    ap.add_argument("--no-empty", action="store_true", help="do not include empty states")
    args = ap.parse_args()

    obj = convert(args.input, include_empty_states=not args.no_empty)
    Path(args.output).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote: {args.output}")
