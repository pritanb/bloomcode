import json
r = json.loads(input())
id = r['id']
kind = r['context'].get('mode')
message = dict(v=1, id=id)
if kind == 'usage':
    message.update(type='error', kind='usage_limit', message='Codex usage limit reached.')
elif kind == 'unexpected_read':
    message.update(type='evidence', seq=1, attemptId='not-authorised')
else:
    assert 'system' not in r and 'user' not in r
    message.update(type='result', text='Summary:\nPython feedback', model=r['model'], trace=[])
print(json.dumps(message), flush=True)
