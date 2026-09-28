import json
import unittest
from insights.report import ReportFlow, inspect, select_attempts


def row(i, polarity='difficulty', **changes):
    return {'id': str(i), 'attemptId': str(i), 'problemId': str(i), 'polarity': polarity,
            'sourceField': 'notes', 'excerpt': 'bounds', 'studyDate': '2026-01-01', **changes}


class Model:
    def __init__(self, values): self.values, self.calls = iter(values), 0
    def generate(self, *_):
        self.calls += 1
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
