"""Durable coaching steps. The waiting node has no model calls or side effects."""
import json
import os
import sqlite3
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

# Local-only by default, including when a developer has tracing enabled globally.
os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.sqlite import SqliteSaver
from tutor.coaching.model import Teaching, TEACHING


class State(TypedDict, total=False):
    version: int
    attempt_id: str
    request: dict
    evidence: dict
    messages: list[dict]
    decisions: list[dict]
    receipts: dict
    status: str
    expanded: bool
    expand: bool


class CoachingGraph:
    def __init__(self, root: Path, model, evidence):
        self.pointer = root / 'active-coaching.json'
        self.db = sqlite3.connect(root / 'coaching.sqlite', check_same_thread=False)
        self.model, self.evidence = model, evidence
        graph = StateGraph(State)
        graph.add_node('evidence', self._evidence)
        graph.add_node('teach', self._teach)
        graph.add_node('wait', self._wait)
        graph.add_node('broaden', self._broaden)
        graph.add_edge(START, 'evidence')
        graph.add_edge('evidence', 'teach')
        graph.add_conditional_edges('teach', self._after_teaching)
        graph.add_edge('broaden', 'teach')
        graph.add_edge('wait', 'evidence')
        self.graph = graph.compile(checkpointer=SqliteSaver(self.db))
        self.active = json.loads(self.pointer.read_text()) if self.pointer.exists() else None
        if self.active and self.active.get('version') != 1:
            raise RuntimeError('Unsupported coaching state. Start a new conversation to recover.')

    @staticmethod
    def _after_teaching(state):
        if state.get('expand'):
            return 'broaden'
        return END if state['status'] == 'completed' else 'wait'

    def close(self):
        self.db.close()

    def _config(self):
        return {'configurable': {'thread_id': self.active['id']}, 'recursion_limit': 12}

    def _save_pointer(self):
        temp = self.pointer.with_suffix('.tmp')
        temp.write_text(json.dumps(self.active))
        temp.replace(self.pointer)

    def _evidence(self, state):
        focused = bool(state.get('decisions')) and hasattr(self.evidence, 'followup')
        fresh = (self.evidence.followup if focused else self.evidence)(state['attempt_id'])
        old = state.get('evidence', {})
        fresh['changed'] = bool(old and old.get('fingerprint') != fresh.get('fingerprint'))
        return {'evidence': fresh, 'expand': False, 'expanded': not focused}

    def _broaden(self, state):
        fresh = self.evidence(state['attempt_id'])
        fresh['changed'] = state['evidence'].get('changed', False) or fresh.get('fingerprint') != state['evidence'].get('fingerprint')
        return {'evidence': fresh, 'expand': False, 'expanded': True}

    def _teach(self, state):
        decision = self.model(Teaching, TEACHING, {
            'evidence': state['evidence'], 'message': state['request']['message'],
            'context_attempt_id': state['request'].get('context_attempt_id'),
            'messages': state.get('messages', [])[-4:],
            'focus': state.get('decisions', [{}])[-1].get('focus') if state.get('decisions') else None,
            'hints_given': [d['response'][:800] for d in state.get('decisions', []) if d['action'] == 'hint'],
            'exchange_count': len(state.get('decisions', [])),
            'broader_evidence_available': not state.get('expanded', True),
        }).model_dump()
        if decision['action'] == 'broaden':
            if state.get('expanded', True):
                raise RuntimeError('Cannot repeatedly expand coaching evidence')
            return {'expand': True}
        if decision['action'] in ('chat', 'leave', 'reroute'):
            if hasattr(self.evidence, 'check_access'):
                self.evidence.check_access()
            request = state['request']
            return {'receipts': {**state.get('receipts', {}), request['id']: {
                'message': request['message'], 'coaching_target': request.get('coaching_target'),
                'context_attempt_id': request.get('context_attempt_id'),
                'response': '', 'handoff': decision['action']}},
                'expand': False}
        if len(state.get('decisions', [])) >= 6 and decision['action'] != 'finish':
            decision['action'] = 'finish'
            decision['response'] += '\nWe can pause here; start another coaching session when you want to continue.'
        if hasattr(self.evidence, 'check_access'):
            self.evidence.check_access()
        if decision['evidence_ids']:
            decision['response'] += '\n\nEvidence: ' + ', '.join(decision['evidence_ids'])
        request = state['request']
        receipts = {**state.get('receipts', {}), request['id']: {
            'message': request['message'], 'coaching_target': request.get('coaching_target'),
            'context_attempt_id': request.get('context_attempt_id'),
            'response': decision['response']}}
        return {
            'messages': [*state.get('messages', []),
                         {'role': 'user', 'text': request['message']},
                         {'role': 'assistant', 'text': decision['response']}],
            'decisions': [*state.get('decisions', []), decision],
            'receipts': receipts,
            'status': 'completed' if decision['action'] == 'finish' else 'active',
        }

    def _wait(self, state):
        request = interrupt({'question': state['messages'][-1]['text'] if state.get('messages') else ''})
        return {'request': request}

    def state(self):
        if not self.active:
            return None
        snapshot = self.graph.get_state(self._config())
        value = snapshot.values
        if value and value.get('version') != 1:
            raise RuntimeError('Unsupported coaching checkpoint; start a new conversation.')
        return value

    def view(self):
        value = self.state()
        if value is None:
            return None
        snapshot = self.graph.get_state(self._config())
        pending = bool(snapshot.next and not any(t.interrupts for t in snapshot.tasks))
        return {'id': self.active['id'], 'attemptId': self.active['attempt_id'],
                'status': 'paused' if self.active.get('paused') else value.get('status', 'active'),
                'needsRetry': pending, 'messages': value.get('messages', [])}

    def pause(self):
        if self.active:
            self.active['paused'] = True
            self._save_pointer()

    def resume(self):
        if self.active:
            self.active['paused'] = False
            self._save_pointer()

    def clear(self):
        self.active = None
        self._save_pointer()

    def start(self, attempt_id, request):
        self.active = {'version': 1, 'id': str(uuid4()), 'attempt_id': attempt_id, 'paused': False}
        self._save_pointer()
        return self.graph.invoke({'version': 1, 'attempt_id': attempt_id, 'request': request,
                                  'messages': [], 'decisions': [], 'receipts': {}, 'status': 'active'}, self._config())

    def reply(self, request):
        value = self.state()
        receipt = value.get('receipts', {}).get(request['id'])
        if receipt:
            if (receipt['message'] != request['message'] or
                    receipt.get('coaching_target') != request.get('coaching_target') or
                    ('context_attempt_id' in receipt and
                     receipt['context_attempt_id'] != request.get('context_attempt_id'))):
                raise ValueError('Request ID reused with different input')
            return value
        if self.view()['needsRetry']:
            raise RuntimeError('The last coaching step was interrupted. Retry it or return to chat.')
        self.resume()
        return self.graph.invoke(Command(resume=request), self._config())

    def retry(self):
        self.resume()
        if not self.state():
            raise RuntimeError('Coaching did not initialise. Start a new coaching session.')
        return self.graph.invoke(None, self._config())
