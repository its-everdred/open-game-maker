/* Pack art lives in assets-local/ (gitignored, host only). When it is missing, swap in a placeholder of the same size. */
(function () {
  var SIZES = {"blobs.jpg": [800, 450], "dusk.jpg": [800, 600], "land-bg.jpg": [1280, 720], "play-bg.jpg": [390, 780], "thumb-16.jpg": [240, 240], "thumb-41.jpg": [240, 240], "town-phone.jpg": [780, 1688], "goblin.jpg": [960, 463], "spr-goblin.png": [160, 160], "spr-cave-goblin.png": [160, 160], "spr-skeleton.png": [160, 160], "spr-boss.png": [160, 160], "spr-hero.png": [160, 160], "spr-archer.png": [160, 160], "spr-wizard.png": [160, 160]};
  function swap(img) {
    var name = (img.getAttribute('src') || '').split('/').pop();
    var s = SIZES[name];
    if (!s || img.dataset.fallback) return;
    img.dataset.fallback = name;
    img.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + s[0] + '" height="' + s[1] + '" viewBox="0 0 ' + s[0] + ' ' + s[1] + '">' +
      '<rect width="100%" height="100%" fill="#2a2734"/><path d="M0 0L' + s[0] + ' ' + s[1] + 'M' + s[0] + ' 0L0 ' + s[1] + '" stroke="#3d3948" stroke-width="2"/></svg>');
  }
  window.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') swap(e.target); }, true);
  Array.prototype.forEach.call(document.images, function (img) { if (img.complete && img.naturalWidth === 0) swap(img); });
})();
