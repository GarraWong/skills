#!/usr/bin/env python3
"""Fill a Template 4 feature risk assessment.

Python 3.9+ standard library only.
"""

import argparse
import re
import sys
import zipfile
from fractions import Fraction
from pathlib import Path


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def parse_scores(text):
    parts = [part.strip() for part in text.split(",")]
    if len(parts) != 8:
        fail("scores must be 8 comma-separated integers (a through h)")
    scores = []
    labels = "abcdefgh"
    for index, part in enumerate(parts):
        if not re.fullmatch(r"\d+", part):
            fail(f"{labels[index]} is not an integer: {part}")
        value = int(part)
        if value < 1 or value > 10:
            fail(f"{labels[index]} must be from 1 to 10, got {value}")
        scores.append(value)
    return scores


def average(values):
    return Fraction(sum(values), len(values))


def rpn_of(scores):
    severity = average(scores[0:4])
    likelihood = average(scores[4:6])
    detectability = average(scores[6:8])
    return severity, likelihood, detectability, severity * likelihood * detectability


def category_of(rpn):
    if rpn <= 100:
        return "Low Risk"
    if rpn <= 200:
        return "Medium Risk"
    return "High Risk"


def format_fraction(value):
    text = format(float(value), ".10f").rstrip("0").rstrip(".")
    if text == "-0":
        return "0"
    return text


def print_report(scores):
    severity, likelihood, detectability, rpn = rpn_of(scores)
    print(f"S={format_fraction(severity)}")
    print(f"L={format_fraction(likelihood)}")
    print(f"D={format_fraction(detectability)}")
    print(f"RPN={format_fraction(rpn)}")
    print(f"category={category_of(rpn)}")


def set_empty_cell(sheet, ref, value):
    match = re.search(rf'<c r="{ref}"([^>/]*)/>', sheet)
    if not match:
        fail(f"template cell {ref} is missing or already filled; copy Template 4")
    attrs = match.group(1)
    replacement = f'<c r="{ref}"{attrs}><v>{value}</v></c>'
    return sheet[: match.start()] + replacement + sheet[match.end() :]


def set_cached_formula(sheet, ref, value, as_string):
    match = re.search(rf'<c r="{ref}"[^>]*>.*?</c>', sheet)
    if not match:
        fail(f"template formula cell {ref} is missing")
    tag = match.group(0)
    formula = re.search(r"<f[^>]*>.*?</f>", tag)
    style = re.search(r' s="(\d+)"', tag)
    if not formula or not style:
        fail(f"template formula cell {ref} has no formula or style")
    type_attr = ' t="str"' if as_string else ""
    escaped = (
        value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if as_string
        else value
    )
    replacement = (
        f'<c r="{ref}" s="{style.group(1)}"{type_attr}>'
        f"{formula.group(0)}<v>{escaped}</v></c>"
    )
    return sheet[: match.start()] + replacement + sheet[match.end() :]


def write_workbook(template, output, scores, force):
    template_path = Path(template)
    output_path = Path(output)
    if not template_path.is_file():
        fail(f"template not found: {template_path}")
    if output_path.exists() and not force:
        fail(f"output already exists: {output_path} (pass --force to replace it)")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    severity, likelihood, detectability, rpn = rpn_of(scores)
    category = category_of(rpn)

    with zipfile.ZipFile(template_path) as source:
        parts = {info.filename: source.read(info.filename) for info in source.infolist()}
        order = [info.filename for info in source.infolist()]

    sheet = parts["xl/worksheets/sheet1.xml"].decode("utf-8")
    for offset, value in enumerate(scores):
        sheet = set_empty_cell(sheet, f"D{offset + 2}", value)
    cached = {
        "D10": (format_fraction(severity), False),
        "D11": (format_fraction(likelihood), False),
        "D12": (format_fraction(detectability), False),
        "D13": (format_fraction(rpn), False),
        "D14": (category, True),
    }
    for ref, (value, as_string) in cached.items():
        sheet = set_cached_formula(sheet, ref, value, as_string)
    parts["xl/worksheets/sheet1.xml"] = sheet.encode("utf-8")

    workbook = parts["xl/workbook.xml"].decode("utf-8")
    if "fullCalcOnLoad" not in workbook:
        workbook, count = re.subn(
            r"<calcPr\b([^>]*)/>",
            lambda match: f'<calcPr{match.group(1)} fullCalcOnLoad="1"/>',
            workbook,
            count=1,
        )
        if count != 1:
            fail("template workbook has no calcPr element")
    parts["xl/workbook.xml"] = workbook.encode("utf-8")

    dropped = "xl/calcChain.xml"
    if dropped in parts:
        del parts[dropped]
        order = [name for name in order if name != dropped]
        rels_name = "xl/_rels/workbook.xml.rels"
        rels = parts[rels_name].decode("utf-8")
        rels = re.sub(r'<Relationship [^>]*calcChain[^>]*/>', "", rels)
        parts[rels_name] = rels.encode("utf-8")
        content_types = parts["[Content_Types].xml"].decode("utf-8")
        content_types = content_types.replace(
            '<Override PartName="/xl/calcChain.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>',
            "",
        )
        parts["[Content_Types].xml"] = content_types.encode("utf-8")

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for name in order:
            target.writestr(name, parts[name])

    print(f"wrote={output_path}")
    print_report(scores)


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    report = commands.add_parser("report")
    report.add_argument("--scores", required=True)

    write = commands.add_parser("write")
    write.add_argument("--template", required=True)
    write.add_argument("--output", required=True)
    write.add_argument("--scores", required=True)
    write.add_argument("--force", action="store_true")
    return parser


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "report":
        print_report(parse_scores(args.scores))
        return
    if args.command == "write":
        write_workbook(args.template, args.output, parse_scores(args.scores), args.force)
        return
    fail(f"unknown command {args.command}")


if __name__ == "__main__":
    main(sys.argv[1:])
