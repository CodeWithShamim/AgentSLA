"""Direct-test harness (PRD §7 gate 4).

Installs a faithful mock of the `genlayer` runtime into sys.modules, then
imports the real contract from contracts/agentsla.py. The mock preserves the
semantics the contract relies on:

- `gl.vm.run_nondet` executes the leader AND asserts the validator agrees —
  so every adjudication in the suite also exercises the FR-2.3 equivalence
  rule. Disagreement raises NonConvergence (the tx-level UNDETERMINED state).
- `gl.nondet.exec_prompt` / `gl.nondet.web.render` are per-test injectable.
- `gl.message.sender_address` / `gl.message_raw['datetime']` are settable,
  so access control and time-gated paths (deadline, appeal window) are
  drivable.
"""
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

CONTRACT_PATH = Path(__file__).resolve().parents[2] / 'contracts' / 'agentsla.py'


# ---------------------------------------------------------------------------
# genlayer runtime mock
# ---------------------------------------------------------------------------

class Address:
    SIZE = 20

    def __init__(self, val):
        if isinstance(val, Address):
            self._b = val._b
        elif isinstance(val, str):
            self._b = bytes.fromhex(val.removeprefix('0x').lower())
        else:
            self._b = bytes(val)
        if len(self._b) != 20:
            raise ValueError('address must be 20 bytes')

    @property
    def as_hex(self):
        return '0x' + self._b.hex()

    def __eq__(self, other):
        return isinstance(other, Address) and self._b == other._b

    def __hash__(self):
        return hash(self._b)

    def __repr__(self):
        return f'Address({self.as_hex})'


class u256(int):
    def __class_getitem__(cls, item):
        return cls


class TreeMap(dict):
    def __class_getitem__(cls, item):
        return cls


class DynArray(list):
    def __class_getitem__(cls, item):
        return cls


def allow_storage(cls):
    return cls


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class NonConvergence(Exception):
    """Validators disagreed — tx-level UNDETERMINED."""


class _VM(types.SimpleNamespace):
    Return = Return

    @staticmethod
    def run_nondet(leader_fn, validator_fn):
        result = leader_fn()
        if not validator_fn(Return(result)):
            raise NonConvergence('validator disagreed with leader')
        return result


class _Web(types.SimpleNamespace):
    def __init__(self):
        super().__init__()
        self.render_impl = lambda url, mode='text': (_ for _ in ()).throw(
            RuntimeError('web.render not stubbed'))

    def render(self, url, mode='text'):
        return self.render_impl(url, mode=mode)


class _Nondet(types.SimpleNamespace):
    def __init__(self):
        super().__init__()
        self.web = _Web()
        self.exec_prompt_impl = lambda prompt: (_ for _ in ()).throw(
            RuntimeError('exec_prompt not stubbed'))
        self.prompts = []  # every prompt sent to the "LLM", for injection asserts

    def exec_prompt(self, prompt):
        self.prompts.append(prompt)
        return self.exec_prompt_impl(prompt)


class _Public:
    @staticmethod
    def view(f):
        return f

    class _Write:
        def __call__(self, f):
            return f

        @property
        def payable(self):
            return lambda f: f

    write = _Write()


def _build_genlayer_module():
    gl = types.SimpleNamespace()
    gl.Contract = type('Contract', (), {})
    gl.public = _Public
    gl.vm = _VM()
    gl.nondet = _Nondet()
    gl.message = types.SimpleNamespace(sender_address=Address('0x' + '00' * 20))
    gl.message_raw = {'datetime': '2026-07-04T12:00:00Z'}

    mod = types.ModuleType('genlayer')
    mod.gl = gl
    mod.Address = Address
    mod.u256 = u256
    mod.bigint = int
    mod.TreeMap = TreeMap
    mod.DynArray = DynArray
    mod.allow_storage = allow_storage
    mod.__all__ = ['gl', 'Address', 'u256', 'bigint', 'TreeMap', 'DynArray', 'allow_storage']
    return mod


_genlayer = _build_genlayer_module()
sys.modules['genlayer'] = _genlayer

spec = importlib.util.spec_from_file_location('agentsla_contract', CONTRACT_PATH)
contract_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract_module)


# ---------------------------------------------------------------------------
# harness
# ---------------------------------------------------------------------------

GEN = 10 ** 18
BUYER = Address('0x' + 'a1' * 20)
WORKER = Address('0x' + 'b2' * 20)
OTHER = Address('0x' + 'c3' * 20)
TREASURY_HEX = '0x7ea5000000000000000000000000000000000000'

T0 = 1_800_000_000_000  # fixed epoch ms base for tests


def _iso(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc) \
        .strftime('%Y-%m-%dT%H:%M:%S.%f') + 'Z'


class Env:
    def __init__(self):
        cls = contract_module.AgentSLA
        c = cls.__new__(cls)
        c.tasks = TreeMap()
        c.balances = TreeMap()
        c.rep_events_json = DynArray()
        self.gl = _genlayer.gl
        self.set_time(T0)
        self.set_sender(BUYER)
        c.__init__(appeal_window_ms=120_000, min_escrow=1 * GEN)
        self.contract = c

    # --- context controls ---
    def set_sender(self, addr):
        self.gl.message.sender_address = addr

    def set_time(self, ms):
        self.gl.message_raw['datetime'] = _iso(ms)

    def set_llm(self, fn):
        """fn(prompt) -> str. Reset per test."""
        self.gl.nondet.exec_prompt_impl = fn
        self.gl.nondet.prompts.clear()

    def llm_verdict(self, bools, *, injection=False, confidence='HIGH',
                    fenced=False, stringy=False, claim_verdict=None, extra_prose=False):
        """Canned adjudicator output for a criteria boolean vector."""
        results = [
            {'index': i,
             'met': ('yes' if m else 'no') if stringy else m,
             'reason': f'criterion {i} testimony'}
            for i, m in enumerate(bools)
        ]
        payload = {'criteria_results': results,
                   'injection_detected': injection,
                   'confidence': confidence}
        if claim_verdict is not None:
            payload['verdict'] = claim_verdict  # the contract must ignore this
        text = json.dumps(payload)
        if fenced:
            text = '```json\n' + text + '\n```'
        if extra_prose:
            text = 'Here is my judgment as requested:\n' + text + '\nHope this helps!'
        self.set_llm(lambda prompt: text)

    def set_web(self, fn):
        self.gl.nondet.web.render_impl = fn

    # --- protocol shortcuts ---
    def create(self, criteria=('crit a', 'crit b', 'crit c'),
               escrow=10 * GEN, deadline_ms=None, title='Task', sla='Do the thing.'):
        self.set_sender(BUYER)
        return self.contract.create_task(
            title, sla, json.dumps(list(criteria)),
            deadline_ms if deadline_ms is not None else T0 + 86_400_000,
            escrow,
        )

    def accept(self, tid, sender=WORKER):
        self.set_sender(sender)
        self.contract.accept_task(tid)

    def deliver(self, tid, inline='the deliverable', url='', sender=WORKER):
        self.set_sender(sender)
        return self.contract.submit_delivery(tid, url, inline)

    def task(self, tid):
        return json.loads(self.contract.get_task(tid))

    def balance(self, addr):
        return int(self.contract.get_balance(addr.as_hex))

    def rep(self):
        return json.loads(self.contract.get_reputation())


@pytest.fixture
def env():
    return Env()


@pytest.fixture
def NonConvergenceError():
    return NonConvergence
