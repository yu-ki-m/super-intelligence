#!/usr/bin/env python3
"""product-branding-team のハーネス起動口。使い方は README.md を参照。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
