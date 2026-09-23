/* Deliverance Railroad Union — a train runs the bottom of the page on load.
 *
 * Each vehicle is a separately filmed green-screen clip, keyed to transparency
 * (VP9 alpha .webm, HEVC alpha .mp4 for Safari). The clips animate ON THE SPOT
 * like a treadmill; the horizontal travel is CSS, so speed is ours to set.
 *
 * Two numbers per clip earn their keep:
 *   rel   - real-world size relative to the locomotive. keyclip normalises every
 *           clip to the same pixel width, which would make a flatcar as big as a
 *           locomotive. This scales each back to its true size.
 *   railY - the row where the wheels meet the rail, measured from the clip's own
 *           top. NOT the bottom of the sprite: a cowcatcher hangs below the
 *           wheels, so aligning sprite bottoms would sink the engine.
 */
(function () {
  'use strict';

  /* rel     true size relative to the locomotive, from real 1899 dimensions
   *         (loco+tender ~14ft tall; coaches ~13ft; freight ~12ft; a loaded
   *         flatcar ~9ft). Without this every car comes out engine-sized.
   * railY   the row where wheels meet rail, measured from the clip's top.
   * filter  optional tone match. Veo drifted warm on the passenger coach;
   *         cheaper to correct in CSS than to re-roll a good clip. */
  var CLIPS = {
    loco:      { w: 900, h: 282, railY: 275, rel: 1.007 },
    flatbed:   { w: 900, h: 230, railY: 213, rel: 0.78 },
    passenger: { w: 900, h: 324, railY: 306, rel: 0.81, filter: 'saturate(.52) brightness(.86)' },
    boxcar:    { w: 900, h: 356, railY: 339, rel: 0.69, filter: 'brightness(.72)' },
    prisoner:  { w: 900, h: 342, railY: 325, rel: 0.71, filter: 'brightness(.91)' },
    army:      { w: 900, h: 350, railY: 332, rel: 0.69, filter: 'brightness(.70)' },
    stock:     { w: 900, h: 338, railY: 320, rel: 0.75, filter: 'brightness(.85)' }
  };

  // Cars that may be coupled behind the engine.
  var CARS = ['flatbed', 'passenger', 'boxcar', 'prisoner', 'army', 'stock'];

  var LOCO_H_DESKTOP = 118;
  var LOCO_H_MOBILE  = 74;
  var COUPLER_OVERLAP = 3;     // px the cars tuck into each other at the coupler
  var FIRST_RUN_DELAY = 1400;  // let the page settle before the whistle
  var GAP_MIN = 45000, GAP_VAR = 40000;

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function locoHeight() {
    return window.innerWidth < 760 ? LOCO_H_MOBILE : LOCO_H_DESKTOP;
  }

  /** A <video> sized to true scale and seated on the rail line. */
  function vehicle(key, K) {
    var c = CLIPS[key];
    if (!c) return null;

    var dispH = c.h * c.rel * K;
    var dispW = c.w * c.rel * K;
    var railD = c.railY * (dispH / c.h);   // rail line inside this sprite
    var hang  = dispH - railD;             // how far it hangs below the rail

    var v = document.createElement('video');
    v.className = 'rr-car';
    v.muted = true; v.loop = true; v.autoplay = true;
    v.playsInline = true; v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.preload = 'auto';
    v.width = Math.round(dispW); v.height = Math.round(dispH);

    // webm first; Safari has no VP9 alpha and takes the HEVC mp4.
    ['webm', 'mp4'].forEach(function (ext) {
      var s = document.createElement('source');
      s.src = 'assets/trains/' + key + '.' + ext;
      s.type = ext === 'webm' ? 'video/webm' : 'video/mp4; codecs="hvc1"';
      v.appendChild(s);
    });

    v.style.width = Math.round(dispW) + 'px';
    v.style.height = Math.round(dispH) + 'px';
    v.style.marginBottom = (-Math.round(hang)) + 'px';   // seat it on the rail
    v.style.marginRight = (-COUPLER_OVERLAP) + 'px';     // butt at the coupler
    if (c.filter) v.style.filter = c.filter + ' drop-shadow(0 6px 10px rgba(0,0,0,.55))';
    return v;
  }

  function runTrain() {
    if (document.hidden) return schedule(8000);

    // Anchor the scale on the engine's true size, not on its frame. The
    // re-filmed locomotive is framed tighter than the first one, so its box is
    // taller for the same engine; folding rel in here keeps every car sized
    // exactly as it was.
    var K = locoHeight() / (CLIPS.loco.h * CLIPS.loco.rel);
    var train = document.createElement('div');
    train.className = 'rr-train';

    // Cars trail behind, so they come first in the DOM; the engine faces right
    // and therefore leads.
    var howMany = 1 + Math.floor(Math.random() * 3);
    var pool = CARS.slice();
    for (var i = 0; i < howMany && pool.length; i++) {
      var key = pool[Math.floor(Math.random() * pool.length)];
      var car = vehicle(key, K);
      if (car) train.appendChild(car);
    }
    var engine = vehicle('loco', K);
    if (!engine) return;
    train.appendChild(engine);

    var host = document.getElementById('rrTrackbed');
    host.appendChild(train);

    // Measure once it is laid out, then drive it across.
    requestAnimationFrame(function () {
      var width = train.offsetWidth || 600;
      var travel = window.innerWidth + width + 80;
      var speed = window.innerWidth < 760 ? 105 : 135;   // px per second
      var secs = travel / speed;

      train.style.setProperty('--rr-from', (-width - 40) + 'px');
      train.style.setProperty('--rr-to', (window.innerWidth + 40) + 'px');
      train.style.animation = 'rr-roll ' + secs.toFixed(1) + 's linear forwards';

      train.addEventListener('animationend', function () {
        train.remove();
        schedule(GAP_MIN + Math.random() * GAP_VAR);
      });
    });
  }

  var timer = null;
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(runTrain, ms);
  }

  function start() {
    if (reduced()) return;                       // no motion for those who asked
    if (document.getElementById('rrTrackbed')) return;
    var bed = document.createElement('div');
    bed.id = 'rrTrackbed';
    bed.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bed);
    schedule(FIRST_RUN_DELAY);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
