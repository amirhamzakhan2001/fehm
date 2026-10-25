"""Nightly revenue report."""
from scripts.utils import load_rows, format_money
import os


class ReportBuilder:
    """Accumulate payment rows and render a revenue report."""

    def __init__(self, rows):
        self.rows = rows

    def total(self):
        return sum(row["amount"] for row in self.rows)

    def render(self):
        # render("ignored") inside a comment must not become a call
        return "total: " + format_money(self.total())


def build_report(path):
    """Build the revenue report for a data file."""
    builder = ReportBuilder(load_rows(path))
    return builder.render()


if __name__ == "__main__":
    print(build_report(os.environ.get("REPORT_FILE", "rows.json")))
