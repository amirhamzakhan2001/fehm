(() => {
  document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => {
    const block = button.closest('.code-block');
    try {
      await navigator.clipboard.writeText(block.querySelector('code').textContent);
      block.querySelector('.copy-status').textContent = 'Copied to clipboard.';
      button.textContent = 'Copied';
    } catch {
      block.querySelector('.copy-status').textContent = 'Copy unavailable. Select the code and copy it manually.';
    }
  }));
  const id = document.querySelector('meta[name="fehm-ga-id"]').content;
  const page = document.querySelector('meta[name="fehm-page-url"]').content;
  const panel = document.getElementById('consent');
  const settings = document.getElementById('privacy-preferences');
  const key = 'fehm-analytics-consent-v1';
  let consent = 'unset';
  let loaded = false;
  try { consent = localStorage.getItem(key) || 'unset'; } catch { /* browsing still works without storage */ }
  function enable() {
    if (!id || consent !== 'granted') return;
    if (loaded) { window[`ga-disable-${id}`] = false; return; }
    loaded = true;
    window[`ga-disable-${id}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    window.gtag('js',new Date());
    window.gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:page,page_referrer:''});
    window.gtag('event','page_view',{page_location:page,page_title:document.title,page_referrer:''});
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
  }
  function choose(value) {
    consent = value;
    let persisted = false;
    try { localStorage.setItem(key,value); persisted = true; } catch { /* preference applies for this page */ }
    panel.hidden = true;
    if(value === 'granted') enable();
    else if(loaded) {
      window[`ga-disable-${id}`] = true;
      // Reload removes the tag and listeners after persisting the denied choice.
      if (persisted) window.location.reload();
    }
  }
  document.querySelectorAll('[data-consent]').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.consent)));
  if (settings) settings.hidden = !id;
  settings?.addEventListener('click',()=>{
    panel.hidden = false;
    document.getElementById('analytics-status').textContent = id ? `Current choice: ${consent}.` : 'Analytics is not configured. No Google Analytics script is loaded.';
    panel.querySelector('button').focus();
  });
  document.querySelectorAll('[data-event]').forEach(anchor=>anchor.addEventListener('click',()=>{
    if(consent==='granted' && loaded && ['docs_click','install_guide_click'].includes(anchor.dataset.event)) {
      window.gtag('event',anchor.dataset.event,{page_location:page,page_referrer:''});
    }
  }));
  if(id && consent==='unset') panel.hidden = false;
  enable();
})();
