#!/usr/bin/env python3
"""Name synthetic XCTest PNG attachments from an xcresulttool export manifest."""
import json
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("Usage: export-screenshots.py EXPORTED_ATTACHMENTS NAMED_OUTPUT")
source, destination = map(Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=True)
for test in json.loads((source / "manifest.json").read_text()):
    for attachment in test["attachments"]:
        exported = attachment["exportedFileName"]
        if not exported.endswith(".png"):
            continue
        # Xcode appends its iteration/UUID suffix to the name provided by XCTest.
        name = attachment["suggestedHumanReadableName"].split("_0_")[0]
        shutil.copyfile(source / exported, destination / (Path(name).name + ".png"))
