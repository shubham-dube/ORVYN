#!/usr/bin/env python3
"""Writes apps/mobile/lib/money/merchants.g.dart from src/merchants.ts so both readers share one merchant table.
Run: python3 packages/money/tool/gen-dart.py   (test/dart-table.test.ts fails if it is out of date)."""
import os
import re

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, '..', 'src', 'merchants.ts')).read()
known = re.findall(r"\[/(.+?)/(i?), (['\"])(.*?)\3, '(.*?)'\],", src)
noise_block = src[src.index('const NOISE'):src.index('];', src.index('const NOISE'))]
noise = re.findall(r"  /(.+?)/(i?),", noise_block)


def dart(p, i):
    return f'RegExp(r"{p}"{", caseSensitive: false" if i else ""})'


out = [
    '// Generated from packages/money/src/merchants.ts by packages/money/tool/gen-dart.py — do not edit by hand.',
    '',
    'final known = <(RegExp, String, String)>[',
]
for p, i, _, name, cat in known:
    n = name.replace("'", "\\'")
    out.append(f"  ({dart(p, i)}, '{n}', '{cat}'),")
out += ['];', '', 'final noise = <RegExp>[']
out += [f'  {dart(p, i)},' for p, i in noise]
out.append('];')
target = os.path.join(here, '..', '..', '..', 'apps', 'mobile', 'lib', 'money', 'merchants.g.dart')
os.makedirs(os.path.dirname(target), exist_ok=True)
open(target, 'w').write('\n'.join(out) + '\n')
print(f'{len(known)} merchants, {len(noise)} noise rules')
