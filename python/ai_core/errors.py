"""Sanitised errors shared by workers; never expose SDK request bodies."""
class AIError(RuntimeError):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


SIGN_IN = {
    'codex': 'Codex sign-in needs attention. Sign in again with Codex.',
    'claude': 'Claude Code is not signed in. Run `claude auth login` in a terminal.',
}
LABEL = {'codex': 'Codex', 'claude': 'Claude Code'}


def model_error(error, provider='codex'):
    text = str(error).lower()
    label = LABEL[provider]
    if any(word in text for word in ('usage limit', 'rate limit', 'quota', 'limit reached')):
        return AIError('usage_limit', f'{label} usage limit reached. Try again later.')
    if any(word in text for word in ('unauthorized', 'not signed in', 'not logged in', '/login',
                                     'invalid api key', 'authentication', '401')):
        return AIError('not_signed_in', SIGN_IN[provider])
    if 'model' in text and any(word in text for word in ('not found', 'unavailable', 'not supported', 'does not exist')):
        return AIError('model_unavailable', f'The configured {label} model is unavailable. Check Settings.')
    return AIError('crashed', f'{label} could not finish the response. Check sign-in and retry.')
