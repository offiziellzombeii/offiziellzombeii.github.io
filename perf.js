// =====================================================================
//  perf.js – performance overlay for every page of the site
//  Add ?perf=1 to the address of a page: a small box at the bottom left
//  shows the frame rate, the time per frame, the worst frame, long tasks
//  (> 50 ms, the browser could not react), memory and the size of the page.
//  While it is on, the links to the other pages keep ?perf=1.
//  A page with its own, more detailed overlay (Race Control) sets
//  <body data-own-perf="1">: then only the links are changed.
// =====================================================================
(function () {
  if (!/[?&]perf=1(&|$)/.test(location.search)) return;

  // keep ?perf=1 on the links to the other pages of the site
  function keepPerfOnLinks() {
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (!href || /^(https?:|mailto:|#|javascript:)/i.test(href) || /[?&]perf=1/.test(href)) continue;
      if (!/\.html(#.*)?$/i.test(href)) continue;
      const hash = href.indexOf("#");
      a.setAttribute("href", hash >= 0 ? href.slice(0, hash) + "?perf=1" + href.slice(hash) : href + "?perf=1");
    }
  }

  function start() {
    keepPerfOnLinks();
    if (document.body.dataset.ownPerf) return;

    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;padding:4px 9px;border-radius:6px;" +
      "background:rgba(0,0,0,0.82);color:#9ef0b0;font:600 11px/1.4 Inter,Arial,sans-serif;" +
      "font-variant-numeric:tabular-nums;pointer-events:none;white-space:nowrap";
    box.textContent = "perf …";
    document.body.appendChild(box);

    let frames = 0;
    let sum = 0;
    let worst = 0;
    let last = performance.now();
    let since = last;
    let longTasks = 0;
    let longTime = 0;

    // long tasks: the main thread was busy for more than 50 ms
    if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          longTasks++;
          longTime += e.duration;
        }
      }).observe({ type: "longtask", buffered: false });
    }

    function frame(now) {
      const dt = now - last;
      last = now;
      frames++;
      sum += dt;
      worst = Math.max(worst, dt);
      if (now - since >= 1000) {
        const heap = performance.memory ? " · JS " + Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB" : "";
        box.textContent = Math.round(frames * 1000 / (now - since)) + " fps · frame " + (sum / frames).toFixed(1) + " ms · worst " +
          Math.round(worst) + " ms · long tasks " + longTasks + (longTasks ? " (" + Math.round(longTime) + " ms)" : "") +
          heap + " · " + document.getElementsByTagName("*").length + " elements";
        window.lastPerf = { fps: frames * 1000 / (now - since), frame: sum / frames, worst, longTasks, longTime };
        frames = 0;
        sum = 0;
        worst = 0;
        longTasks = 0;
        longTime = 0;
        since = now;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
