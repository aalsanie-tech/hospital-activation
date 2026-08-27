#!/usr/bin/env python3
"""Set the access code:  python3 tools/set_passcode.py "new code" """
import hashlib, re, sys, os
if len(sys.argv) < 2:
    sys.exit('usage: set_passcode.py "new code"')
code = sys.argv[1]
h = hashlib.sha256(code.encode()).hexdigest()
p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'js', 'config.js')
s = open(p, encoding='utf-8').read()
s2, n = re.subn(r"PASSCODE_SHA256: '[0-9a-f]*'", f"PASSCODE_SHA256: '{h}'", s)
if not n:
    sys.exit('could not find PASSCODE_SHA256 in js/config.js')
open(p, 'w', encoding='utf-8').write(s2)
print(f'access code set to: {code}\nsha256: {h}')
