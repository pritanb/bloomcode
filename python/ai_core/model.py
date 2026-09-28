"""One model call per invocation. Retry policy belongs to the feature workflow."""
from contextlib import closing
import json
import time
from openai_codex import ApprovalMode, Sandbox
from ai_core.errors import model_error


def stream_events(turn):
    with closing(turn.stream()) as events:
        yield from events


class StructuredModel:
    def __init__(self, codex, options, model, effort):
        self.codex, self.options = codex, options
        self.model, self.effort = model, effort
        self.trace = []

    def generate(self, schema, instructions, data):
        options = {**self.options, 'model': self.model, 'base_instructions': instructions,
                   'config': self.options.get('config', {}),
                   'approval_mode': ApprovalMode.deny_all, 'sandbox': Sandbox.read_only}
        started = time.monotonic()
        try:
            thread = self.codex.thread_start(ephemeral=True, **options)
            result = thread.run(json.dumps(data), output_schema=schema, effort=self.effort)
        except TimeoutError:
            raise
        except Exception as error:
            raise model_error(error) from None
        self.trace.append({'model': self.model, 'reasoningEffort': getattr(self.effort, 'value', self.effort),
            'latencySeconds': round(time.monotonic() - started, 3),
            'inputCharacters': len(json.dumps(data)),
            'usage': result.usage.model_dump(mode='json') if result.usage else None})
        if result.error or result.status.value != 'completed':
            raise model_error(result.error or 'Incomplete response')
        return result.final_response or ''
