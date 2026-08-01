#!/usr/bin/env python3
"""Build priv/bsb/chapters.json.gz from official public-domain BSB text.

Source: https://bereanbible.com/bsb.txt (public domain).
Usage:
  curl -fsSL -o /tmp/bsb.txt https://bereanbible.com/bsb.txt
  python3 scripts/build-bsb-pack.py /tmp/bsb.txt
"""
from __future__ import annotations
import gzip, hashlib, json, re, sys
from collections import defaultdict
from pathlib import Path

NAME_TO_OSIS = {
  'Genesis':'GEN','Exodus':'EXO','Leviticus':'LEV','Numbers':'NUM','Deuteronomy':'DEU',
  'Joshua':'JOS','Judges':'JDG','Ruth':'RUT',
  '1 Samuel':'1SA','2 Samuel':'2SA','1 Kings':'1KI','2 Kings':'2KI',
  '1 Chronicles':'1CH','2 Chronicles':'2CH','Ezra':'EZR','Nehemiah':'NEH','Esther':'EST',
  'Job':'JOB','Psalm':'PSA','Psalms':'PSA','Proverbs':'PRO','Ecclesiastes':'ECC',
  'Song of Solomon':'SNG','Song of Songs':'SNG',
  'Isaiah':'ISA','Jeremiah':'JER','Lamentations':'LAM','Ezekiel':'EZK','Daniel':'DAN',
  'Hosea':'HOS','Joel':'JOL','Amos':'AMO','Obadiah':'OBA','Jonah':'JON','Micah':'MIC',
  'Nahum':'NAM','Habakkuk':'HAB','Zephaniah':'ZEP','Haggai':'HAG','Zechariah':'ZEC','Malachi':'MAL',
  'Matthew':'MAT','Mark':'MRK','Luke':'LUK','John':'JHN','Acts':'ACT',
  'Romans':'ROM','1 Corinthians':'1CO','2 Corinthians':'2CO','Galatians':'GAL','Ephesians':'EPH',
  'Philippians':'PHP','Colossians':'COL','1 Thessalonians':'1TH','2 Thessalonians':'2TH',
  '1 Timothy':'1TI','2 Timothy':'2TI','Titus':'TIT','Philemon':'PHM','Hebrews':'HEB',
  'James':'JAS','1 Peter':'1PE','2 Peter':'2PE','1 John':'1JN','2 John':'2JN','3 John':'3JN',
  'Jude':'JUD','Revelation':'REV',
}

def main(src_path: str) -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / 'priv' / 'bsb'
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = Path(src_path).read_bytes()
    text = raw.decode('utf-8-sig')
    names = sorted(NAME_TO_OSIS, key=len, reverse=True)
    pat = re.compile(rf"^({'|'.join(map(re.escape, names))})\s+(\d+):(\d+)\t(.*)$")
    chapters = defaultdict(dict)
    n = 0
    for line in text.splitlines():
        line = line.strip('\r')
        m = pat.match(line)
        if not m:
            continue
        book, ch, v, t = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).strip()
        chapters[(NAME_TO_OSIS[book], ch)][v] = t
        n += 1
    if n < 30000:
        raise SystemExit(f'too few verses parsed: {n}')
    out = {}
    for (osis, ch), vs in chapters.items():
        out[f'{osis.lower()}.{ch}'] = {
            'translation': 'BSB',
            'book': osis,
            'chapter': ch,
            'verses': [{'v': v, 'text': vs[v]} for v in sorted(vs)],
            'source': 'bereanbible.com/bsb.txt',
            'license': 'public-domain',
        }
    payload = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    gz = out_dir / 'chapters.json.gz'
    with gzip.open(gz, 'wb', compresslevel=9) as f:
        f.write(payload)
    (out_dir / 'NOTICE').write_text(
        'Berean Standard Bible (BSB)\n'
        'Public domain as of 2023-04-30 (Berean Bible Translation Committee / Bible Hub).\n'
        'Built from https://bereanbible.com/bsb.txt for offline serving in keyverse.\n'
    )
    (out_dir / 'SOURCE.txt').write_text(
        f'url=https://bereanbible.com/bsb.txt\n'
        f'source_bytes={len(raw)}\n'
        f'source_sha256={hashlib.sha256(raw).hexdigest()}\n'
        f'verses={n}\nchapters={len(chapters)}\n'
        f'pack_sha256={hashlib.sha256(payload).hexdigest()}\n'
        f'pack_gz={gz.name}\n'
    )
    print(f'ok verses={n} chapters={len(chapters)} gz={gz.stat().st_size}')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: build-bsb-pack.py /path/to/bsb.txt')
    main(sys.argv[1])
