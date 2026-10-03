"""Choose the model runtime for a background task from the host's start request."""
from contextlib import contextmanager
from tempfile import TemporaryDirectory


@contextmanager
def background_model(request):
    """Yield a structured model for the requested provider. Imports stay lazy so
    each provider's SDK is only needed when that provider is selected."""
    if request.get('provider') == 'claude':
        from ai_core.claude import ClaudeStructuredModel, scrub_env
        scrub_env()
        with TemporaryDirectory(prefix='bloomcode-ai-') as workspace:
            yield ClaudeStructuredModel(request.get('cliPath'), workspace, request['model'], request['effort'])
        return
    from ai_core.runtime import background_runtime
    from ai_core.model import StructuredModel
    from openai_codex.generated.v2_all import ReasoningEffort
    with background_runtime(request.get('cliPath') or request.get('codexPath')) as (codex, options):
        yield StructuredModel(codex, options, request['model'], ReasoningEffort(request['effort']))
