# Protocol-only fixture. Does not import Codex or read study data.
import json
import sys
import time
r = json.loads(input())
id = r['id']
mode = r['context']['mode']
def emit(type, **data): print(json.dumps(dict(v=1, id=id, type=type, **data)), flush=True)
if mode == 'hang': time.sleep(10)
elif mode == 'crash': sys.exit(1)
elif mode == 'malformed': print('not json', flush=True); time.sleep(10)
else:
    emit('evidence', seq=1, attemptId='outside' if mode == 'outside' else 'a1')
    json.loads(input())
    emit('candidate', seq=2, report={'findings': [], 'limitation': ''})
    reply = json.loads(input())
    if reply.get('error'):
        emit('candidate', seq=3, report={'findings': [], 'limitation': 'corrected'})
        json.loads(input())
    emit('result', trace=[])
