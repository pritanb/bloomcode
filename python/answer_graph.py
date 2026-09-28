"""Retrieve evidence before ordinary answers; Codex still owns chat and proposals."""
import asyncio
import json
import os
import time
from typing import TypedDict

# Keep question text and retrieved study evidence local to this app's traces.
os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'

from langgraph.graph import StateGraph, START, END
from coaching_evidence import call, compact
from learner_state import load_snapshot, platform_session


class AnswerState(TypedDict, total=False):
    message: str
    context_id: str | None
    snapshot: dict
    evidence: dict
    response: str


def select_observations(primary, contrast):
    # Include a counterexample when one was retrieved; similarity is not a verdict.
    rows = {o['id']: o for o in [*primary, *contrast]}
    strengths = [o for o in rows.values() if o.get('polarity') == 'strength']
    difficulties = [o for o in rows.values() if o.get('polarity') == 'difficulty']
    chosen = {}
    for i in range(max(len(strengths), len(difficulties))):
        for group in (difficulties, strengths):
            if i < len(group): chosen[group[i]['id']] = group[i]
    return list(chosen.values())[:5]


async def retrieve_evidence(config, query, context_id=None):
    bundle = {'status': 'unavailable', 'observations': [], 'attempts': [],
              'limitations': [], 'query': query[:800]}
    try:
        async with platform_session(config) as session:
            if not (await call(session, 'get_tutor_access', {}))['allowed']:
                raise PermissionError('Finish or cancel active practice before using the tutor.')
            observations = []
            try:
                info = await call(session, 'get_learning_insights', {})
                if info.get('hidden'):
                    raise PermissionError('Study evidence is hidden during assessment.')
                bundle['coverage'] = {k: info.get(k) for k in ('enabled', 'analyzed', 'total', 'stale', 'embeddingStatus', 'reportStatus')}
                bundle['coverage']['reportAvailable'] = info.get('report') is not None
                if info.get('enabled') and info.get('embeddingStatus') == 'ready':
                    primary = await call(session, 'retrieve_learning_evidence', {'query': query[:800], 'limit': 5})
                    contrast = await call(session, 'retrieve_learning_evidence', {
                        'query': query[:650] + ' successful independent attempts strengths improvement counterexamples', 'limit': 3})
                    observations = select_observations(primary.get('observations', []), contrast.get('observations', []))
                    bundle['status'] = 'available' if observations else 'empty'
                else:
                    bundle['limitations'].append('Learning Insights is disabled or its embedding index is not ready.')
            except RuntimeError:
                bundle['limitations'].append('Evidence search is unavailable; this is not an empty learning history.')
            ids = list(dict.fromkeys(([context_id] if context_id else []) + [o['attemptId'] for o in observations]))
            if len(ids) > 3:
                bundle['limitations'].append('Only three linked/current attempts were inspected.')
            verified = []
            for id in ids[:3]:
                try:
                    context = await call(session, 'get_attempt_context', {'attemptId': id})
                except RuntimeError:
                    bundle['limitations'].append('A supporting attempt could not be retrieved.')
                    continue
                attempt = context['attempt']
                if attempt.get('status') != 'completed':
                    raise PermissionError('Only completed attempts can be inspected.')
                record = compact(context, limits=(('code', 6000), ('notes', 1500), ('takeaway', 1000)))
                bundle['attempts'].append(record)
                for observation in observations:
                    if observation['attemptId'] != id: continue
                    source = attempt.get(observation.get('sourceField'))
                    source = source if isinstance(source, str) else json.dumps(source)
                    excerpt = observation.get('excerpt', '')
                    if not excerpt or excerpt not in source:
                        bundle['limitations'].append('An observation no longer matches its source and was excluded.')
                        continue
                    verified.append({k: observation.get(k) for k in (
                        'id', 'attemptId', 'problemId', 'summary', 'polarity', 'evidenceType', 'sourceField', 'excerpt')})
            bundle['observations'] = verified
            bundle['limitations'].append('Similarity-ranked sample, not complete topic coverage. Absence of counterexamples is not proof.')
            # Do not pass records forward if assessment access changed during retrieval.
            if not (await call(session, 'get_tutor_access', {}))['allowed']:
                raise PermissionError('Finish or cancel active practice before using the tutor.')
    except PermissionError:
        raise
    except Exception as error:
        if isinstance(error, BaseExceptionGroup) and error.subgroup(PermissionError):
            raise PermissionError('Finish or cancel active practice before using the tutor.') from None
        # MCP transport failures can be ExceptionGroups. Discard partial data.
        return {'status': 'unavailable', 'observations': [], 'attempts': [],
                'limitations': ['Evidence retrieval failed. Do not infer an empty history.']}
    return bundle


class AnswerFlow:
    def __init__(self, config, respond):
        self.config, self.respond = config, respond
        self.previous_question = None
        self.last_evidence = None
        self.timings = {}
        graph = StateGraph(AnswerState)
        graph.add_node('snapshot', self._snapshot)
        graph.add_node('retrieve', self._retrieve)
        graph.add_node('answer', self._answer)
        graph.add_edge(START, 'snapshot')
        graph.add_edge('snapshot', 'retrieve')
        graph.add_edge('retrieve', 'answer')
        graph.add_edge('answer', END)
        self.graph = graph.compile()

    def _snapshot(self, state, config):
        started = time.monotonic()
        self._activity(config, 'Loading learner snapshot…')
        snapshot = load_snapshot(self.config)
        if snapshot['status'] == 'blocked':
            raise PermissionError('Finish or cancel active practice before using the tutor.')
        self.timings['snapshotSeconds'] = round(time.monotonic() - started, 3)
        return {'snapshot': snapshot}

    def _retrieve(self, state, config):
        started = time.monotonic()
        if state['snapshot']['status'] == 'unavailable':
            self.timings['retrievalSeconds'] = 0
            self.last_evidence = {'status': 'unavailable', 'observations': [], 'attempts': [],
                                  'limitations': ['Platform snapshot is unavailable; retrieval was skipped.']}
            return {'evidence': self.last_evidence}
        self._activity(config, 'Searching learning evidence and checking supporting attempts…')
        query = state['message'][:800]
        # A short follow-up can otherwise lose its subject. Both are search terms only.
        if self.previous_question and len(query.split()) < 8:
            query = query[:350] + '\nPrevious question: ' + self.previous_question[:400]
        evidence = asyncio.run(retrieve_evidence(self.config, query, state.get('context_id')))
        self.timings['retrievalSeconds'] = round(time.monotonic() - started, 3)
        self.last_evidence = evidence
        return {'evidence': evidence}

    def _answer(self, state, config):
        started = time.monotonic()
        callbacks = config['configurable']
        snapshot = {**state['snapshot'], 'answerEvidence': state['evidence']}
        response = self.respond(state['message'], snapshot=snapshot,
                                on_activity=callbacks.get('on_activity'), on_text=callbacks.get('on_text'))
        self.timings['answerSeconds'] = round(time.monotonic() - started, 3)
        if not self.previous_question or len(state['message'].split()) >= 8:
            self.previous_question = state['message']
        return {'response': response}

    @staticmethod
    def _activity(config, text):
        callback = config['configurable'].get('on_activity')
        if callback: callback(text)

    def reply(self, message, *, context_id=None, on_activity=None, on_text=None):
        self.timings = {}
        self.last_evidence = None
        return self.graph.invoke({'message': message, 'context_id': context_id},
            {'configurable': {'on_activity': on_activity, 'on_text': on_text}})['response']
