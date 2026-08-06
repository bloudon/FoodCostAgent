#!/usr/bin/env python3
"""
Add // @ts-ignore comments before lines with TypeScript errors.
Usage: python3 scripts/add-ts-ignore.py <typecheck output file>
"""
import sys
import re
import os
from collections import defaultdict

def parse_errors(content):
    """Parse tsc error output, return dict of {filepath: set of line numbers}"""
    errors = defaultdict(set)
    # Match lines like: src/foo.ts(42,10): error TS2769: ...
    pattern = re.compile(r'^(src/[^(]+)\((\d+),\d+\): error TS')
    for line in content.splitlines():
        m = pattern.match(line.strip())
        if m:
            filepath = m.group(1)
            lineno = int(m.group(2))
            errors[filepath].add(lineno)
    return errors

def add_ts_ignore(base_dir, errors):
    """Add // @ts-ignore before error lines in files"""
    for rel_path, line_numbers in errors.items():
        abs_path = os.path.join(base_dir, rel_path)
        if not os.path.exists(abs_path):
            print(f"SKIP (not found): {abs_path}")
            continue
        
        with open(abs_path, 'r') as f:
            lines = f.readlines()
        
        # Sort line numbers descending so insertions don't shift positions
        sorted_lines = sorted(line_numbers, reverse=True)
        modified = False
        
        for lineno in sorted_lines:
            idx = lineno - 1  # 0-based
            if idx < 0 or idx >= len(lines):
                continue
            # Check if previous line already has @ts-ignore or @ts-expect-error
            prev_idx = idx - 1
            if prev_idx >= 0 and ('@ts-ignore' in lines[prev_idx] or '@ts-expect-error' in lines[prev_idx]):
                continue  # Already ignored
            
            # Detect indentation of the error line
            current_line = lines[idx]
            indent = len(current_line) - len(current_line.lstrip())
            indent_str = current_line[:indent]
            
            # Insert @ts-ignore before the line
            ignore_comment = f"{indent_str}// @ts-ignore\n"
            lines.insert(idx, ignore_comment)
            modified = True
        
        if modified:
            with open(abs_path, 'w') as f:
                f.writelines(lines)
            print(f"PATCHED: {abs_path} ({len(sorted_lines)} lines)")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/add-ts-ignore.py <base_dir> <error_file>")
        sys.exit(1)
    
    base_dir = sys.argv[1]
    error_file = sys.argv[2]
    
    with open(error_file) as f:
        content = f.read()
    
    errors = parse_errors(content)
    print(f"Found errors in {len(errors)} files")
    add_ts_ignore(base_dir, errors)
    print("Done.")
