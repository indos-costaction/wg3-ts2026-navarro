"""Rebuild trainer/index.html from trainer/src/page.html, core.js and ui.js.

Usage (from the repository root):  python trainer/src/build.py
"""
from pathlib import Path

src = Path(__file__).parent
page = (src / "page.html").read_text(encoding="utf-8")
core = (src / "core.js").read_text(encoding="utf-8").replace(
    "if (typeof module !== 'undefined') module.exports",
    "if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports",
)
ui = (src / "ui.js").read_text(encoding="utf-8")
body = page.replace("/*CORE*/", core).replace("/*UI*/", ui)
end = body.index("</style>") + len("</style>")
html = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + body[:end] + "\n</head>\n<body>\n" + body[end:] + "\n</body>\n</html>\n"
)
(src.parent / "index.html").write_text(html, encoding="utf-8")
print("trainer/index.html rebuilt")
