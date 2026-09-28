"""Isolated Codex profiles, sharing only the user's file-based sign-in."""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
import os
from openai_codex import Codex, CodexConfig
from ai_core.errors import AIError

DISABLED_FEATURES = (
    'shell_tool', 'unified_exec', 'apps', 'browser_use', 'browser_use_external',
    'computer_use', 'image_generation', 'multi_agent', 'plugins', 'view_image',
    'in_app_browser', 'goals', 'skill_search', 'tool_suggest', 'hooks',
)


def auth_file():
    path = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'auth.json'
    if not path.is_file():
        raise AIError('not_signed_in', 'No file-based Codex sign-in found. Sign in with Codex using auth.json in CODEX_HOME; keyring-only sign-in is not supported.')
    return path


def runtime_config(home, workspace, codex_bin=None):
    return CodexConfig(codex_bin=codex_bin, cwd=str(workspace),
        env={'CODEX_HOME': str(home)}, config_overrides=(
            'cli_auth_credentials_store="file"', 'web_search="disabled"',
            *(f'features.{name}=false' for name in DISABLED_FEATURES)))


@contextmanager
def background_runtime(codex_bin=None):
    credential = auth_file()
    with TemporaryDirectory(prefix='bloomcode-ai-') as directory:
        root = Path(directory)
        home, workspace = root / 'codex-home', root / 'workspace'
        home.mkdir(mode=0o700)
        workspace.mkdir(mode=0o700)
        (home / 'auth.json').symlink_to(credential.resolve())
        (home / 'config.toml').write_text('')
        with Codex(runtime_config(home, workspace, codex_bin)) as codex:
            yield codex, {'cwd': str(workspace), 'config': {}}
