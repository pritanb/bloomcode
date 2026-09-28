"""Explicit before/after answers, called by the disposable answer-evidence fixture."""
import argparse
import json
import time
from pathlib import Path
from tutor.session import open_tutor

p = argparse.ArgumentParser()
p.add_argument('--api-url', required=True)
p.add_argument('--token-file', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
report = {'model':'gpt-6-sol', 'limits':'Synthetic Binary Search notes with deterministic embedding vectors: validates retrieval wiring, not semantic ranking quality. One run per variant, no automatic quality score.', 'runs':{}}
questions = ['Why am I still failing to understand Binary Search questions?', 'What should I practise next?']
for variant in ['before','after']:
    report['runs'][variant] = []
    with open_tutor(api_url=a.api_url, token_file=a.token_file,
                    state_dir=a.token_file.parent / variant, new=True) as tutor:
        for question in questions:
            activity = []
            started = time.monotonic()
            first = []
            def delta(_value):
                if not first: first.append(time.monotonic()-started)
            try:
                answer = (tutor.chat_reply if variant == 'before' else tutor.reply)(
                    question, on_activity=activity.append, on_text=delta)
                error = None
            except Exception as ex:
                answer, error = '', type(ex).__name__ + ': ' + str(ex)
            report['runs'][variant].append({'question':question, 'response':answer, 'error':error,
                'seconds':round(time.monotonic()-started,2), 'firstTextSeconds':round(first[0],2) if first else None,
                'activity':activity, 'usage':tutor.last_usage,
                'stages':tutor.answer_flow.timings if variant == 'after' else None,
                'evidence':tutor.answer_flow.last_evidence if variant == 'after' else None})
            (a.output / 'comparison.json').write_text(json.dumps(report, indent=2))
            print(f'Completed {variant}: {question}', flush=True)
lines = ['# Evidence-first answers', '', report['limits'], '',
         'Before: ordinary chat chooses tools. After: LangGraph retrieves and checks evidence before the same chat generation. Both use current teaching instructions.', '']
for i,q in enumerate(questions):
    lines += ['## '+q, '']
    for v in ['before','after']:
        t=report['runs'][v][i]
        lines += ['### '+v, '', t['error'] or t['response'], '', f"Total: {t['seconds']}s; first text: {t['firstTextSeconds']}s", '']
    lines += ['Review: relevance, strengths versus difficulties, uncertainty, useful next step, unsupported claims. Your verdict: ___', '']
(a.output / 'comparison.md').write_text('\n'.join(lines))
