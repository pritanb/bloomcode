"""Explicit live comparison. Invoked by tests/integrations/coaching-eval.mjs."""
import argparse
import json
import os
import re
import time
from pathlib import Path
from datetime import datetime, timezone
from tutor.session import open_tutor


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--api-url', required=True)
    p.add_argument('--token-file', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--known-attempts', default='')
    p.add_argument('--cases', default='diagnostic,correct-answer,direct-explanation')
    args = p.parse_args()
    cases = json.loads((Path(__file__).parent / 'scenarios.json').read_text())
    if args.cases != 'all': cases = [c for c in cases if c['id'] in args.cases.split(',')]
    report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'model': 'gpt-6-sol',
              'coachingModel': os.environ.get('BLOOMCODE_COACHING_MODEL', 'gpt-6-sol'),
              'coachingReasoningEffort': 'low',
              'baseline': 'Ordinary TutorSession.chat_reply with current teaching instructions and MCP tools',
              'limits': 'Scripted replies are identical between variants and may fit one generated question better. One run is not a statistical benchmark. Human scores are intentionally blank.', 'cases': []}
    args.output.mkdir(parents=True, exist_ok=True)
    for case in cases:
        entry = {**case, 'runs': {}, 'humanReview': None}
        for variant in ('before', 'after'):
            turns = []
            with open_tutor(api_url=args.api_url, token_file=args.token_file,
                            state_dir=args.token_file.parent / f"eval-{case['id']}-{variant}", new=True) as tutor:
                for message in case['messages']:
                    started = time.monotonic()
                    activity = []
                    trace_start = len(tutor.coaching.model.trace) if tutor.coaching else 0
                    try:
                        reply = tutor.chat_reply if variant == 'before' else tutor.reply
                        options = {'coaching_target': case['target']} if variant == 'after' and not turns else {}
                        text = reply(message, on_activity=activity.append, **options)
                        error = None
                    except Exception as ex:
                        text, error = '', type(ex).__name__ + ': ' + str(ex)
                    unknown = sorted(set(re.findall(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', text)) - set(args.known_attempts.split(',')))
                    turns.append({'unknownEvidenceIds': unknown, 'user': message, 'response': text, 'softwareError': error,
                                  'latencySeconds': round(time.monotonic()-started, 2),
                                  'activity': activity,
                                  'calls': tutor.coaching.model.trace[trace_start:] if tutor.coaching and variant == 'after' else [],
                                  'usage': tutor.last_usage if variant == 'before' else None})
                view = tutor.coaching.view() if tutor.coaching and variant == 'after' else None
                entry['runs'][variant] = {'turns': turns, 'coaching': view,
                    'evidence': tutor.coaching.graph.state().get('evidence') if view else None}
            print(f"Completed {case['id']} / {variant}", flush=True)
        report['cases'].append(entry)
        (args.output / 'comparison.json').write_text(json.dumps(report, indent=2))
        render(report, args.output / 'comparison.md')


def render(report, path):
    lines = ['# Tutor response comparison', '', f"Ordinary chat model: {report['model']}. Coaching model: {report['coachingModel']} ({report['coachingReasoningEffort']} reasoning).", '', report['limits'], '',
             'Before: ordinary Codex chat. After: LangGraph coaching with an explicit target, using the reported coaching model and disposable study data.', '',
             'Score each version 1–5 for relevance, adaptation, appropriate hinting, and evidence honesty. Mark unsupported claims and software errors separately. No quality score has been assigned automatically.', '']
    for case in report['cases']:
        lines += [f"## {case['id']}", '', case['rubric'], '']
        for i, message in enumerate(case['messages']):
            lines += [f'### Learner turn {i+1}', '', message, '', '| Before | After |', '|---|---|']
            cells=[]
            for variant in ('before','after'):
                turn=case['runs'][variant]['turns'][i]
                content=turn['softwareError'] or turn['response']
                cells.append(content.replace('&','&amp;').replace('<','&lt;').replace('|','\\|').replace('\n','<br>') + f"<br><br>Latency: {turn['latencySeconds']}s")
            lines += ['| ' + ' | '.join(cells) + ' |', '']
        lines += ['Your verdict: ___  Evidence supporting that verdict: ___', '']
    path.write_text('\n'.join(lines))


if __name__ == '__main__': main()
