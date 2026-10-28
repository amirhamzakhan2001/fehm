import type { PublishedView } from '../../../architecture/types.js';

/** Export full validated geometry, independent of camera, zoom hiding, filters and page CSS. */
export function exportDiagram(svg: SVGSVGElement, published: PublishedView): void {
  if (!published.layout) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('id');
  clone.classList.remove('z-low', 'z-min', 'panning');
  clone.querySelectorAll('.dim,.sel,.hl').forEach(e => e.classList.remove('dim', 'sel', 'hl'));
  clone.querySelectorAll<SVGElement>('[data-filtered]').forEach(e => { e.style.removeProperty('display'); e.removeAttribute('data-filtered'); });
  clone.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none';
  document.body.append(clone);
  try {
    for (const element of [clone, ...clone.querySelectorAll('*')]) {
      const computed = getComputedStyle(element);
      for (const key of ['fill','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','font-family','font-size','font-weight','opacity','display','text-anchor','dominant-baseline','paint-order']) (element as SVGElement).style.setProperty(key, computed.getPropertyValue(key));
      element.removeAttribute('tabindex');
    }
    const box = published.layout.viewBox;
    const width = Math.max(800, box.width), header = 90;
    clone.setAttribute('viewBox', `${box.x} ${box.y-header} ${width} ${box.height+header}`);
    clone.setAttribute('width', String(width)); clone.setAttribute('height', String(box.height+header));
    for (const key of ['position','left','top','pointer-events']) clone.style.removeProperty(key);
    const ns = svg.namespaceURI;
    const background = document.createElementNS(ns, 'rect');
    for (const [key,value] of Object.entries({x:box.x,y:box.y-header,width,height:box.height+header,fill:'#090c12'})) background.setAttribute(key,String(value));
    clone.prepend(background);
    const title = document.createElementNS(ns,'title'); title.textContent = published.title;
    const description = document.createElementNS(ns,'desc'); description.textContent = published.notes.join(' ');
    clone.prepend(title, description);
    for (const [offset,text,size] of [[28,published.title,20],[51,`${published.nodes.length} elements · ${published.relationships.length} relationships · source-derived architecture`,12],[72,'Arrows: relationship direction · dashed edges: inferred, unknown or return · shapes: labeled element types',11]] as const) {
      const line = document.createElementNS(ns,'text');
      line.setAttribute('x',String(box.x+16)); line.setAttribute('y',String(box.y-header+offset));
      line.setAttribute('fill','#d6dce8'); line.setAttribute('font-family','system-ui,sans-serif'); line.setAttribute('font-size',String(size));
      line.textContent=text; clone.append(line);
    }
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type:'image/svg+xml'}));
    const link = document.createElement('a'); link.href=url; link.download=`architecture-${published.view}.svg`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } finally { clone.remove(); }
}
