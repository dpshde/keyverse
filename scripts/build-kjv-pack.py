#!/usr/bin/env python3
"""Build chapters.json.gz for KJV (public domain) from scrollmapper-style text.

Input format:
  ### Genesis
  [1:1] In the beginning ...
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
  'I Samuel':'1SA','II Samuel':'2SA','I Kings':'1KI','II Kings':'2KI',
  'I Chronicles':'1CH','II Chronicles':'2CH',
  'Job':'JOB','Psalm':'PSA','Psalms':'PSA','Proverbs':'PRO','Ecclesiastes':'ECC',
  'Song of Solomon':'SNG','Song of Songs':'SNG',
  'Isaiah':'ISA','Jeremiah':'JER','Lamentations':'LAM','Ezekiel':'EZK','Daniel':'DAN',
  'Hosea':'HOS','Joel':'JOL','Amos':'AMO','Obadiah':'OBA','Jonah':'JON','Micah':'MIC',
  'Nahum':'NAM','Habakkuk':'HAB','Zephaniah':'ZEP','Haggai':'HAG','Zechariah':'ZEC','Malachi':'MAL',
  'Matthew':'MAT','Mark':'MRK','Luke':'LUK','John':'JHN','Acts':'ACT',
  'Romans':'ROM','1 Corinthians':'1CO','2 Corinthians':'2CO','Galatians':'GAL','Ephesians':'EPH',
  'Philippians':'PHP','Colossians':'COL','1 Thessalonians':'1TH','2 Thessalonians':'2TH',
  '1 Timothy':'1TI','2 Timothy':'2TI','Titus':'TIT','Philemon':'PHM','Hebrews':'HEB',
  'I Corinthians':'1CO','II Corinthians':'2CO',
  'I Thessalonians':'1TH','II Thessalonians':'2TH',
  'I Timothy':'1TI','II Timothy':'2TI',
  'James':'JAS','1 Peter':'1PE','2 Peter':'2PE','1 John':'1JN','2 John':'2JN','3 John':'3JN',
  'I Peter':'1PE','II Peter':'2PE','I John':'1JN','II John':'2JN','III John':'3JN',
  'Jude':'JUD','Revelation':'REV','Revelation of John':'REV',
}

def main(src_path: str, out_dir: Path, translation: str = 'KJV') -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = Path(src_path).read_bytes()
    text = raw.decode('utf-8-sig')
    book = None
    chapters = defaultdict(dict)
    n = 0
    book_re = re.compile(r'^###\s+(.+?)\s*$')
    verse_re = re.compile(r'^\[(\d+):(\d+)\]\s*(.*)$')
    for line in text.splitlines():
        line = line.strip('\r')
        bm = book_re.match(line)
        if bm:
            name = bm.group(1).strip()
            book = NAME_TO_OSIS.get(name)
            if not book:
                # try without "The "
                book = NAME_TO_OSIS.get(name.replace('The ', ''))
            continue
        if not book:
            continue
        vm = verse_re.match(line.strip())
        if not vm:
            continue
        ch, v, t = int(vm.group(1)), int(vm.group(2)), vm.group(3).strip()
        chapters[(book, ch)][v] = t
        n += 1
    if n < 30000:
        raise SystemExit(f'too few verses parsed: {n}')
    out = {}
    for (osis, ch), vs in chapters.items():
        out[f'{osis.lower()}.{ch}'] = {
            'translation': translation,
            'book': osis,
            'chapter': ch,
            'verses': [{'v': v, 'text': vs[v]} for v in sorted(vs)],
            'source': 'public-domain KJV',
            'license': 'public-domain',
        }
    payload = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    gz = out_dir / 'chapters.json.gz'
    with gzip.open(gz, 'wb', compresslevel=9) as f:
        f.write(payload)
    (out_dir / 'NOTICE').write_text(
        f'{translation} (King James Version)\\n'
        'Public domain in the United States.\\n'
        'Bundled for offline reading in keyverse mobile.\\n'
    )
    (out_dir / 'SOURCE.txt').write_text(
        f'source={src_path}\\n'
        f'source_bytes={len(raw)}\\n'
        f'source_sha256={hashlib.sha256(raw).hexdigest()}\\n'
        f'verses={n}\\nchapters={len(chapters)}\\n'
        f'pack_sha256={hashlib.sha256(payload).hexdigest()}\\n'
    )
    print(f'ok verses={n} chapters={len(chapters)} gz={gz.stat().st_size}')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: build-kjv-pack.py /path/to/kjv.txt [out_dir]')
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / 'priv' / 'kjv'
    main(sys.argv[1], out)
