
/* ===== Slide viewer  -  one slide at a time + nav + TOC + PDF export ===== */
(function () {
  const stage = document.getElementById('slideStage');
  if (!stage) return;

  // Gather all slide-block divs that are direct children of the viewer section
  const viewer = document.getElementById('deck');
  const slideBlocks = Array.from(viewer.querySelectorAll(':scope > .slide-block'));
  const total = slideBlocks.length;
  if (total === 0) return;

  // Move them into the stage and assign indices
  let suppressScroll = true;  // skip scrollIntoView on the first show() so the page lands at top
  slideBlocks.forEach((block, i) => {
    block.dataset.idx = i;
    stage.appendChild(block);
  });

  // Build a friendly TOC label from each slide's content
  function getTitle(block) {
    // Prefer .slide-title, then .slide-num, then first h1/h2/h3
    const t = block.querySelector('.slide-title');
    if (t) return t.textContent.trim().replace(/\s+/g, ' ').slice(0, 70);
    const n = block.querySelector('.slide-num');
    if (n) return n.textContent.trim();
    return 'Slide ' + (idx + 1);
  }

  // TOC builder
  const tocEl = document.getElementById('slideToc');
  slideBlocks.forEach((block, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slide-toc-btn';
    btn.innerHTML = '<span class="n">' + (i + 1).toString().padStart(2, '0') + '</span>' + getTitle(block);
    btn.addEventListener('click', () => goTo(i));
    tocEl.appendChild(btn);
  });

  let current = 0;
  function show(i) {
    if (i < 0) i = 0;
    if (i >= total) i = total - 1;
    slideBlocks.forEach((b, j) => {
      b.classList.toggle('active', j === i);
    });
    current = i;
    document.getElementById('counterNow').textContent = i + 1;
    document.getElementById('counterTotal').textContent = total;
    document.getElementById('progressFill').style.width = (((i + 1) / total) * 100).toFixed(1) + '%';
    document.getElementById('btnPrev').disabled = (i === 0);
    document.getElementById('btnNext').disabled = (i === total - 1);
    // Update TOC highlight
    Array.from(tocEl.children).forEach((btn, j) => {
      btn.classList.toggle('current', j === i);
    });
    // Scroll the stage into view smoothly (skip on first init so the page lands at top)
    if (suppressScroll) return;
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function goTo(i) { show(i); }
  function next() { if (current < total - 1) show(current + 1); }
  function prev() { if (current > 0) show(current - 1); }

  document.getElementById('btnNext').addEventListener('click', next);
  document.getElementById('btnPrev').addEventListener('click', prev);

  // Fullscreen mode for distraction-free reading
  const fsLabel = document.getElementById('fsLabel');
  let fsShell = null;
  function toggleFullscreen() {
    if (document.body.classList.contains('fs-locked')) {
      // Exit fullscreen
      if (fsShell) {
        viewer.appendChild(stage);
        viewer.appendChild(document.querySelector('.slide-nav'));
        fsShell.remove();
        fsShell = null;
      }
      document.body.classList.remove('fs-locked');
      if (fsLabel) fsLabel.textContent = 'Fullscreen';
    } else {
      // Enter fullscreen
      fsShell = document.createElement('div');
      fsShell.className = 'fullscreen-shell';
      const header = document.createElement('div');
      header.className = 'fs-header';
      header.innerHTML = '<div>Panorama &middot; AIO/GEO/AEO Proposal</div><div class="esc-hint">Press Esc or F to exit</div>';
      fsShell.appendChild(header);
      fsShell.appendChild(stage);
      const nav = document.querySelector('.slide-nav');
      fsShell.appendChild(nav);
      document.body.appendChild(fsShell);
      document.body.classList.add('fs-locked');
      if (fsLabel) fsLabel.textContent = 'Exit';
    }
  }
  document.getElementById('btnFullscreen').addEventListener('click', toggleFullscreen);

  // Keyboard nav
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === 'Escape' && document.body.classList.contains('fs-locked')) { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(total - 1); }
  });

  // TOC toggle
  const tocPanel = document.getElementById('slide-toc-panel');
  const tocToggle = document.getElementById('tocToggle');
  tocToggle.addEventListener('click', () => {
    const open = tocPanel.classList.toggle('open');
    tocToggle.textContent = open ? '⌄ Hide table of contents' : '⌃ Show table of contents';
    if (open) tocPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ===== Download PDF (one slide per page) =====
  document.getElementById('btnDownload').addEventListener('click', async () => {
    const btn = document.getElementById('btnDownload');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>⟳</span><span>Generating...</span>';

    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // We snapshot every slide, even hidden ones, by temporarily making each active.
      const savedCurrent = current;
      for (let i = 0; i < total; i++) {
        show(i);
        // Wait one paint for the DOM to settle
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const slideEl = slideBlocks[i].querySelector('.slide') || slideBlocks[i];
        const canvas = await html2canvas(slideEl, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        // Fit image to page preserving aspect
        const imgRatio = canvas.width / canvas.height;
        const pageRatio = pageW / pageH;
        let w, h;
        if (imgRatio > pageRatio) {
          w = pageW;
          h = w / imgRatio;
        } else {
          h = pageH;
          w = h * imgRatio;
        }
        const x = (pageW - w) / 2;
        const y = (pageH - h) / 2;
        pdf.addImage(imgData, 'JPEG', x, y, w, h, undefined, 'FAST');
        btn.innerHTML = '<span>⟳</span><span>Rendering ' + (i + 1) + '/' + total + '...</span>';
      }
      pdf.save('Panorama-AIO-GEO-AEO-Proposal.pdf');
      // Restore the previously active slide
      show(savedCurrent);
    } catch (err) {
      alert('PDF generation failed: ' + err.message);
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });

  // Initialize (without scroll), then arm the scroll for subsequent user actions
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  show(0);
  suppressScroll = false;
})();
