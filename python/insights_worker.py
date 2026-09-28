"""One report job. No chat state, tools, database credentials, or nested retries."""
import signal
import sys
from ai_core.protocol import emit, receive


def main(request=None):
    request = request or receive()
    id = request.get('id')
    if request.get('type') != 'start' or not isinstance(id, str):
        raise ValueError('Expected a report start request.')
    # SIGTERM unwinds SDK/temp-directory contexts; the host enforces a hard kill fallback.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        from ai_core.runtime import background_runtime
        from ai_core.model import StructuredModel
        from insights.report import ReportFlow
        from openai_codex.generated.v2_all import ReasoningEffort
        serial = 0
        def exchange(kind, **data):
            nonlocal serial
            serial += 1
            emit(kind, id, seq=serial, **data)
            reply = receive(id)
            if reply.get('type') != kind + '_result' or reply.get('seq') != serial:
                raise ValueError('Mismatched report response.')
            if reply.get('fatal'):
                raise RuntimeError(reply['fatal'])
            return reply
        def read(attempt_id):
            return exchange('evidence', attemptId=attempt_id)['attempt']
        def validate(report):
            return exchange('candidate', report=report).get('error')
        with background_runtime(request.get('codexPath')) as (codex, options):
            model = StructuredModel(codex, options, request['model'], ReasoningEffort(request['effort']))
            flow = ReportFlow(model, read, validate, lambda text: emit('progress', id, message=text))
            flow.run(request['context'])
            emit('result', id, trace=model.trace)
    except Exception as error:
        # Do not send model output, source records, SDK request bodies, or credentials to logs.
        message = str(error) if isinstance(error, (RuntimeError, ModuleNotFoundError)) else 'Learning report worker failed.'
        emit('error', id, message=message[:1000], kind=getattr(error, 'kind', 'crashed'))
        sys.exit(1)


if __name__ == '__main__':
    main()
