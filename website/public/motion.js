(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Progressive enhancement: content remains visible if observers are unavailable.
  if (!reduced.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    document.querySelectorAll('[data-reveal]').forEach(element => {
      element.classList.add('reveal-ready');
      observer.observe(element);
    });
    reduced.addEventListener('change',event=>{
      if(event.matches) {
        document.querySelectorAll('.reveal-ready').forEach(element=>element.classList.add('revealed'));
        observer.disconnect();
      }
    });
  }
  // The brand glyph separates and reassembles gently as its edges are traced.
  // Only render on scroll/resize; no perpetual animation loop.
  const orbit = document.querySelector?.('.art-mark');
  if (orbit) {
    let frame = 0;
    const paintOrbit = () => {
      frame = 0;
      if (reduced.matches) {
        orbit.removeAttribute('style');
        return;
      }
      const phase = Math.max(0, window.scrollY) / Math.max(1, window.innerHeight * 2.4) * Math.PI * 2;
      const separation = (1 - Math.cos(phase)) / 2;
      orbit.style.setProperty('--piece-x', `${separation * -7}px`);
      orbit.style.setProperty('--piece-y', `${separation * -5}px`);
      orbit.style.setProperty('--trace-offset', `${-phase * 24}`);
      [[40, 24, 1], [37, 29, -.8], [43, 34, .65]].forEach(([rx, ry, speed], index) => {
        const angle = phase * speed + index * Math.PI * 2 / 3;
        orbit.style.setProperty(`--particle-${index + 1}-x`, `${Math.cos(angle) * rx}px`);
        orbit.style.setProperty(`--particle-${index + 1}-y`, `${Math.sin(angle) * ry}px`);
      });
    };
    const scheduleOrbit = () => {
      if (!frame) frame = requestAnimationFrame(paintOrbit);
    };
    window.addEventListener('scroll', scheduleOrbit, { passive: true });
    window.addEventListener('resize', scheduleOrbit);
    reduced.addEventListener('change', scheduleOrbit);
    paintOrbit();
  }
  document.addEventListener('visibilitychange',()=>document.body.classList.toggle('page-hidden',document.hidden));
  const input=document.getElementById('docs-search');
  input?.addEventListener('input',()=>{
    const query=input.value.trim().toLocaleLowerCase();
    let count=0;
    document.querySelectorAll('[data-search]').forEach(card=>{
      const matches=card.dataset.search.toLocaleLowerCase().includes(query);
      card.hidden=!matches;
      if(matches)count++;
    });
    document.getElementById('search-status').textContent=query?`${count} ${count===1?'guide':'guides'} found.`:'';
  });
})();
