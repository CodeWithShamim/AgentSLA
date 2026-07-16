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
- Native asset semantics are faithful: `gl.message.value` on payable calls
  credits the contract's native balance (`self.balance`), a failed call
  refunds it (revert semantics), and
  `gl.get_contract_at(addr).emit_transfer(value=...)` debits it and records
  the outgoing native transfer — so asset invariants (custody backing,
  conservation, no double-payout) are testable end to end.
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


# Native-token ledger shared by the mock: the contract's balance plus every
# outgoing emit_transfer. Reset per Env.
_NATIVE = {'contract': 0}
_TRANSFERS = []  # (to_hex, amount)


class _ContractAt:
    def __init__(self, addr):
        self.addr = addr

    def emit_transfer(self, value):
        amount = int(value)
        if amount > _NATIVE['contract']:
            raise RuntimeError('native transfer exceeds contract balance')
        _NATIVE['contract'] -= amount
        _TRANSFERS.append((self.addr.as_hex, amount))


class _ContractBase:
    @property
    def balance(self):
        return u256(_NATIVE['contract'])


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
    gl.Contract = _ContractBase
    gl.public = _Public
    gl.vm = _VM()
    gl.nondet = _Nondet()
    gl.message = types.SimpleNamespace(
        sender_address=Address('0x' + '00' * 20), value=u256(0))
    gl.message_raw = {'datetime': '2026-07-04T12:00:00Z'}
    gl.get_contract_at = _ContractAt

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
DEPLOYER = Address('0x' + 'd4' * 20)
# Slash revenue accrues to the deployer (the contract's treasury).
TREASURY_HEX = DEPLOYER.as_hex

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
        _NATIVE['contract'] = 0
        _TRANSFERS.clear()
        self.set_time(T0)
        self.set_sender(DEPLOYER)   # deploy sender becomes the treasury
        c.__init__(appeal_window_ms=120_000, min_escrow=1 * GEN)
        self.set_sender(BUYER)
        self.contract = c

    # --- context controls ---
    def set_sender(self, addr):
        self.gl.message.sender_address = addr

    def set_time(self, ms):
        self.gl.message_raw['datetime'] = _iso(ms)

    # --- native asset controls ---

    def pay(self, sender, value, fn, *args):
        """Invoke a payable method carrying `value` native wei. Mirrors
        chain semantics: custody lands with the call, a raised exception
        reverts the transfer."""
        self.set_sender(sender)
        self.gl.message.value = u256(int(value))
        _NATIVE['contract'] += int(value)
        try:
            return fn(*args)
        except BaseException:
            _NATIVE['contract'] -= int(value)
            raise
        finally:
            self.gl.message.value = u256(0)

    @property
    def custody(self):
        """The contract's real native balance."""
        return _NATIVE['contract']

    @property
    def transfers(self):
        """Every outgoing native transfer as (to_hex, amount)."""
        return list(_TRANSFERS)

    def native_received(self, addr):
        return sum(a for to, a in _TRANSFERS if to == addr.as_hex)

    def vault(self):
        return json.loads(self.contract.get_vault())

    def assert_backed(self):
        """The custody invariant: real balance exactly backs the ledger."""
        v = self.vault()
        assert v['backed'] is True
        assert int(v['custody']) == int(v['locked']) + int(v['withdrawable']), v
        assert int(v['custody']) == self.custody

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

    # --- protocol shortcuts (escrow/bond/appeal bond ride as real value) ---
    def create(self, criteria=('crit a', 'crit b', 'crit c'),
               escrow=10 * GEN, deadline_ms=None, title='Task', sla='Do the thing.'):
        return self.pay(
            BUYER, escrow, self.contract.create_task,
            title, sla, json.dumps(list(criteria)),
            deadline_ms if deadline_ms is not None else T0 + 86_400_000,
        )

    def accept(self, tid, sender=WORKER, bond=None):
        if bond is None:
            # Quote the exact reputation-gated stake, as real agents would.
            bond = int(self.contract.get_required_bond(tid, sender.as_hex))
        self.pay(sender, bond, self.contract.accept_task, tid)

    def bid(self, tid, price, sender=WORKER):
        self.set_sender(sender)
        self.contract.place_bid(tid, price)

    def select(self, tid, worker=WORKER):
        self.set_sender(BUYER)
        self.contract.select_bid(tid, worker.as_hex)

    def create_group(self, milestones, title='Program', sla='Do the staged thing.',
                     deadline_ms=None):
        """milestones: list of (title, criteria, amount)."""
        total = sum(a for _, _, a in milestones)
        payload = json.dumps([
            {'title': t, 'criteria': list(c), 'amount': a} for t, c, a in milestones
        ])
        return self.pay(
            BUYER, total, self.contract.create_task_group,
            title, sla, payload,
            deadline_ms if deadline_ms is not None else T0 + 86_400_000,
        )

    def appeal(self, tid, sender=WORKER, bond=None):
        if bond is None:
            bond = int(self.task(tid)['escrow']) * 10 // 100
        return self.pay(sender, bond, self.contract.file_appeal, tid)

    def withdraw(self, sender):
        self.set_sender(sender)
        return int(self.contract.withdraw())

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
