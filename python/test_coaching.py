import tempfile
import unittest
from pathlib import Path
from coaching_graph import CoachingGraph
from coaching_model import Teaching


def evidence(id):
    return {'ids': [id], 'fingerprint': '1'}


class CoachingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []
        def model(schema, instructions, data):
            self.calls.append(data)
            message = data['message']
            return Teaching(action='explain' if message == 'explain' else 'question',
                            focus='invariant', response='What stays true?', evidence_ids=['attempt'])
        self.model = model
        self.graph = CoachingGraph(Path(self.temp.name), model, evidence)

    def tearDown(self):
        self.graph.close()
        self.temp.cleanup()

    def test_resume_does_not_repeat_question_and_requests_are_idempotent(self):
        self.graph.start('attempt', {'id': '1', 'message': 'coach'})
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.graph.view()['needsRetry'])
        self.graph.close()
        self.graph = CoachingGraph(Path(self.temp.name), self.model, evidence)
        self.assertEqual(len(self.graph.view()['messages']), 2)
        self.graph.reply({'id': '2', 'message': 'explain'})
        self.graph.reply({'id': '2', 'message': 'explain'})
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.graph.state()['decisions'][-1]['action'], 'explain')
        with self.assertRaises(ValueError):
            self.graph.reply({'id': '2', 'message': 'changed'})

    def test_failure_can_retry_without_duplicate_messages(self):
        self.graph.start('attempt', {'id': '1', 'message': 'coach'})
        def fail(*args): raise RuntimeError('offline')
        self.graph.model = fail
        with self.assertRaises(RuntimeError):
            self.graph.reply({'id': '2', 'message': 'answer'})
        self.assertTrue(self.graph.view()['needsRetry'])
        self.assertEqual(len(self.graph.view()['messages']), 2)
        self.graph.model = self.model
        self.graph.retry()
        self.assertEqual(len(self.graph.view()['messages']), 4)
        self.graph.pause()
        self.assertEqual(self.graph.view()['status'], 'paused')
        self.graph.resume()
        self.assertEqual(self.graph.view()['status'], 'active')

    def test_changed_evidence_and_completion_bound(self):
        self.graph.start('attempt', {'id': '1', 'message': 'coach'})
        self.graph.evidence = lambda id: {'ids': [id], 'fingerprint': '2'}
        for i in range(2, 8):
            self.graph.reply({'id': str(i), 'message': 'answer'})
        self.assertTrue(self.calls[1]['evidence']['changed'])
        self.assertEqual(self.graph.view()['status'], 'completed')
        self.graph.clear()
        self.assertIsNone(self.graph.view())

class RoutingTests(unittest.TestCase):
    def test_normal_chat_pauses_and_clarification_is_persisted(self):
        from coaching import Coaching
        from coaching_model import Route
        with tempfile.TemporaryDirectory() as directory:
            coach = Coaching(Path(directory), lambda *a: Route(intent='start', attempt_id=None, problem='Two Sum', latest=False), None)
            class FakeEvidence:
                def check_access(self): pass
                def resolve(self, route, context): return None, [{'id':'record','title':'Two Sum','date':'today'}]
            coach.evidence = FakeEvidence()
            self.assertIn('Which attempt', coach.reply('coach Two Sum'))
            coach.close()
            coach = Coaching(Path(directory), lambda *a: Route(intent='chat',attempt_id=None,problem=None,latest=False), None)
            coach.evidence = FakeEvidence()
            self.assertEqual(coach.candidates[0]['id'], 'record')
            self.assertIsNone(coach.reply('What is a hash map?'))
            coach.close()

    def test_invalid_model_references_are_repaired_once(self):
        from coaching_model import StructuredCodex
        from types import SimpleNamespace
        class Thread:
            count = 0
            def run(self, *a, **kw):
                self.count += 1
                return SimpleNamespace(error=None, status=SimpleNamespace(value='completed'),
                  final_response=json.dumps({'action':'question','focus':'test','response':'Question', 'evidence_ids':['invented']}), usage=None)
        import json
        thread = Thread()
        codex = SimpleNamespace(thread_start=lambda **kwargs: thread)
        with self.assertRaises(RuntimeError):
            StructuredCodex(codex, {})(Teaching, 'test', {'evidence': {'ids': ['real']}})
        self.assertEqual(thread.count, 2)
