"""Claude Code runs through the Claude Agent SDK, isolated like the Codex runtime.

Each run gets no built-in tools, no user/project settings, CLAUDE.md, skills,
plugins or hooks (safe mode), and no MCP servers unless the caller passes its
own. The CLI uses the learner's Claude plan login: API-key variables are
removed so a stray key never switches the account to pay-per-request billing.
"""
import asyncio
import json
import os
import time
from pathlib import Path
from ai_core.errors import model_error

API_KEY_VARIABLES = ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')
CLAUDE_CANDIDATES = (
    Path.home() / '.local/bin/claude',
    Path.home() / '.claude/local/claude',
    Path('/opt/homebrew/bin/claude'),
    Path('/usr/local/bin/claude'),
)


def scrub_env():
    # The SDK copies os.environ into the CLI's environment, so remove keys here.
    # Workers are dedicated processes, so this never affects other work.
    for name in API_KEY_VARIABLES:
        os.environ.pop(name, None)


def find_cli(configured=None):
    """The signed-in CLI the host found, else a standard install, else the SDK's bundled CLI."""
    if configured:
        return configured
    for path in CLAUDE_CANDIDATES:
        if os.access(path, os.X_OK):
            return str(path)
    return None


def base_options(*, cli_path, cwd, model, instructions, effort=None, persist=False, **extra):
    from claude_agent_sdk import ClaudeAgentOptions
    flags = {'safe-mode': None, 'no-chrome': None, 'disable-slash-commands': None}
    if not persist:
        flags['no-session-persistence'] = None
    return ClaudeAgentOptions(
        cli_path=find_cli(cli_path), cwd=str(cwd), model=model, effort=effort,
        system_prompt=instructions, tools=[], setting_sources=[], strict_mcp_config=True,
        permission_mode='dontAsk', extra_args=flags, **extra)


async def collect(prompt, options):
    """Run one query and return its ResultMessage."""
    from claude_agent_sdk import ResultMessage, query
    result = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage):
            result = message
    return result


class ClaudeStructuredModel:
    """Same interface as StructuredModel: one schema-constrained call per generate()."""
    def __init__(self, cli_path, workspace, model, effort):
        self.cli_path, self.workspace = cli_path, workspace
        self.model, self.effort = model, effort
        self.trace = []

    def generate(self, schema, instructions, data):
        options = base_options(cli_path=self.cli_path, cwd=self.workspace, model=self.model,
            effort=getattr(self.effort, 'value', self.effort), instructions=instructions,
            output_format={'type': 'json_schema', 'schema': schema})
        started = time.monotonic()
        try:
            result = asyncio.run(collect(json.dumps(data), options))
        except TimeoutError:
            raise
        except Exception as error:
            raise model_error(error, 'claude') from None
        if result is None:
            raise model_error('Incomplete response', 'claude')
        if result.is_error:
            raise model_error(' '.join(filter(None, [result.result, *(result.errors or [])])) or 'Incomplete response', 'claude')
        self.trace.append({'model': self.model, 'reasoningEffort': getattr(self.effort, 'value', self.effort),
            'latencySeconds': round(time.monotonic() - started, 3),
            'inputCharacters': len(json.dumps(data)), 'usage': result.usage})
        if result.structured_output is not None:
            return json.dumps(result.structured_output)
        return result.result or ''
