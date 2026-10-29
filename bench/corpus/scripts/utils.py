import json


def load_rows(path):
    """Read report rows from a JSON file."""
    with open(path) as handle:
        return json.load(handle)


def format_money(cents):
    return f"{cents / 100:.2f}"
