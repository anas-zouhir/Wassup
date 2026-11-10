"""Adds English translations to the news data (public/data/news/*.json).

Runs after `npm run fetch-news` (in the scheduled GitHub Action) so that every
browser, phones included, can show headlines in English. Uses Meta's NLLB-200
model (distilled 600M, int8) through CTranslate2, on CPU.

Only text without a translation yet is translated: fetch-news carries
translations over for headlines that haven't changed since the last run.

Usage: python scripts/translate-news.py [--limit N]
Setup: pip install -r scripts/requirements.txt
"""

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import ctranslate2
import sentencepiece
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parent.parent
NEWS_DIR = ROOT / "public" / "data" / "news"

MODEL_REPO = "osa911/nllb-200-distilled-600M-ct2-int8"
# Pinned so every run uses exactly the same model files.
MODEL_REVISION = "46858753dbaf8eb5e21bb6f0037c3b90851e090a"
TARGET = "eng_Latn"
BATCH_SIZE = 16
MAX_OUTPUT_TOKENS = 256

# BCP 47 tag (as used in sources.json) -> NLLB (FLORES-200) code. Full tags
# win over base languages. Languages NLLB doesn't cover (e.g. Dhivehi, Tetum)
# are left untranslated.
NLLB_CODES = {
    "am": "amh_Ethi", "ar": "arb_Arab", "az": "azj_Latn", "bg": "bul_Cyrl", "bn": "ben_Beng",
    "bs": "bos_Latn", "ca": "cat_Latn", "cs": "ces_Latn", "da": "dan_Latn", "de": "deu_Latn",
    "el": "ell_Grek", "es": "spa_Latn", "et": "est_Latn", "fa": "pes_Arab", "fi": "fin_Latn",
    "fr": "fra_Latn", "he": "heb_Hebr", "hr": "hrv_Latn", "hu": "hun_Latn", "hy": "hye_Armn",
    "id": "ind_Latn", "is": "isl_Latn", "it": "ita_Latn", "ja": "jpn_Jpan", "ka": "kat_Geor",
    "km": "khm_Khmr", "ko": "kor_Hang", "lb": "ltz_Latn", "lo": "lao_Laoo", "lt": "lit_Latn",
    "lv": "lvs_Latn", "mk": "mkd_Cyrl", "mn": "khk_Cyrl", "ms": "zsm_Latn", "mt": "mlt_Latn",
    "nb": "nob_Latn", "ne": "npi_Deva", "nl": "nld_Latn", "pl": "pol_Latn", "pt": "por_Latn",
    "ro": "ron_Latn", "ru": "rus_Cyrl", "sk": "slk_Latn", "sl": "slv_Latn", "so": "som_Latn",
    "sq": "als_Latn", "sv": "swe_Latn", "sw": "swh_Latn", "th": "tha_Thai", "tr": "tur_Latn",
    "uk": "ukr_Cyrl", "ur": "urd_Arab", "uz": "uzn_Latn", "vi": "vie_Latn",
    "zh": "zho_Hans", "zh-CN": "zho_Hans", "zh-TW": "zho_Hant", "zh-HK": "zho_Hant",
    # NLLB only has Cyrillic Serbian; Latin-script Serbian reads as Croatian.
    "sr-Cyrl": "srp_Cyrl", "sr-Latn": "hrv_Latn",
}


def nllb_code(tag: str) -> str | None:
    return NLLB_CODES.get(tag) or NLLB_CODES.get(tag.split("-")[0])


def load_model():
    path = snapshot_download(MODEL_REPO, revision=MODEL_REVISION)
    translator = ctranslate2.Translator(
        path, device="cpu", compute_type="int8", intra_threads=os.cpu_count() or 4
    )
    tokenizer = sentencepiece.SentencePieceProcessor(model_file=os.path.join(path, "sentencepiece.bpe.model"))
    return translator, tokenizer


# Sentence ends: Latin/Cyrillic/Greek/Arabic punctuation followed by a space,
# or CJK/Ethiopic full stops.
SENTENCE_END = re.compile(r"(?<=[.!?؟])\s+(?=\S)|(?<=[。！？።])")


def split_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    for part in (s.strip() for s in SENTENCE_END.split(text)):
        if not part:
            continue
        # "Dr." or "EE. UU." is an abbreviation, not a sentence: glue it to what
        # follows. So is anything followed by a lowercase word.
        if sentences and (len(sentences[-1]) <= 4 or part[0].islower()):
            sentences[-1] = f"{sentences[-1]} {part}"
        else:
            sentences.append(part)
    return sentences


def translate(translator, tokenizer, source: str, texts: list[str]) -> list[str]:
    """Translates each text sentence by sentence: NLLB was trained on single
    sentences and tends to drop the rest of a longer passage."""
    sentences = [split_sentences(t) for t in texts]
    flat = [s for group in sentences for s in group]
    english = iter(translate_sentences(translator, tokenizer, source, flat))
    return [" ".join(next(english) for _ in group) for group in sentences]


def translate_sentences(translator, tokenizer, source: str, texts: list[str]) -> list[str]:
    if not texts:
        return []
    # NLLB input: source-language token, the sentence pieces, end of sentence.
    batch = [[source, *tokenizer.encode(t, out_type=str), "</s>"] for t in texts]
    results = translator.translate_batch(
        batch,
        target_prefix=[[TARGET]] * len(batch),
        max_batch_size=BATCH_SIZE,
        beam_size=2,
        max_decoding_length=MAX_OUTPUT_TOKENS,
        no_repeat_ngram_size=4,
    )
    out = []
    for r in results:
        tokens = [t for t in r.hypotheses[0] if t != TARGET]
        out.append(tokenizer.decode(tokens).strip())
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="translate at most N pieces (for testing)")
    args = parser.parse_args()

    files = sorted(NEWS_DIR.glob("*.json"))
    docs = {f: json.loads(f.read_text(encoding="utf-8")) for f in files}

    # Collect what still needs translating, grouped by source language.
    todo: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    skipped_langs = set()
    for doc in docs.values():
        for feed in doc["outlets"]:
            tag = feed["outlet"]["lang"]
            if tag.split("-")[0] == "en":
                continue
            source = nllb_code(tag)
            if not source:
                skipped_langs.add(tag)
                continue
            for item in feed["items"]:
                if not item.get("titleEn"):
                    todo[source].append((item, "title"))
                if item.get("summary") and not item.get("summaryEn"):
                    todo[source].append((item, "summary"))

    pending = sum(len(v) for v in todo.values())
    if args.limit:
        print(f"{pending} pieces need translating; limiting to {args.limit}.")
    else:
        print(f"{pending} pieces need translating.")
    if skipped_langs:
        print(f"No model for: {', '.join(sorted(skipped_langs))} (left untranslated).")
    if pending == 0:
        return

    start = time.time()
    translator, tokenizer = load_model()
    print(f"Model loaded in {time.time() - start:.0f}s.")

    done = 0
    budget = args.limit or pending
    for source, entries in sorted(todo.items(), key=lambda kv: -len(kv[1])):
        entries = entries[: max(0, budget - done)]
        if not entries:
            break
        t = time.time()
        english = translate(translator, tokenizer, source, [item[field] for item, field in entries])
        for (item, field), text in zip(entries, english):
            if text:
                item[f"{field}En"] = text
        done += len(entries)
        print(f"  {source}: {len(entries)} in {time.time() - t:.0f}s")

    for f, doc in docs.items():
        f.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Translated {done} pieces in {time.time() - start:.0f}s.")


if __name__ == "__main__":
    sys.exit(main())
