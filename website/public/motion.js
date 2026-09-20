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
