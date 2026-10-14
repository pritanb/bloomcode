"""Bounded evidence retrieval through the existing platform MCP client."""
import asyncio
import hashlib
import json
from uuid import UUID
from tutor.learner_state import platform_session, load_snapshot


from ai_core.evidence import call, compact


class Evidence:
    def __init__(self, config): self.config = config

    def check_access(self):
        async def read():
            async with platform_session(self.config) as session:
                data = await call(session, 'get_tutor_access', {})
                if not data['allowed']:
                    raise PermissionError('Finish or cancel active practice before coaching.')
        asyncio.run(read())

    def resolve(self, target, context_id):
        # The target comes directly from a button or /coach command, never a model.
        latest = target.lower() == 'latest'
        id, problem = None, None
        if target.lower() == 'this':
            if not context_id:
                raise ValueError('Open a completed attempt or use /coach latest.')
            id = context_id
        elif not latest:
            try:
                id = str(UUID(target))
            except ValueError:
                problem = target
        async def read():
            async with platform_session(self.config) as session:
                if id:
                    data = await call(session, 'get_attempt_context', {'attemptId': id})
                    if data['attempt']['status'] != 'completed':
                        raise PermissionError('Choose a completed attempt for coaching.')
                    return id, []
                args = {'limit': 5}
                if problem: args['problem'] = problem
                data = await call(session, 'get_recent_attempts', args)
                rows = data['attempts']
                if latest and rows: return rows[0]['id'], []
                if len(rows) == 1: return rows[0]['id'], []
                return None, [{'id': a['id'], 'title': a['problem']['title'],
                               'date': a['finishedAt']} for a in rows]
        return asyncio.run(read())

    def followup(self, id):
        """Fresh access, selected attempt, preferences and lessons; no broad history or insights."""
        async def read():
            async with platform_session(self.config) as session:
                access = await call(session, 'get_tutor_access', {})
                if not access['allowed']:
                    raise PermissionError('Finish or cancel active practice before coaching.')
                context = await call(session, 'get_attempt_context', {'attemptId': id})
                if context['attempt']['status'] != 'completed':
                    raise PermissionError('Coaching requires a completed attempt.')
                chosen = compact(context)
                preferences = {'status': 'unavailable'}
                lessons = {'status': 'unavailable'}
                try:
                    preferences = {'status': 'available', **await call(session, 'get_tutor_preferences', {})}
                except PermissionError:
                    raise
                except RuntimeError:
                    pass
                try:
                    lessons = {'status': 'available', **await call(session, 'get_tutor_notes', {})}
                except PermissionError:
                    raise
                except RuntimeError:
                    pass
                return {'records': [chosen], 'preferences': preferences, 'tutorNotes': lessons, 'ids': [id],
                        'scope': 'Selected completed attempt only; request broader evidence for comparisons',
                        'fingerprint': hashlib.sha256(json.dumps(chosen, sort_keys=True).encode()).hexdigest()}
        return asyncio.run(read())

    def __call__(self, id):
        self.check_access()
        snapshot = load_snapshot(self.config)
        if snapshot['status'] == 'blocked':
            raise PermissionError('Finish or cancel active practice before coaching.')
        async def read():
            async with platform_session(self.config) as session:
                context = await call(session, 'get_attempt_context', {'attemptId': id})
                if context['attempt']['status'] != 'completed':
                    raise PermissionError('Coaching requires a completed attempt.')
                chosen = compact(context)
                records = [chosen]
                # Same-problem comparisons are relevant but cannot establish cross-problem mastery.
                for previous in context.get('history', [])[-2:]:
                    if previous.get('status') == 'completed':
                        records.append(compact({'attempt': previous}))
                insights = {'status': 'unavailable'}
                observations = []
                try:
                    report = await call(session, 'get_learning_insights', {})
                    # Keep the report bounded and mark truncation rather than silently claiming complete coverage.
                    report_text = json.dumps(report)
                    insights = {'status': 'available', 'report': report_text[:10000], 'truncated': len(report_text) > 10000}
                    title = context['attempt'].get('problem', {}).get('title', '')
                    found = await call(session, 'retrieve_learning_evidence', {'query': title or 'recent practice difficulties', 'limit': 5})
                    observations = found.get('observations', [])[:5]
                except PermissionError:
                    raise
                except RuntimeError:
                    pass
                return {'snapshot': snapshot, 'records': records, 'insights': insights,
                        'observations': json.dumps(observations)[:10000],
                        'observationsMayBeTruncated': len(json.dumps(observations)) > 10000,
                        'ids': [r['attempt']['id'] for r in records] + [o['id'] for o in observations if isinstance(o, dict) and 'id' in o],
                        'scope': 'Selected attempt and up to two same-problem attempts; not a diagnosis across problems',
                        'fingerprint': hashlib.sha256(json.dumps(chosen, sort_keys=True).encode()).hexdigest()}
        return asyncio.run(read())
