import json
import unittest
from insights.extract import extract
from reviews.review import review, review_context
from recommendations.topics import recommend
from recommendations.plan import draft
from interview.hint import hint
from ai_core.errors import model_error

class Model:
    def __init__(self, value): self.value, self.calls = value, []
    def generate(self, schema, prompt, data):
        self.calls.append((schema, prompt, data))
        return json.dumps(self.value)

class TaskTests(unittest.TestCase):
    def test_review_formats_feedback_and_limits_completed_history(self):
        fields = {k: 'Specific feedback' for k in ('summary','strengths','improvements','complexity','practice')}
        model = Model(fields)
        context = {'attempt': {'code': 'return 1'}, 'history': [{'status':'active'}] + [{'status':'completed'}]*9}
        text = review(model, context)
        self.assertIn('Summary:\nSpecific feedback', text)
        self.assertIn('Complexity:\nSpecific feedback', text)
        self.assertEqual(len(model.calls[0][2]['history']), 5)
        self.assertEqual(len(model.calls), 1)
        with self.assertRaises(ValueError): review(Model({}), context)

    def test_extraction_does_not_accept_unsourced_fields(self):
        model = Model({'observations': [], 'limitation': 'No evidence'})
        self.assertEqual(json.loads(extract(model, {'code': ''}))['observations'], [])
        with self.assertRaises(ValueError):
            extract(Model({'observations': [{'summary': 'Unsupported'}], 'limitation': ''}), {})

    def test_topic_selection_is_bounded_unique_and_known(self):
        context = {'topics': [{'topicNumber': i} for i in range(1,5)], 'reasonMaxWords': 30}
        good = {'topics': [{'topicNumber': i, 'reason': 'Recent evidence'} for i in (3,1,2)]}
        self.assertEqual(json.loads(recommend(Model(good),context)),good)
        for ids in [(1,1,2),(1,2,8),(1,)]:
            with self.assertRaises(ValueError):
                recommend(Model({'topics': [{'topicNumber':i,'reason':'Evidence'} for i in ids]}),context)

    def test_plan_mixes_practice_repairs_and_transfer_checks_by_number(self):
        context = {'candidates': [{'candidateNumber': i} for i in range(1, 5)],
                   'checks': [{'checkNumber': 1, 'kind': 'transfer'}, {'checkNumber': 2, 'kind': 'repair'}],
                   'picksRequired': 3}
        item = lambda c, k, same=(), reason='Goal': {'candidateNumber': c, 'checkNumber': k, 'sameIdea': list(same), 'reason': reason}
        good = {'summary': 'Graphs today.', 'items': [item(None, 1, ['Capacity To Ship Packages Within D Days'], ''), item(2, 2), item(4, None)]}
        self.assertEqual(json.loads(draft(Model(good), context)), good)
        # The host resolves or skips individual items; only an empty or malformed plan fails here.
        with self.assertRaises(ValueError):
            draft(Model({'summary': 'x', 'items': []}), context)
        with self.assertRaises(ValueError):
            draft(Model({'summary': 'x', 'items': [{'candidateNumber': 1}]}), context)

    def test_hint_sends_only_the_attempt_in_progress_and_grades_help(self):
        good = {'reply': 'What happens with [3, 3]?', 'hint': 'Check duplicates.', 'level': 'small', 'analysis': None}
        model = Model(good)
        context = {'problem': {'title': 'Two Sum'}, 'language': 'python', 'code': 'x' * 30000,
                   'stuckAt': '12:30', 'newStuck': True, 'messages': [{'role': 'user', 'text': 'Stuck'}] * 30,
                   'notes': 'private', 'tags': ['Hash Table']}
        self.assertEqual(json.loads(hint(model, context)), good)
        data = model.calls[0][2]
        self.assertEqual(set(data), {'problem', 'language', 'code', 'stuckAt', 'newStuck', 'messages'})
        self.assertEqual((len(data['code']), len(data['messages'])), (20000, 20))
        for bad in [{**good, 'level': 'solution'}, {**good, 'extra': 1}, {**good, 'hint': 'x' * 301}]:
            with self.assertRaises(ValueError): hint(Model(bad), context)

    def test_errors_are_classified_without_echoing_model_requests(self):
        for message, kind in [('401 unauthorized private code','not_signed_in'),
                              ('usage limit secret','usage_limit'), ('model unavailable secret','model_unavailable'),
                              ('other failure secret','crashed')]:
            error = model_error(message)
            self.assertEqual(error.kind,kind)
            self.assertNotIn('secret',str(error))
