(function () {
  var dataElement = document.getElementById('rc-data');
  if (!dataElement) return;
  var data = JSON.parse(dataElement.textContent);
  var storageKey = 'rc-checked:' + data.reportId;
  var checked = {};
  try {
    var raw = window.localStorage.getItem(storageKey);
    if (raw) checked = JSON.parse(raw) || {};
  } catch (error) { checked = {}; }
  function save() {
    try { window.localStorage.setItem(storageKey, JSON.stringify(checked)); } catch (error) {}
  }

  var boxes = Array.prototype.slice.call(document.querySelectorAll('.rc-checkbox'));
  var queueItems = Array.prototype.slice.call(document.querySelectorAll('.rc-queue-item'));
  var progress = document.getElementById('rc-progress');
  var progressText = document.getElementById('rc-progress-text');
  var byKey = {};
  data.units.forEach(function (unit) { byKey[unit.k] = unit; });

  function render() {
    var done = 0;
    var open = { critical: 0, high: 0, mid: 0, low: 0 };
    data.units.forEach(function (unit) {
      if (checked[unit.k]) done += 1; else open[unit.b] += 1;
    });
    boxes.forEach(function (box) {
      var on = !!checked[box.getAttribute('data-rc-key')];
      box.checked = on;
      var bar = box.closest('.rc-bar');
      if (bar) bar.classList.toggle('is-checked', on);
    });
    queueItems.forEach(function (item) {
      item.classList.toggle('is-checked', !!checked[item.getAttribute('data-rc-key')]);
    });
    progress.max = data.units.length;
    progress.value = done;
    progressText.textContent = done + ' / ' + data.units.length + ' 確認済み';
    Object.keys(open).forEach(function (band) {
      var element = document.querySelector('[data-rc-open="' + band + '"]');
      if (element) element.textContent = String(open[band]);
    });
  }

  function reveal(unit) {
    var tab = document.getElementById('commit-tab-' + unit.c);
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    var panel = document.getElementById('commit-panel-' + unit.c);
    if (panel) {
      for (var attempt = 0; attempt < 200; attempt += 1) {
        var closed = Array.prototype.slice.call(panel.querySelectorAll('.nest-toggle[aria-expanded="false"]'));
        var hit = null;
        for (var index = 0; index < closed.length; index += 1) {
          var start = Number(closed[index].getAttribute('data-flow-start'));
          var end = Number(closed[index].getAttribute('data-flow-end'));
          if (start <= unit.f && unit.f <= end) { hit = closed[index]; break; }
        }
        if (!hit) break;
        hit.click();
      }
    }
    var header = document.getElementById('flow-' + unit.c + '-' + unit.f);
    var target = header ? header.closest('.review-unit') : null;
    if (!target) return;
    target.scrollIntoView({ block: 'start', inline: 'nearest' });
    var box = target.querySelector('.rc-checkbox');
    if (box) box.focus({ preventScroll: true });
    target.classList.add('rc-flash');
    window.setTimeout(function () { target.classList.remove('rc-flash'); }, 1600);
  }

  boxes.forEach(function (box) {
    box.addEventListener('change', function () {
      var key = box.getAttribute('data-rc-key');
      if (box.checked) checked[key] = true; else delete checked[key];
      save();
      render();
    });
  });
  queueItems.forEach(function (item) {
    item.querySelector('.rc-jump').addEventListener('click', function () {
      var unit = byKey[item.getAttribute('data-rc-key')];
      if (unit) reveal(unit);
    });
  });

  var nextButton = document.getElementById('rc-next');
  nextButton.addEventListener('click', function () {
    var next = data.units.filter(function (unit) { return !checked[unit.k]; })[0];
    if (next) reveal(next);
  });

  var resetButton = document.getElementById('rc-reset');
  var resetTimer = null;
  resetButton.addEventListener('click', function () {
    if (resetTimer === null) {
      resetButton.textContent = '本当に解除する(もう一度押す)';
      resetTimer = window.setTimeout(function () {
        resetButton.textContent = 'チェックをすべて解除';
        resetTimer = null;
      }, 4000);
      return;
    }
    window.clearTimeout(resetTimer);
    resetTimer = null;
    resetButton.textContent = 'チェックをすべて解除';
    checked = {};
    save();
    render();
  });

  render();
})();
