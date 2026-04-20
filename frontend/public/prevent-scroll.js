// Prevent Safari from scrolling page when focusing inputs
// This is necessary because Safari ignores CSS overflow/position rules
// when bringing focused inputs into view

(function() {
  let scrollTop = 0;
  let isKeyboardOpen = false;

  // Save scroll position before focus
  document.addEventListener('focusin', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      isKeyboardOpen = true;
    }
  }, true);

  // Prevent scroll by constantly resetting position
  function preventScroll() {
    if (isKeyboardOpen) {
      window.scrollTo(0, scrollTop);
      document.documentElement.scrollTop = scrollTop;
      document.body.scrollTop = scrollTop;
    }
  }

  // Run continuously while keyboard might be open
  setInterval(preventScroll, 10);

  // Also listen for scroll events and block them
  let isScrolling = false;
  window.addEventListener('scroll', function(e) {
    if (isKeyboardOpen && !isScrolling) {
      isScrolling = true;
      window.scrollTo(0, scrollTop);
      document.documentElement.scrollTop = scrollTop;
      document.body.scrollTop = scrollTop;
      setTimeout(() => isScrolling = false, 10);
    }
  }, { passive: false });

  // Clean up when input loses focus
  document.addEventListener('focusout', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      setTimeout(() => isKeyboardOpen = false, 300);
    }
  }, true);

  // Prevent visual viewport changes from scrolling
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', preventScroll);
    window.visualViewport.addEventListener('scroll', preventScroll);
  }
})();
