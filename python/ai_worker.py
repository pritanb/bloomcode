"""Task-based entry point for stateless AI work. No prompts are accepted from the host."""
import signal
import sys
from ai_core.protocol import emit, receive


def main():
    request = receive()
    if request.get('type') != 'start' or not isinstance(request.get('id'), str):
        raise ValueError('Expected an AI start request')
    if request.get('kind') == 'report':
        from insights_worker import main as report
        return report(request)
    id = request['id']
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        from ai_core.runtime import background_runtime
        from ai_core.model import StructuredModel
        from openai_codex.generated.v2_all import ReasoningEffort
        from insights.extract import extract
        from reviews.review import review
        from recommendations.topics import recommend
        from recommendations.plan import draft
        from pydantic import BaseModel, ConfigDict
        from typing import Literal
        class Connection(BaseModel):
            model_config = ConfigDict(extra='forbid')
            status: Literal['ready']
        def connection(model, _):
            value = model.generate(Connection.model_json_schema(), 'Return status ready.', {})
            return Connection.model_validate_json(value).model_dump_json()
        tasks = {'extraction': extract, 'review': review, 'topics': recommend, 'plan': draft, 'connection': connection}
        handler = tasks[request['kind']]
        with background_runtime(request.get('codexPath')) as (codex, options):
            model = StructuredModel(codex, options, request['model'], ReasoningEffort(request['effort']))
            text = handler(model, request['context'])
            emit('result', id, text=text, model=request['model'], trace=model.trace)
    except Exception as error:
        from ai_core.errors import AIError
        if isinstance(error, AIError):
            kind, message = error.kind, str(error)
        elif isinstance(error, ModuleNotFoundError):
            kind, message = 'not_installed', 'Install python/requirements.txt in the configured Python environment.'
        elif isinstance(error, ValueError):
            kind, message = 'invalid_output', 'The AI response did not match the required task format.'
        else:
            kind, message = 'crashed', 'AI task failed. Check Python dependencies and file-based Codex sign-in.'
        emit('error', id, kind=kind, message=message)
        sys.exit(1)


if __name__ == '__main__': main()
