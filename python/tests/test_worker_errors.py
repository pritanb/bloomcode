"""Exercise real worker entry points: error frames must survive error handling."""
from contextlib import redirect_stdout
from io import StringIO
import json
import unittest
from unittest.mock import patch

from ai_core.errors import AIError
import ai_worker
import insights_worker


class WorkerErrorsTests(unittest.TestCase):
    def run_worker(self, worker, kind, error):
        request = {'v': 1, 'type': 'start', 'id': 'test-job', 'kind': kind,
                   'model': 'test', 'effort': 'low', 'context': {'evidence': []}}
        output = StringIO()
        with patch('signal.signal'), patch('ai_core.runtime.background_runtime', side_effect=error), \
                redirect_stdout(output), self.assertRaises(SystemExit) as stopped:
            if worker is ai_worker:
                with patch.object(worker, 'receive', return_value=request):
                    worker.main()
            else:
                worker.main(request)
        self.assertEqual(stopped.exception.code, 1)
        message = json.loads(output.getvalue())
        self.assertEqual(message['type'], 'error')
        self.assertEqual(message['id'], 'test-job')
        return message

    def test_both_workers_preserve_classified_error(self):
        for worker, kind in ((ai_worker, 'extraction'), (insights_worker, 'report')):
            with self.subTest(kind=kind):
                message = self.run_worker(worker, kind, AIError('not_signed_in', 'Sign in again.'))
                self.assertEqual(message['kind'], 'not_signed_in')
                self.assertEqual(message['message'], 'Sign in again.')

    def test_unexpected_value_error_is_reported_without_private_details(self):
        message = self.run_worker(insights_worker, 'report', ValueError('private study text'))
        self.assertEqual(message['kind'], 'crashed')
        self.assertNotIn('private', message['message'])

    def test_report_validation_exhaustion_returns_error_instead_of_crashing_handler(self):
        output = StringIO()
        request = {'v': 1, 'type': 'start', 'id': 'validation-job',
                   'model': 'test', 'effort': 'low', 'context': {'evidence': []}}
        with patch('signal.signal'), patch('ai_core.runtime.background_runtime') as runtime, \
                patch('ai_core.model.StructuredModel') as model, redirect_stdout(output), \
                self.assertRaises(SystemExit) as stopped:
            runtime.return_value.__enter__.return_value = (None, {})
            model.return_value.generate.return_value = '{}'
            insights_worker.main(request)
        self.assertEqual(stopped.exception.code, 1)
        self.assertEqual(model.return_value.generate.call_count, 2)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[-1]['type'], 'error')
        self.assertIn('validation', messages[-1]['message'])
        self.assertFalse(any(message['type'] == 'result' for message in messages))
