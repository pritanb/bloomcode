import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ai_core.runtime import runtime_config, background_runtime
from ai_core.evidence import matches_source


class CoreTests(unittest.TestCase):
    def test_runtime_isolated_and_background_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            auth = Path(directory) / 'auth.json'
            auth.write_text('{}')
            with patch('ai_core.runtime.auth_file', return_value=auth), patch('ai_core.runtime.Codex') as codex:
                with background_runtime('/configured/codex'):
                    config = codex.call_args.args[0]
                    home = Path(config.env['CODEX_HOME'])
                    self.assertEqual((home / 'config.toml').read_text(), '')
                    self.assertEqual((home / 'auth.json').resolve(), auth.resolve())
                    self.assertEqual(config.codex_bin, '/configured/codex')
                    self.assertIn('features.shell_tool=false', config.config_overrides)
                self.assertFalse(home.exists())
                self.assertTrue(auth.exists())

    def test_source_match_does_not_accept_missing_or_changed_excerpt(self):
        observation = {'sourceField': 'notes', 'excerpt': 'kept mid'}
        self.assertTrue(matches_source(observation, {'notes': 'I kept mid'}))
        self.assertFalse(matches_source(observation, {'notes': 'discarded mid'}))
        self.assertFalse(matches_source({'sourceField': 'notes', 'excerpt': ''}, {}))

    def test_structured_background_call_does_not_create_an_mcp_server(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from ai_core.model import StructuredModel
        codex = MagicMock()
        codex.thread_start.return_value.run.return_value = SimpleNamespace(
            error=None, status=SimpleNamespace(value='completed'), final_response='{}', usage=None)
        model = StructuredModel(codex, {'config': {}}, 'test', 'low')
        self.assertEqual(model.generate({}, 'instructions', {}), '{}')
        self.assertEqual(codex.thread_start.call_args.kwargs['config'], {})
        self.assertTrue(codex.thread_start.call_args.kwargs['ephemeral'])
        self.assertEqual(len(model.trace), 1)
