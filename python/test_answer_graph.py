import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

from answer_graph import AnswerFlow
from tutor import TutorSession
from types import SimpleNamespace
from pathlib import Path


def observation(id, attempt, polarity='difficulty', excerpt='boundary trouble'):
    return {'id': id, 'attemptId': attempt, 'problemId': attempt, 'polarity': polarity,
            'summary': 'Search bounds', 'sourceField': 'notes', 'excerpt': excerpt,
            'evidenceType': 'learner_reported'}


class AnswerFlowTests(unittest.TestCase):
    def run_flow(self, tool, message='Why am I struggling with Binary Search?', snapshot=None):
        @asynccontextmanager
        async def session(config): yield object()
        answers = []
        def answer(message, **kwargs):
            answers.append((message, kwargs['snapshot']))
            if kwargs.get('on_text'): kwargs['on_text']('Grounded answer')
            return 'Grounded answer'
        flow = AnswerFlow(Path('unused'), answer)
        with patch('answer_graph.platform_session', session), patch('answer_graph.call', tool), patch(
                'answer_graph.load_snapshot', return_value=snapshot or {'status':'available'}):
            result = flow.reply(message)
        return flow, answers, result

    def test_retrieves_both_polarities_and_checks_sources_before_one_answer(self):
        calls = []
        async def tool(session, name, args):
            calls.append((name, args))
            if name == 'get_tutor_access': return {'allowed': True}
            if name == 'get_learning_insights':
                return {'enabled':True, 'embeddingStatus':'ready', 'analyzed':2, 'total':4, 'stale':True}
            if name == 'retrieve_learning_evidence':
                return {'observations': [observation('positive','success','strength')] if args['limit'] == 3 else [
                    observation('negative','failed'), observation('stale','changed', excerpt='removed note')]}
            return {'attempt': {'id':args['attemptId'], 'status':'completed', 'notes':'boundary trouble', 'code':'x'*9000}}
        flow, answers, result = self.run_flow(tool)
        self.assertEqual(len(answers), 1)
        bundle = answers[0][1]['answerEvidence']
        self.assertEqual({o['id'] for o in bundle['observations']}, {'negative','positive'})
        self.assertEqual(len(bundle['attempts']), 3)
        self.assertLessEqual(len(bundle['attempts'][0]['attempt']['code']), 6000)
        self.assertIn('code', bundle['attempts'][0]['truncatedFields'])
        self.assertTrue(bundle['coverage']['stale'])
        self.assertTrue(any('excluded' in s for s in bundle['limitations']))
        self.assertEqual(calls[0][0], 'get_tutor_access')
        self.assertEqual(calls[-1][0], 'get_tutor_access')

    def test_disabled_search_uses_snapshot_without_starting_embeddings(self):
        async def tool(session, name, args):
            if name == 'get_tutor_access': return {'allowed':True}
            if name == 'get_learning_insights': return {'enabled':False, 'embeddingStatus':'idle'}
            self.fail('Disabled embeddings must not be searched')
        _, answers, _ = self.run_flow(tool, snapshot={'status':'available', 'attemptCount':2})
        self.assertEqual(answers[0][1]['attemptCount'], 2)
        self.assertEqual(answers[0][1]['answerEvidence']['status'], 'unavailable')

    def test_denial_discards_data_and_never_calls_model_including_exception_groups(self):
        for grouped in [False, True]:
            checks = 0
            async def tool(session, name, args):
                nonlocal checks
                if name == 'get_tutor_access':
                    checks += 1
                    if checks == 2:
                        error = PermissionError('blocked')
                        raise ExceptionGroup('transport', [error]) if grouped else error
                    return {'allowed':True}
                if name == 'get_learning_insights': return {'enabled':True, 'embeddingStatus':'ready'}
                if name == 'retrieve_learning_evidence': return {'observations': [observation('o','a')]}
                return {'attempt': {'status':'completed', 'notes':'boundary trouble'}}
            with self.assertRaises(PermissionError): self.run_flow(tool)

    def test_unavailable_backend_is_not_retried_by_the_retrieval_node(self):
        async def tool(*args): self.fail('Do not retry an unavailable platform')
        _, answers, _ = self.run_flow(tool, snapshot={'status':'unavailable'})
        self.assertEqual(answers[0][1]['answerEvidence']['status'], 'unavailable')

    def test_transport_failure_does_not_look_like_empty_history(self):
        async def tool(*args): raise OSError('private credential must not be exposed')
        _, answers, _ = self.run_flow(tool)
        bundle = answers[0][1]['answerEvidence']
        self.assertEqual(bundle['status'], 'unavailable')
        self.assertNotIn('credential', str(bundle))
        self.assertEqual(bundle['observations'], [])

    def test_ordinary_reply_uses_graph(self):
        tutor = TutorSession(SimpleNamespace(id='chat'), Path('unused'), 'test', False)
        tutor.answer_flow = SimpleNamespace(reply=lambda *a, **kw: 'from graph')
        self.assertEqual(tutor.reply('Why Binary Search?'), 'from graph')

    def test_short_followup_search_keeps_subject_but_refreshes_records(self):
        queries, delivered = [], []
        @asynccontextmanager
        async def session(config): yield object()
        async def tool(session, name, args):
            if name == 'get_tutor_access': return {'allowed': True}
            if name == 'get_learning_insights': return {'enabled':True, 'embeddingStatus':'ready'}
            if name == 'retrieve_learning_evidence':
                queries.append(args['query'])
                return {'observations': []}
        def respond(message, **kw):
            kw['on_text']('text')
            return 'answer'
        flow = AnswerFlow(Path('unused'), respond)
        with patch('answer_graph.platform_session', session), patch('answer_graph.call', tool), patch(
                'answer_graph.load_snapshot', return_value={'status':'available'}):
            flow.reply('Why am I struggling with Binary Search questions?', on_text=delivered.append)
            flow.reply('Can you explain?', on_text=delivered.append)
        self.assertIn('Binary Search', queries[2])
        self.assertEqual(delivered, ['text','text'])
