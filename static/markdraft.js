(function () {
  'use strict';

  var app = document.getElementById('markdraft-app');
  var contentUrl = app.getAttribute('data-content-url');
  var refreshUrl = app.getAttribute('data-refresh-url');
  var idCounter = 0;

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  // --- Configure marked ---

  // Load emoji map and register marked-emoji extension.
  // Returns a promise that resolves when emoji is ready (or immediately
  // if unavailable). Rendering waits for this.
  var emojiReady;
  (function () {
    function registerEmoji(gemoji) {
      var emojis = {};
      Object.keys(gemoji).forEach(function (emoji) {
        (gemoji[emoji].names || []).forEach(function (name) {
          emojis[name] = emoji;
        });
      });
      var opts = {
        emojis: emojis,
        renderer: function (token) { return token.emoji; }
      };
      var fn = markedEmoji.markedEmoji || markedEmoji.default || markedEmoji;
      marked.use(fn(opts));
    }

    if (typeof markedEmoji === 'undefined') {
      emojiReady = Promise.resolve();
      return;
    }
    var embeddedGemoji = document.getElementById('markdraft-gemoji');
    if (embeddedGemoji) {
      try { registerEmoji(JSON.parse(embeddedGemoji.textContent)); }
      catch (e) { /* skip */ }
      emojiReady = Promise.resolve();
    } else {
      var staticUrl = app.getAttribute('data-content-url')
        .replace(/\/api\/content.*/, '/static');
      emojiReady = fetch(staticUrl + '/gemoji.json')
        .then(function (r) { return r.json(); })
        .then(registerEmoji)
        .catch(function () { /* emoji map unavailable, skip */ });
    }
  })();

  // Register marked-katex-extension for $inline$ and $$display$$ math.
  if (typeof markedKatex !== 'undefined') {
    marked.use(markedKatex.default
      ? markedKatex.default({ throwOnError: false })
      : markedKatex({ throwOnError: false }));
  }

  // Register marked-alert for GitHub-style alerts.
  if (typeof markedAlert !== 'undefined') {
    marked.use(markedAlert.markedAlert
      ? markedAlert.markedAlert()
      : markedAlert());
  }

  // Custom renderer for special code blocks and syntax highlighting.
  // marked v15+ passes a single object {text, lang, escaped} to code().
  marked.use({
    renderer: {
      code: function (args) {
        var code = typeof args === 'string' ? args : args.text;
        var language = typeof args === 'string' ? arguments[1] : args.lang;

        if (language === 'mermaid') {
          return '<pre class="mermaid">' + escapeHtml(code) + '</pre>';
        }
        if (language === 'geojson' || language === 'topojson') {
          var mapId = 'markdraft-map-' + (idCounter++);
          return '<div id="' + mapId + '" class="markdraft-map" data-geojson="' +
            escapeHtml(code) + '"></div>';
        }
        if (language === 'stl') {
          var stlId = 'markdraft-stl-' + (idCounter++);
          return '<div id="' + stlId + '" class="markdraft-stl" data-stl="' +
            escapeHtml(code) + '"></div>';
        }

        // Syntax highlighting
        var highlighted = code;
        if (language && typeof hljs !== 'undefined' && hljs.getLanguage(language)) {
          try { highlighted = hljs.highlight(code, { language: language }).value; }
          catch (e) { /* fall through */ }
        } else if (typeof hljs !== 'undefined') {
          try { highlighted = hljs.highlightAuto(code).value; }
          catch (e) { /* fall through */ }
        } else {
          highlighted = escapeHtml(code);
        }

        if (language) {
          return '<pre><code class="hljs language-' + escapeHtml(language) + '">' + highlighted + '</code></pre>';
        }
        return '<pre><code class="hljs">' + highlighted + '</code></pre>';
      }
    }
  });

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function unescapeHtml(s) {
    return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  }

  // --- Post-render: GeoJSON maps ---

  function initGeoJSON() {
    if (typeof L === 'undefined') return;
    var maps = document.querySelectorAll('.markdraft-map');
    maps.forEach(function (el) {
      if (el.dataset.initialized) return;
      el.dataset.initialized = 'true';
      try {
        var data = JSON.parse(unescapeHtml(el.getAttribute('data-geojson')));
        var map = L.map(el.id).setView([0, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(map);
        var layer = L.geoJSON(data).addTo(map);
        map.fitBounds(layer.getBounds().pad(0.1));
      } catch (e) {
        el.innerHTML = '<p style="color:red">GeoJSON error: ' + escapeHtml(String(e)) + '</p>';
      }
    });
  }

  // --- Post-render: STL 3D models ---

  function initSTL() {
    if (typeof THREE === 'undefined') return;
    var viewers = document.querySelectorAll('.markdraft-stl');
    viewers.forEach(function (el) {
      if (el.dataset.initialized) return;
      el.dataset.initialized = 'true';
      try {
        var stlText = unescapeHtml(el.getAttribute('data-stl'));
        var width = el.clientWidth || 600;
        var height = 400;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(currentTheme() === 'dark' ? 0x1a1a2e : 0xf0f0f0);
        var camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        var rendererGL = new THREE.WebGLRenderer({ antialias: true });
        rendererGL.setSize(width, height);
        el.appendChild(rendererGL.domElement);

        // Parse ASCII STL
        var geometry = parseSTL(stlText);
        var material = new THREE.MeshPhongMaterial({
          color: 0x3498db, specular: 0x111111, shininess: 200
        });
        var mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Center and scale
        geometry.computeBoundingBox();
        var box = geometry.boundingBox;
        var center = new THREE.Vector3();
        box.getCenter(center);
        mesh.position.sub(center);
        var size = new THREE.Vector3();
        box.getSize(size);
        var maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(0, 0, maxDim * 2);

        // Lighting
        scene.add(new THREE.AmbientLight(0x404040));
        var light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(1, 1, 1);
        scene.add(light);

        // Simple rotation animation
        function animate() {
          requestAnimationFrame(animate);
          mesh.rotation.y += 0.005;
          rendererGL.render(scene, camera);
        }
        animate();
      } catch (e) {
        el.innerHTML = '<p style="color:red">STL error: ' + escapeHtml(String(e)) + '</p>';
      }
    });
  }

  function parseSTL(text) {
    // Simple ASCII STL parser
    var geometry = new THREE.BufferGeometry();
    var vertices = [];
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.startsWith('vertex')) {
        var parts = line.split(/\s+/);
        vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  // --- Core ---

  function buildBreadcrumb(fullPath) {
    var parts = fullPath.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length === 0) return '<a href="/">/</a>';
    var crumbs = ['<a href="/">/</a>'];
    var accumulated = '';
    for (var i = 0; i < parts.length; i++) {
      accumulated += parts[i] + '/';
      crumbs.push('<a href="/' + escapeHtml(accumulated) + '">'
        + escapeHtml(parts[i]) + '</a>');
    }
    return crumbs.join(' &rsaquo; ');
  }

  function buildSiblingNav(parentPath, entries, currentFile) {
    if (!entries || entries.length === 0) return '';
    var html = '<details class="markdraft-nav"><summary>Files</summary>';
    html += '<ul class="markdraft-listing">';
    entries.forEach(function (entry) {
      var href, label;
      var isCurrent = false;
      if (entry.type === 'directory') {
        href = '/' + parentPath + entry.name + '/';
        label = entry.name + '/';
      } else {
        href = '/' + parentPath + entry.name;
        label = entry.name;
        if (currentFile && (parentPath + entry.name) === currentFile) {
          isCurrent = true;
        }
      }
      var cls = isCurrent ? ' class="current"' : '';
      var icon = entry.type === 'directory' ? '\uD83D\uDCC1 ' : '\uD83D\uDCC4 ';
      html += '<li' + cls + '>' + icon + '<a href="' + escapeHtml(href)
        + '">' + escapeHtml(label) + '</a></li>';
    });
    html += '</ul></details>';
    return html;
  }

  function renderMarkdown(text) {
    idCounter = 0;
    var html = marked.parse(text);
    document.getElementById('markdraft-content').innerHTML = html;
    initMermaid();
    initGeoJSON();
    initSTL();
  }

  function renderListing(data) {
    var path = data.path || '';
    var nav = document.getElementById('markdraft-nav');
    if (nav) nav.innerHTML = '<div class="markdraft-breadcrumb">'
      + buildBreadcrumb(path) + '</div>';

    var html = '<ul class="markdraft-listing">';
    if (path && path !== '/') {
      var parent = path.replace(/[^\/]+\/$/, '');
      html += '<li>\uD83D\uDCC1 <a href="/' + escapeHtml(parent) + '">..</a></li>';
    }
    data.entries.forEach(function (entry) {
      var href;
      if (entry.type === 'directory') {
        href = '/' + path + entry.name + '/';
        html += '<li>\uD83D\uDCC1 <a href="' + escapeHtml(href) + '">'
          + escapeHtml(entry.name + '/') + '</a></li>';
      } else {
        href = '/' + path + entry.name;
        html += '<li>\uD83D\uDCC4 <a href="' + escapeHtml(href) + '">'
          + escapeHtml(entry.name) + '</a></li>';
      }
    });
    html += '</ul>';
    document.getElementById('markdraft-content').innerHTML = html;
  }

  function renderFile(data) {
    var nav = document.getElementById('markdraft-nav');
    if (nav) {
      var breadcrumb = buildBreadcrumb(data.path || data.filename || '');
      var siblings = buildSiblingNav(
        data.parent || '', data.siblings || [], data.path || '');
      nav.innerHTML = '<div class="markdraft-breadcrumb">' + breadcrumb
        + '</div>' + siblings;
    }
    renderMarkdown(data.text);
  }

  function renderContent(data) {
    if (data.type === 'listing') {
      renderListing(data);
    } else {
      renderFile(data);
    }
  }

  function fetchAndRender() {
    if (!contentUrl) return;
    // Wait for both content and emoji map before rendering
    Promise.all([
      fetch(contentUrl).then(function (r) { return r.json(); }),
      emojiReady
    ])
      .then(function (results) {
        renderContent(results[0]);
      })
      .catch(function (err) {
        document.getElementById('markdraft-content').innerHTML =
          '<p style="color:red">Error loading content: ' + escapeHtml(String(err)) + '</p>';
      });
  }

  function initMermaid() {
    if (typeof mermaid !== 'undefined') {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: currentTheme() === 'dark' ? 'dark' : 'default'
        });
        mermaid.run({ querySelector: '.mermaid' });
      } catch (e) {
        // mermaid may not be loaded yet
      }
    }
  }

  function autorefresh(url) {
    var initialTitle = document.title;
    var source = new EventSource(url);
    var isRendering = false;

    source.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.updated) {
        isRendering = true;
        document.title = '(Rendering) ' + initialTitle;
        fetchAndRender();
        setTimeout(function () {
          isRendering = false;
          document.title = initialTitle;
        }, 200);
      }
    };

    source.onerror = function () {
      if (isRendering) {
        isRendering = false;
        document.title = initialTitle;
      }
    };
  }

  function scrollToHash() {
    if (location.hash && !document.querySelector(':target')) {
      var id = location.hash.slice(1);
      var el = document.getElementById(id) ||
               document.getElementById('user-content-' + id);
      if (el) el.scrollIntoView();
    }
  }

  // Boot
  var embedded = document.getElementById('markdraft-source');
  if (embedded) {
    renderMarkdown(embedded.textContent);
  } else {
    fetchAndRender();
  }

  if (refreshUrl) {
    autorefresh(refreshUrl);
  }

  window.onhashchange = scrollToHash;
  window.onload = scrollToHash;
})();
