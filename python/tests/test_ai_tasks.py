import json
import unittest
from insights.extract import extract
from reviews.review import review, review_context
from recommendations.topics import recommend
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

    def test_errors_are_classified_without_echoing_model_requests(self):
        for message, kind in [('401 unauthorized private code','not_signed_in'),
                              ('usage limit secret','usage_limit'), ('model unavailable secret','model_unavailable'),
                              ('other failure secret','crashed')]:
            error = model_error(message)
            self.assertEqual(error.kind,kind)
            self.assertNotIn('secret',str(error))
