"""Optional visual/browser regression test. Requires playwright and chromium.

    python tests/browser_optional.py

Not needed to use the Skill.
"""
import os
from pathlib import Path
import sys
import tempfile

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('SKIP: playwright is not installed')
    raise SystemExit(0)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from render import normalize_document, embed, TEMPLATE
import json

data = json.loads((ROOT / 'examples/mixed-report.json').read_text(encoding='utf-8'))
doc, tables, _ = normalize_document(data, ROOT / 'examples')
markup = embed(TEMPLATE.read_text(encoding='utf-8'), doc, tables)

with sync_playwright() as pw:
    executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
    options = {'headless': True}
    if Path(executable).exists():
        options['executable_path'] = executable
    browser = pw.chromium.launch(**options)
    for viewport in [850, 1300, 1680]:
        page = browser.new_page(viewport={'width':viewport,'height':820})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(markup, wait_until='load')
        assert not errors, (viewport, errors)
        assert page.locator('table.tree').count() == 2
        assert page.locator('svg').count() >= 1
        assert page.locator('#demo-count').inner_text() == '0回'
        page.locator('#demo-click').click()
        assert page.locator('#demo-count').inner_text() == '1回'
        # Separate table can have different number of columns.
        first_table = page.locator('table.tree').nth(0)
        second_table = page.locator('table.tree').nth(1)
        assert first_table.locator('thead th').count() == 4
        assert second_table.locator('thead th').count() == 3
        before_start = first_table.locator('thead th').nth(1).bounding_box()['x']
        other_before = second_table.locator('thead th').nth(1).bounding_box()['width']
        # The third column is changed. Column 2 start position must stay fixed.
        changing = first_table.locator('thead th').nth(2)
        start_width = changing.bounding_box()['width']
        grip = changing.locator('.resize-handle')
        bb = grip.bounding_box()
        start = bb['x'] + bb['width'] / 2
        mid = bb['y'] + bb['height'] / 2
        page.mouse.move(start, mid)
        page.mouse.down()
        page.mouse.move(start - 90, mid, steps=7)
        page.mouse.up()
        after_start = first_table.locator('thead th').nth(1).bounding_box()['x']
        assert abs(after_start - before_start) < 1.5, (viewport, before_start, after_start)
        assert changing.bounding_box()['width'] < start_width, viewport
        assert abs(second_table.locator('thead th').nth(1).bounding_box()['width'] - other_before) < 1.5
        panel = first_table.locator('xpath=..')
        pbb = panel.bounding_box()
        tbb = first_table.bounding_box()
        assert tbb['width'] >= pbb['width'] - 3  # no needless right gap
        grip.dblclick()
        assert first_table.evaluate('(e)=>e.style.tableLayout') == 'auto'
        page.close()
    # Groups can render cells in any depth, while other groups keep colspan.
    example = json.loads((ROOT / 'examples/group-columns.json').read_text(encoding='utf-8'))
    doc, tabs, _ = normalize_document(example, ROOT / 'examples')
    group_page = browser.new_page(viewport={'width': 1300, 'height': 900})
    errors = []
    group_page.on('pageerror', lambda e: errors.append(str(e)))
    group_page.set_content(embed(TEMPLATE.read_text(encoding='utf-8'), doc, tabs))
    rows = group_page.locator('table.tree tbody tr')
    assert rows.count() == 8, rows.count()
    assert rows.nth(0).locator('td').count() == 5  # group with data in columns
    assert rows.nth(0).locator('td').nth(0).inner_text().startswith('1.')
    assert rows.nth(0).locator('td').nth(1).inner_text().startswith('説明をグループ')
    assert rows.nth(0).locator('td').nth(2).locator('strong').count() == 1
    assert rows.nth(0).locator('td').nth(3).locator('.b').count() == 1
    assert rows.nth(0).locator('td').nth(4).locator('.chip').count() == 1
    assert rows.nth(1).locator('td').count() == 1  # traditional merged group
    assert rows.nth(1).locator('td').first.get_attribute('colspan') == '5'
    assert rows.nth(3).locator('td').count() == 5  # group with explicit columns and no cells
    assert rows.nth(4).locator('td').count() == 5  # deeper group with cells
    assert rows.nth(6).locator('td').count() == 1  # explicit merged group
    assert not errors, errors
    start = group_page.locator('table.tree thead th').nth(1).bounding_box()['x']
    target = group_page.locator('table.tree thead th').nth(2)
    grip = target.locator('.resize-handle')
    bb = grip.bounding_box()
    group_page.mouse.move(bb['x'] + 5, bb['y'] + bb['height'] / 2)
    group_page.mouse.down()
    group_page.mouse.move(bb['x'] - 70, bb['y'] + bb['height'] / 2, steps=5)
    group_page.mouse.up()
    assert abs(group_page.locator('table.tree thead th').nth(1).bounding_box()['x'] - start) < 1.5
    group_page.close()

    # HTML-only output should render without table JS errors.
    html_only = json.loads((ROOT/'examples/html-only.json').read_text(encoding='utf-8'))
    d, t, _ = normalize_document(html_only, ROOT/'examples')
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(embed(TEMPLATE.read_text(encoding='utf-8'), d, t))
    assert page.locator('table.tree').count() == 0
    assert page.get_by_text('表を使わないページ').count() == 1
    assert not errors
    browser.close()
print('PASS: multi-table, layout and HTML-only browser checks at 850/1300/1680px')
