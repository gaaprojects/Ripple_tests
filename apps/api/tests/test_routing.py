from types import SimpleNamespace

from app.schemas import PaymentIntent
from app.tools import routing


def _settings(**overrides):
    data = {
        "route_slippage_bps": 50,
        "route_partial_payment": False,
        "use_mock_xrpl": True,
        "token_issuer_address": "",
        "frankfurter_base_url": "https://api.frankfurter.dev/v1",
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def _intent() -> PaymentIntent:
    return PaymentIntent(**{
        "from": "rSender",
        "to": "rReceiver",
        "senderName": "Alice AG",
        "senderCountry": "CH",
        "receiverName": "Bob LLC",
        "receiverCountry": "US",
        "receiverEntityType": "company",
        "purpose": "supplier_payment",
        "amount": 1000.0,
        "currency": "USD",
        "reference": "INV-001",
    })


async def test_quote_caps_send_max_with_slippage(monkeypatch):
    # Same-currency quote: rate is 1.0 with no network call.
    monkeypatch.setattr(routing, "get_settings", lambda: _settings())

    quote = await routing.quote_amount(1000.0, "USD", "USD")

    assert quote.dest_amount == 1000.0
    assert quote.send_max == 1005.0  # 1000 * (1 + 50bps)
    assert quote.deliver_min is None  # partial payments disabled


async def test_partial_payment_sets_deliver_min(monkeypatch):
    monkeypatch.setattr(routing, "get_settings", lambda: _settings(route_partial_payment=True))

    quote = await routing.quote_amount(1000.0, "USD", "USD")

    assert quote.deliver_min == 1000.0


async def test_mock_mode_uses_direct_path(monkeypatch):
    monkeypatch.setattr(routing, "get_settings", lambda: _settings())

    quote = await routing.get_fx_path(_intent(), "USD")

    assert quote.paths is None
    assert "direct" in quote.path_summary


async def test_cheapest_alternative_picks_lowest_source_amount():
    alternatives = [
        {"paths_computed": [[{"currency": "EUR"}]], "source_amount": {"value": "1100"}},
        {"paths_computed": [[{"currency": "GBP"}, {"currency": "X"}]], "source_amount": {"value": "1050"}},
    ]
    cheapest = routing._cheapest_alternative(alternatives)
    assert cheapest["source_amount"]["value"] == "1050"


async def test_cheapest_alternative_none_when_no_paths():
    assert routing._cheapest_alternative([{"source_amount": {"value": "1"}}]) is None
