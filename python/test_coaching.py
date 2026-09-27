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

    def test_active_answer_uses_teaching_without_router(self):
        from coaching import Coaching
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def model(schema, instructions, data):
                calls.append(schema.__name__)
                return Teaching(action='hint', focus='invariant', response='Adapted response', evidence_ids=['selected'])
            coach = Coaching(Path(directory), model, None)
            class FakeEvidence:
                def check_access(self): pass
                def __call__(self, id): return {'ids': [id], 'fingerprint': '1'}
                def followup(self, id): return self(id)
            coach.evidence = coach.graph.evidence = FakeEvidence()
            coach.graph.start('selected', {'id':'first', 'message':'coach'})
            calls.clear()
            self.assertIn('Adapted response', coach.reply('My answer'))
            self.assertEqual(calls, ['Teaching'])
            coach.close()

    def test_goal_request_hands_off_once_without_consuming_the_question(self):
        from coaching import Coaching
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def model(schema, instructions, data):
                calls.append(schema.__name__)
                if data['message'] == 'save a goal':
                    return Teaching(action='chat', focus='invariant', response='Hand off', evidence_ids=[])
                return Teaching(action='question', focus='invariant', response='What stays true?', evidence_ids=['a'])
            coach = Coaching(Path(directory), model, None)
            class FakeEvidence:
                def check_access(self): pass
                def __call__(self, id): return {'ids':[id], 'fingerprint':'1'}
                def followup(self, id): return self(id)
            coach.evidence = coach.graph.evidence = FakeEvidence()
            coach.graph.start('a', {'id':'1','message':'coach'})
            self.assertIsNone(coach.reply('save a goal', request_id='2'))
            self.assertEqual(coach.view()['status'], 'paused')
            self.assertEqual(len(coach.view()['messages']), 2)
            self.assertIsNone(coach.reply('save a goal', request_id='2'))
            self.assertEqual(len(calls), 2)
            coach.control('resume')
            coach.reply('answer', request_id='3')
            self.assertEqual(len(coach.view()['messages']), 4)
            coach.close()

    def test_followup_omits_broad_data_and_expands_only_when_requested(self):
        class FakeEvidence:
            broad_calls = 0
            focused_calls = 0
            def __call__(self, id):
                self.broad_calls += 1
                return {'ids':[id], 'fingerprint':'1', 'snapshot': {'large':'history'}}
            def followup(self, id):
                self.focused_calls += 1
                return {'ids':[id], 'fingerprint':'1', 'preferences': {'hintStyle':'direct'}}
        with tempfile.TemporaryDirectory() as directory:
            provider = FakeEvidence()
            payloads = []
            def model(schema, instructions, data):
                payloads.append(data)
                action = 'broaden' if data['message'] == 'compare history' and data['broader_evidence_available'] else 'question'
                return Teaching(action=action, focus='x', response='Question', evidence_ids=[])
            graph = CoachingGraph(Path(directory), model, provider)
            graph.start('a', {'id':'1','message':'coach'})
            graph.reply({'id':'2','message':'answer'})
            self.assertNotIn('snapshot', payloads[-1]['evidence'])
            self.assertEqual(payloads[-1]['evidence']['preferences']['hintStyle'], 'direct')
            self.assertNotIn('previous_decisions', payloads[-1])
            graph.reply({'id':'3','message':'compare history'})
            self.assertEqual(provider.broad_calls, 2)
            self.assertEqual(provider.focused_calls, 2)
            self.assertEqual(len(graph.view()['messages']), 6)
            self.assertEqual(len(payloads), 4)
            graph.close()

class FocusedEvidenceTests(unittest.TestCase):
    def test_followup_reads_fresh_access_attempt_and_preferences_only(self):
        from contextlib import asynccontextmanager
        from unittest.mock import patch
        from coaching_evidence import Evidence
        calls = []
        @asynccontextmanager
        async def session(config):
            yield object()
        async def call(client, tool, args):
            calls.append(tool)
            return {
                'get_tutor_access': {'allowed': True},
                'get_attempt_context': {'attempt': {'id':'a', 'status':'completed', 'version':2, 'code':'new code'}, 'history':[{'id':'old'}]},
                'get_tutor_preferences': {'hintStyle':'direct', 'version':3},
            }[tool]
        with patch('coaching_evidence.platform_session', session), patch('coaching_evidence.call', call):
            result = Evidence(None).followup('a')
        self.assertEqual(calls, ['get_tutor_access', 'get_attempt_context', 'get_tutor_preferences'])
        self.assertEqual(result['records'][0]['attempt']['version'], 2)
        self.assertEqual(result['preferences']['version'], 3)
        self.assertEqual(result['ids'], ['a'])
        self.assertNotIn('snapshot', result)
        self.assertNotIn('insights', result)

    def test_denied_followup_does_not_read_records(self):
        from contextlib import asynccontextmanager
        from unittest.mock import patch
        from coaching_evidence import Evidence
        calls = []
        @asynccontextmanager
        async def session(config): yield object()
        async def call(client, tool, args):
            calls.append(tool)
            return {'allowed': False}
        with patch('coaching_evidence.platform_session', session), patch('coaching_evidence.call', call):
            with self.assertRaises(PermissionError): Evidence(None).followup('a')
        self.assertEqual(calls, ['get_tutor_access'])
