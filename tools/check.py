#!/usr/bin/env python3
"""check.py posts.tsv -> prints "rows chars hash" using the same hash as __rrTSV."""
import sys
s = open(sys.argv[1], encoding='utf-8').read().rstrip('\n')
h = 0
for c in s:
    h = (h * 31 + ord(c)) & 0xffffffff
print(len(s.splitlines()), len(s), h)
