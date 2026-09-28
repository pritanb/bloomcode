"""Sanitised errors shared by workers; never expose SDK request bodies."""
class AIError(RuntimeError):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


def model_error(error):
    text = str(error).lower()
    if any(word in text for word in ('usage limit', 'rate limit', 'quota')):
        return AIError('usage_limit', 'Codex usage limit reached. Try again later.')
    if any(word in text for word in ('unauthorized', 'not signed in', 'authentication', '401')):
        return AIError('not_signed_in', 'Codex sign-in needs attention. Sign in again with Codex.')
    if 'model' in text and any(word in text for word in ('not found', 'unavailable', 'not supported')):
        return AIError('model_unavailable', 'The configured Codex model is unavailable. Check Settings.')
    return AIError('crashed', 'Codex could not finish the response. Check sign-in and retry.')
