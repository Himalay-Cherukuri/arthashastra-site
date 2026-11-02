/* ========================================
   Arthashastra Study Site – app.js
   ======================================== */
(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); };

  /* ---------- 1. Theme toggle ---------- */
  var themeBtn = $('.theme-toggle');
  var root = document.documentElement;

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('as-theme', theme); } catch (e) {}
    themeBtn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
    themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  (function initTheme() {
    var stored;
    try { stored = localStorage.getItem('as-theme'); } catch (e) {}
    if (stored === 'dark' || stored === 'light') { applyTheme(stored); }
    // else follow prefers-color-scheme (no explicit attr)
  })();

  themeBtn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme');
    if (!current) {
      current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ---------- 2. Sidebar collapse / mobile drawer ---------- */
  var sidebar = $('.sidebar');
  var menuBtn = $('.menu-btn');
  var overlay = $('.sidebar-overlay');

  // Collapse / expand books
  $$('.tree .book > button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var li = btn.parentElement;
      var open = li.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open);
      saveSidebarState();
    });
  });

  function saveSidebarState() {
    var ids = $$('.tree .book.is-open').map(function (li) {
      var btn = $('button', li);
      return btn ? btn.textContent.trim().split('\u00B7')[0].trim() : '';
    });
    try { localStorage.setItem('as-sidebar', JSON.stringify(ids)); } catch (e) {}
  }

  function restoreSidebarState() {
    var stored;
    try { stored = JSON.parse(localStorage.getItem('as-sidebar')); } catch (e) {}
    if (!Array.isArray(stored)) return;
    $$('.tree .book').forEach(function (li) {
      var btn = $('button', li);
      var label = btn ? btn.textContent.trim().split('\u00B7')[0].trim() : '';
      if (stored.indexOf(label) >= 0) {
        li.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }
  restoreSidebarState();

  // Ensure current book is open
  var currentChapter = $('.tree .chapter.is-current');
  if (currentChapter) {
    var parentBook = currentChapter.closest('.book');
    if (parentBook && !parentBook.classList.contains('is-open')) {
      parentBook.classList.add('is-open');
      var b = $('button', parentBook);
      if (b) b.setAttribute('aria-expanded', 'true');
      saveSidebarState();
    }
    // scroll into view
    setTimeout(function () { currentChapter.scrollIntoView({ block: 'nearest' }); }, 50);
  }

  // Mobile drawer
  function openDrawer() {
    sidebar.classList.add('is-open');
    menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeDrawer() {
    sidebar.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  menuBtn.addEventListener('click', function () {
    sidebar.classList.contains('is-open') ? closeDrawer() : openDrawer();
  });
  overlay.addEventListener('click', closeDrawer);

  /* ---------- 3. Scroll-spy for right TOC ---------- */
  var tocLinks = $$('.toc a');
  if (tocLinks.length) {
    var sectionIds = tocLinks.map(function (a) { return a.getAttribute('href').slice(1); });
    var ticking = false;

    function updateSpy() {
      var scrollY = window.scrollY + 100;
      var active = null;
      for (var i = sectionIds.length - 1; i >= 0; i--) {
        var el = document.getElementById(sectionIds[i]);
        if (el && el.offsetTop <= scrollY) { active = i; break; }
      }
      tocLinks.forEach(function (a, idx) {
        a.classList.toggle('is-active', idx === active);
      });
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(updateSpy); ticking = true; }
    }, { passive: true });
    updateSpy();
  }

  /* ---------- 4. Copy paragraph link ---------- */
  var toast = $('.toast');
  var toastTimer;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2000);
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('.para-id');
    if (!link) return;
    e.preventDefault();
    var url = link.href || (location.origin + location.pathname + '#' + link.closest('.para').id);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { showToast('Link copied'); });
    } else {
      showToast('Link: ' + url);
    }
    // also update hash
    history.replaceState(null, '', '#' + link.closest('.para').id);
  });

  /* ---------- 5. Search ---------- */
  var searchIndex = null;
  var headerInput = $('.header-search input');
  var dropdown = $('.search-dropdown');
  var pageType = document.body.getAttribute('data-page-type');
  var rootPath = (function () {
    // derive from stylesheet href
    var link = $('link[rel="stylesheet"]');
    if (!link) return '';
    var href = link.getAttribute('href');
    return href.replace('assets/styles.css', '');
  })();

  function fetchIndex(cb) {
    if (searchIndex) return cb(searchIndex);
    var url = rootPath + 'assets/search_index.json';
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      searchIndex = data;
      cb(data);
    }).catch(function () { cb([]); });
  }

  function normalize(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function highlightMatch(text, query) {
    var norm = normalize(text);
    var idx = norm.indexOf(query);
    if (idx < 0) return document.createTextNode(text);
    var frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(text.slice(0, idx)));
    var mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + query.length);
    frag.appendChild(mark);
    frag.appendChild(document.createTextNode(text.slice(idx + query.length)));
    return frag;
  }

  function doSearch(query, limit) {
    if (!searchIndex) return [];
    var q = normalize(query);
    if (!q) return [];
    var results = [];
    for (var i = 0; i < searchIndex.length && results.length < limit; i++) {
      var item = searchIndex[i];
      var haystack = normalize(item.id + ' ' + item.t + (item.b || '') + (item.c || ''));
      if (haystack.indexOf(q) >= 0) results.push(item);
    }
    return results;
  }

  // Header dropdown
  var debounceTimer;
  headerInput.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var q = headerInput.value.trim();
      if (q.length < 2) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
      fetchIndex(function () {
        var results = doSearch(q, 8);
        dropdown.innerHTML = '';
        if (!results.length) { dropdown.classList.remove('open'); return; }
        var normQ = normalize(q);
        results.forEach(function (item) {
          var a = document.createElement('a');
          a.href = item.u;
          a.appendChild(highlightMatch(item.t, normQ));
          if (item.b || item.c) {
            var span = document.createElement('span');
            span.className = 'sr-breadcrumb';
            span.textContent = [item.b, item.c].filter(Boolean).join(' > ');
            a.appendChild(span);
          }
          dropdown.appendChild(a);
        });
        dropdown.classList.add('open');
      });
    }, 200);
  });

  headerInput.addEventListener('focus', function () {
    if (headerInput.value.trim().length >= 2) {
      headerInput.dispatchEvent(new Event('input'));
    }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.header-search')) dropdown.classList.remove('open');
  });

  // Full search page
  if (pageType === 'search') {
    var pageInput = $('.search-page-input');
    var resultsList = $('.search-results');

    function renderPageResults(q) {
      if (!resultsList) return;
      resultsList.innerHTML = '';
      if (!q || q.length < 2) return;
      fetchIndex(function () {
        var results = doSearch(q, 50);
        var normQ = normalize(q);
        if (!results.length) {
          var li = document.createElement('li');
          li.textContent = 'No results found.';
          resultsList.appendChild(li);
          return;
        }
        results.forEach(function (item) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = item.u;

          if (item.id && item.k !== 'tag') {
            var idSpan = document.createElement('span');
            idSpan.className = 'sr-id';
            idSpan.textContent = item.id;
            a.appendChild(idSpan);
            a.appendChild(document.createTextNode(' '));
          }

          a.appendChild(highlightMatch(item.t, normQ));

          if (item.b || item.c) {
            var bc = document.createElement('span');
            bc.className = 'sr-breadcrumb';
            bc.textContent = [item.b, item.c].filter(Boolean).join(' > ');
            a.appendChild(bc);
          }

          li.appendChild(a);
          resultsList.appendChild(li);
        });
      });
    }

    if (pageInput) {
      var params = new URLSearchParams(location.search);
      var initQ = params.get('q') || '';
      if (initQ) {
        pageInput.value = initQ;
        renderPageResults(initQ);
      }
      pageInput.addEventListener('input', function () {
        renderPageResults(pageInput.value.trim());
      });
    }
  }

  /* ---------- 6. Keyboard shortcuts ---------- */
  document.addEventListener('keydown', function (e) {
    // Don't intercept when typing in inputs
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    if (e.key === '/') {
      e.preventDefault();
      headerInput.focus();
    }

    if (e.key === '[') {
      var prev = $('.pager.prev');
      if (prev) location.href = prev.href;
    }
    if (e.key === ']') {
      var next = $('.pager.next');
      if (next) location.href = next.href;
    }
  });

  /* ---------- 7. Show-tags toggle ---------- */
  var tagsToggle = $('#tagsToggle');
  if (tagsToggle) {
    var stored;
    try { stored = localStorage.getItem('as-tags'); } catch (e) {}
    if (stored === 'on') {
      tagsToggle.checked = true;
      document.body.classList.add('show-tags');
    }
    tagsToggle.addEventListener('change', function () {
      document.body.classList.toggle('show-tags', tagsToggle.checked);
      try { localStorage.setItem('as-tags', tagsToggle.checked ? 'on' : 'off'); } catch (e) {}
    });
  }

  /* ---------- 8. Highlight :target on load ---------- */
  if (location.hash) {
    var target = document.getElementById(location.hash.slice(1));
    if (target) {
      // Let CSS :target handle highlight; scroll after layout settles
      setTimeout(function () { target.scrollIntoView({ block: 'center' }); }, 100);
    }
  }

  /* ---------- Hide empty wrappers ---------- */
  var metaLine = $('.meta-line');
  if (metaLine && !metaLine.textContent.trim()) metaLine.style.display = 'none';

  var chapterTags = $('.chapter-tags');
  if (chapterTags && !chapterTags.innerHTML.trim()) chapterTags.style.display = 'none';

  var pagerRow = $('.pager-row');
  if (pagerRow && !pagerRow.innerHTML.trim()) pagerRow.style.display = 'none';

  var tocAside = $('.toc-aside');
  var tocList = tocAside ? $('.toc', tocAside) : null;
  if (tocAside && (!tocList || !tocList.children.length)) tocAside.style.display = 'none';

  // Lazy-load search index on first header focus
  headerInput.addEventListener('focus', function onFirstFocus() {
    fetchIndex(function () {});
    headerInput.removeEventListener('focus', onFirstFocus);
  });

})();
