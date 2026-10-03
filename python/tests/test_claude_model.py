"""Claude Code background calls: isolation options, plan login only, output and errors."""
import json
import os
import unittest
from unittest.mock import patch

from claude_agent_sdk import ResultMessage
from ai_core.claude import ClaudeStructuredModel, scrub_env
from ai_core.errors import AIError
from ai_core.providers import background_model


def result(**fields):
    base = dict(subtype='success', duration_ms=1, duration_api_ms=1, is_error=False,
                num_turns=1, session_id='s')
    return ResultMessage(**{**base, **fields})


def fake_query(*messages, calls=None):
    async def query(prompt, options):
        if calls is not None:
            calls.append((prompt, options))
        for message in messages:
            yield message
    return query


class ClaudeModelTests(unittest.TestCase):
    def test_runs_isolated_with_the_schema_and_returns_structured_json(self):
        calls = []
        schema = {'type': 'object', 'properties': {'status': {'type': 'string'}}}
        with patch('claude_agent_sdk.query', fake_query(
                result(structured_output={'status': 'ready'}, usage={'output_tokens': 4}), calls=calls)):
            model = ClaudeStructuredModel('/bin/claude', '/tmp/w', 'opus', 'high')
            text = model.generate(schema, 'Return status ready.', {'notes': 'secret'})
        self.assertEqual(json.loads(text), {'status': 'ready'})
        prompt, options = calls[0]
        self.assertEqual(json.loads(prompt), {'notes': 'secret'})
        self.assertEqual(options.tools, [])
        self.assertEqual(options.setting_sources, [])
        self.assertTrue(options.strict_mcp_config)
        self.assertEqual(options.mcp_servers, {})
        self.assertEqual(options.permission_mode, 'dontAsk')
        self.assertEqual(options.system_prompt, 'Return status ready.')
        self.assertEqual((options.model, options.effort, options.cli_path), ('opus', 'high', '/bin/claude'))
        self.assertEqual(options.output_format, {'type': 'json_schema', 'schema': schema})
        for flag in ('safe-mode', 'no-session-persistence', 'disable-slash-commands'):
            self.assertIn(flag, options.extra_args)
        self.assertEqual(model.trace[0]['model'], 'opus')
        self.assertEqual(model.trace[0]['reasoningEffort'], 'high')

    def test_classifies_sign_in_and_usage_failures(self):
        for text, kind in (('Not logged in · Please run /login', 'not_signed_in'),
                           ('Claude usage limit reached.', 'usage_limit')):
            with self.subTest(kind=kind), patch('claude_agent_sdk.query',
                    fake_query(result(is_error=True, subtype='error', result=text))):
                with self.assertRaises(AIError) as raised:
                    ClaudeStructuredModel(None, '/tmp/w', 'opus', 'low').generate({}, 'x', {})
                self.assertEqual(raised.exception.kind, kind)
                self.assertIn('Claude Code', str(raised.exception))

    def test_api_keys_never_reach_the_cli(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k', 'ANTHROPIC_AUTH_TOKEN': 't'}):
            scrub_env()
            self.assertNotIn('ANTHROPIC_API_KEY', os.environ)
            self.assertNotIn('ANTHROPIC_AUTH_TOKEN', os.environ)

    def test_background_model_selects_claude_from_the_start_request(self):
        request = {'provider': 'claude', 'cliPath': '/bin/claude', 'model': 'opus', 'effort': 'xhigh'}
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k'}), background_model(request) as model:
            self.assertIsInstance(model, ClaudeStructuredModel)
            self.assertEqual((model.cli_path, model.model, model.effort), ('/bin/claude', 'opus', 'xhigh'))
            self.assertNotIn('ANTHROPIC_API_KEY', os.environ)
