document.addEventListener('DOMContentLoaded', function() {
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('mobileMenu');

  window.addEventListener('scroll', function() {
    if (window.scrollY > 10) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  });

  toggle.addEventListener('click', function() {
    menu.classList.toggle('open');
  });

  var menuLinks = menu.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < menuLinks.length; i++) {
    menuLinks[i].addEventListener('click', function() {
      menu.classList.remove('open');
    });
  }
});
