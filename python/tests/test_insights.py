import json
import unittest
from insights.report import ReportFlow, inspect, select_attempts, report_schema


def row(i, polarity='difficulty', **changes):
    return {'id': str(i), 'attemptId': str(i), 'problemId': str(i), 'polarity': polarity,
            'sourceField': 'notes', 'excerpt': 'bounds', 'studyDate': '2026-01-01', **changes}


class Model:
    def __init__(self, values): self.values, self.calls, self.requests = iter(values), 0, []
    def generate(self, *_):
        self.calls += 1
        self.requests.append(_)
        return json.dumps(next(self.values))


def read(id):
    return {'id': id, 'status': 'completed', 'notes': 'bounds', 'code': '', 'takeaway': ''}


class InsightsTests(unittest.TestCase):
    def test_selection_is_distinct_bounded_and_includes_strengths(self):
        rows = [row(i) for i in range(20)] + [row('strength', 'strength'), row(0)]
        ids = select_attempts(rows)
        self.assertEqual(len(ids), 8)
        self.assertEqual(len(set(ids)), 8)
        self.assertIn('strength', ids)

    def test_inspection_keeps_source_window_and_drops_changed_observations(self):
        context = {'evidence': [row(1, sourceField='code', excerpt='target'), row(2)]}
        result = inspect(context, ['1', '2'], lambda id: {
            'id': id, 'status': 'completed', 'code': 'x' * 10000 + 'target', 'notes': 'changed'})
        self.assertEqual([o['id'] for o in result['evidence']], ['1'])
        self.assertIn('target', result['attempts'][0]['code'])
        self.assertIn('code', result['attempts'][0]['truncatedFields'])
        self.assertTrue(result['inspectionLimitations'])

    def test_one_correction_shared_between_local_and_host_validation(self):
        model = Model([{}, {'findings': [], 'limitation': 'Sparse evidence'}])
        calls = []
        flow = ReportFlow(model, read, lambda result: calls.append(result))
        self.assertEqual(flow.run({'evidence': []})['findings'], [])
        self.assertEqual(model.calls, 2)
        self.assertEqual(len(calls), 1)
        model = Model([{}, {'findings': [], 'limitation': ''}])
        with self.assertRaises(RuntimeError):
            ReportFlow(model, read, lambda _: 'Unknown catalogue ID').run({'evidence': []})
        self.assertEqual(model.calls, 2)

    def test_access_failure_stops_before_model(self):
        model = Model([])
        with self.assertRaises(PermissionError):
            ReportFlow(model, lambda _: {'status': 'active'}, lambda _: None).run({'evidence': [row(1)]})
        self.assertEqual(model.calls, 0)

    def test_correction_receives_rejected_report_and_specific_error(self):
        model = Model([{}, {'findings': [], 'limitation': 'Sparse evidence'}])
        ReportFlow(model, read, lambda _: None).run({'evidence': []})
        correction = model.requests[1][2]
        self.assertEqual(json.loads(correction['rejectedReport']), {})
        self.assertIn('findings: missing', correction['correction'])
        self.assertIn('limitation: missing', correction['correction'])

    def test_final_rejection_keeps_reason_without_private_model_content(self):
        model = Model([{'findings': 'private text'}, {'findings': 'private text'}])
        with self.assertRaises(RuntimeError) as failure:
            ReportFlow(model, read, lambda _: None).run({'evidence': []})
        self.assertIn('findings: list_type', str(failure.exception))
        self.assertNotIn('private text', str(failure.exception))
        model = Model([{'findings': [], 'limitation': ''}] * 2)
        with self.assertRaisesRegex(RuntimeError, 'Single-problem findings must cite one problem'):
            ReportFlow(model, read, lambda _: 'Single-problem findings must cite one problem').run({'evidence': []})

    def test_schema_only_allows_inspected_citations_and_catalogue(self):
        schema = report_schema({'evidence': [row('verified')], 'questions': [{'id': 'known'}]})
        self.assertEqual(schema['$defs']['Finding']['properties']['evidenceIds']['items']['enum'], ['verified'])
        self.assertEqual(schema['$defs']['Suggestion']['properties']['problemId']['enum'], ['known'])
        empty = report_schema({'evidence': [], 'questions': []})
        self.assertEqual(empty['properties']['findings']['maxItems'], 0)
        self.assertEqual(empty['$defs']['Finding']['properties']['suggestions']['maxItems'], 0)

    def test_recent_attempts_cannot_crowd_out_older_related_evidence(self):
        rows = [row(f'new-{i}', studyDate=f'2026-09-{i+1:02}') for i in range(12)]
        rows += [row('old-difficulty', problemId='binary-search', studyDate='2025-01-01'),
                 row('old-strength', 'strength', problemId='binary-search', studyDate='2025-02-01')]
        selected = select_attempts(rows)
        self.assertIn('old-difficulty', selected)
        self.assertIn('old-strength', selected)
        self.assertLessEqual(len(selected), 8)
        self.assertEqual(selected, select_attempts(list(reversed(rows))))

    def test_selection_spans_history_and_duplicate_observations_add_no_weight(self):
        rows = [row(f'a{i:02}', studyDate=f'2026-01-{i+1:02}') for i in range(24)]
        selected = select_attempts(rows)
        self.assertIn('a00', selected)
        self.assertIn('a23', selected)
        self.assertTrue(any(7 <= int(id[1:]) <= 15 for id in selected))
        self.assertEqual(selected, select_attempts(rows + [dict(rows[-1], id=f'copy-{i}') for i in range(20)]))
