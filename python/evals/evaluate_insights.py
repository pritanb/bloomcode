"""Explicit live before/after comparison on frozen synthetic records."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import signal
from ai_core.runtime import background_runtime
from ai_core.model import StructuredModel
from insights.report import Report, ReportFlow
from evals.insight_scenarios import SCENARIOS
from openai_codex.generated.v2_all import ReasoningEffort


class RecordedModel(StructuredModel):
    def __init__(self, *args):
        super().__init__(*args)
        self.responses = []
    def generate(self, *args):
        text = super().generate(*args)
        self.responses.append(text)
        return text


def validate(report, context):
    allowed = {o['id']: o for o in context['evidence']}
    for finding in report['findings']:
        rows = [allowed[id] for id in finding['evidenceIds']]
        if not rows: raise ValueError('Missing citation')
        problems = {r['problemId'] for r in rows}
        if finding['kind'] == 'recurring' and len({r['problemId'] for r in rows if r['polarity'] == 'difficulty'}) < 2:
            raise ValueError('Recurring issue requires distinct problems')
        if finding['kind'] == 'single_problem' and len(problems) != 1:
            raise ValueError('Single-problem issue cites multiple problems')
        if finding['suggestions']: raise ValueError('No catalogue supplied in this fixture')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Spend Codex usage on both versions')
    parser.add_argument('--model', default='gpt-6-luna')
    parser.add_argument('--effort', default='xhigh')
    parser.add_argument('--scenario', choices=[s['name'] for s in SCENARIOS])
    parser.add_argument('--output', type=Path, default=Path('private/insights-comparison'))
    args = parser.parse_args()
    scenarios = [s for s in SCENARIOS if not args.scenario or s['name'] == args.scenario]
    if not args.live:
        for scenario in scenarios: print(f"{scenario['name']}: {scenario['expected']}")
        print('Add --live to generate responses. No model calls were made.')
        return
    args.output.mkdir(parents=True, exist_ok=True)
    schema = deepcopy(Report.model_json_schema())
    fields = schema['$defs']['Finding']
    for key in ('exercise', 'successCheck'):
        fields['properties'].pop(key)
        fields['required'].remove(key)
    schema['properties']['findings']['maxItems'] = 6
    legacy_prompt = Path(__file__).with_name('legacy-insights-prompt.txt').read_text()
    results = []
    with background_runtime() as (codex, options):
        for scenario in scenarios:
            versions = {}
            for version in ('legacy', 'targeted'):
                print(f"Running {scenario['name']}: {version}", flush=True)
                model = RecordedModel(codex, options, args.model, ReasoningEffort(args.effort))
                started = time.monotonic()
                def timeout(*_): raise TimeoutError('Evaluation exceeded 120 seconds.')
                signal.signal(signal.SIGALRM, timeout)
                signal.alarm(120)
                try:
                    context = deepcopy(scenario['context'])
                    if version == 'legacy':
                        correction = ''
                        for attempt in range(2):
                            text = model.generate(schema, legacy_prompt, {'context': context, 'correction': correction})
                            try:
                                report = json.loads(text)
                                validate(report, context)
                                for finding in report['findings']:
                                    for key, limit in [('title', 6), ('action', 25), ('explanation', 35)]:
                                        if len(finding[key].split()) > limit: raise ValueError(f'{key} exceeds {limit} words')
                                break
                            except (ValueError, KeyError) as error:
                                if attempt: raise
                                correction = str(error)
                    else:
                        report = ReportFlow(model, lambda id: scenario['attempts'][id],
                                            lambda report: validate(report, context)).run(context)
                    versions[version] = {'status': 'generated', 'report': report}
                except Exception as error:
                    versions[version] = {'status': 'software_failure', 'error': str(error)[:1000], 'validationDetail': str(error.__cause__ or '')[:2000]}
                signal.alarm(0)
                versions[version].update(latencySeconds=round(time.monotonic()-started, 2),
                                         calls=len(model.trace), trace=model.trace, responses=model.responses)
            results.append({'scenario': scenario['name'], 'expected': scenario['expected'], 'versions': versions})
            payload = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'model': args.model,
                       'effort': args.effort, 'results': results}
            (args.output / 'results.json').write_text(json.dumps(payload, indent=2))
            lines = ['# Learning Insights comparison', '', f'Model: {args.model}; effort: {args.effort}.',
                     '', 'Human rubric: specificity, support, exercise relevance, observable success check (0–2 each).',
                     'Generated does not mean correct. Review against each scenario expectation.', '']
            for result in results:
                lines += [f"## {result['scenario']}", '', result['expected'], '']
                for version, output in result['versions'].items():
                    lines += [f'### {version}', '', f"{output['status']}; {output['latencySeconds']}s; {output['calls']} calls", '',
                              '```json', json.dumps(output.get('report', output.get('error')), indent=2), '```', '']
            (args.output / 'comparison.md').write_text('\n'.join(lines))
    print(args.output / 'comparison.md')


if __name__ == '__main__': main()
