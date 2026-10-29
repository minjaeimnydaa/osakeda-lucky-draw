import { $, esc, api, toast, formatDate, download } from './shared.js';
const slug = new URLSearchParams(location.search).get('event') || 'lucky-days';
let event; let result; let busy = false; let storyBlob; let storyUrl; let loadVersion = 0;
const codeDialog = $('#code-dialog'); const resultDialog = $('#result-dialog');
const machine = $('#machine'); const travel = $('#claw-travel');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const tickets = [[12,211,13],[67,204,27],[214,211,-19],[-28,265,-20],[40,280,18],[201,276,-16],[278,250,28],[102,298,-10],[126,245,-10]];
$('#cards').innerHTML = tickets.map(([x,y,angle],i) => `<g class="machine-ticket" data-card="${i+1}" transform="translate(${x} ${y}) rotate(${angle} 57 32)"><use href="#lucky-ticket"/></g>`).join('');
let idleMotion; let drawMotions = [];
function updateMachine() {
  if (busy) return;
  machine.classList.toggle('is-complete', !!result);
  machine.classList.remove('is-lifting');
  document.querySelectorAll('.machine-ticket').forEach(t => t.classList.toggle('is-picked', !!result && +t.dataset.card === result.card));
  const canMove = !result && event?.status === 'active' && !event.soldOut && !reducedMotion.matches;
  if (!canMove) { idleMotion?.cancel(); idleMotion = null; }
  else if (!idleMotion) idleMotion = travel.animate([{ transform:'translateX(-110px)' }, { transform:'translateX(110px)' }], { duration:2600, direction:'alternate', iterations:Infinity, easing:'ease-in-out' });
}
reducedMotion.addEventListener('change', updateMachine);
async function move(element, frames, duration) {
  const motion = element.animate(frames, { duration:reducedMotion.matches ? 0 : duration, fill:'forwards', easing:'cubic-bezier(.4,0,.2,1)' });
  drawMotions.push(motion); await motion.finished;
}
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
async function load(committedResult = null) {
  const version = ++loadVersion;
  const fresh = await api('event', undefined, slug);
  if (version !== loadVersion) return;
  event = fresh; result = committedResult || event.result;
  document.title = `${event.title} · 오사케다`;
  $('#event-title').textContent = event.title;
  document.querySelector('[aria-label="오사케다 이벤트 홈"]').href = `/?event=${encodeURIComponent(slug)}`;
  $('#subtitle').textContent = event.subtitle;
  $('#period').textContent = `${formatDate(event.start)} — ${formatDate(new Date(Date.parse(event.end) - 1))}`;
  $('#test-banner').hidden = !event.test;
  $('#prizes').innerHTML = event.prizes.map(p => `<article class="prize-item"><span class="rank quiet-tag">${p.rank}등</span><div class="prize-symbol" aria-hidden="true"><img src="/osakeda-logo.avif" alt="" width="200" height="70"><span>GIFT CARD</span></div><div class="prize-copy"><h3>${esc(p.name)}</h3><p class="prize-value">${esc(p.detail)}</p></div><span class="quantity">${p.total}명</span></article>`).join('');
  $('#delivery-notice').textContent = event.delivery || '경품 발급 일정은 이벤트 공개 시 안내됩니다.';
  $('#privacy-notice').textContent = event.privacy || '개인정보 수집 안내가 준비 중입니다.';
  $('#claim-privacy').textContent = event.privacy || '개인정보 수집 안내가 준비 중입니다.';
  $('#contact-notice').hidden = !event.contact; $('#contact-notice').textContent = `문의: ${event.contact}`;
  updateBoard();
}
function updateBoard() {
  const active = event.status === 'active' && !event.soldOut;
  const states = { draft:'이벤트 준비 중', paused:'잠시 쉬어가고 있어요', upcoming:'곧 행운이 찾아옵니다', ended:'이벤트가 마감되었어요' };
  $('#event-status').textContent = event.status === 'active' ? event.soldOut ? '경품 소진' : '진행 중' : ({draft:'준비 중', paused:'일시 중지', upcoming:'오픈 예정', ended:'종료'})[event.status] || '준비 중';
  $('#event-status').classList.toggle('inactive', !active);
  machine.setAttribute('aria-busy', String(busy));
  const stage = result ? 2 : event.identified ? 1 : 0;
  ['step-code','step-pick','step-result'].forEach((id,i) => { const step = $(`#${id}`); step.classList.toggle('completed', i < stage); if (i === stage) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current'); });
  $('#day-pill').textContent = event.status === 'active' ? `${Math.min(event.day, event.days)}일차 / ${event.days}일간의 행운` : (states[event.status] || '이벤트 준비 중');
  $('#change-code').hidden = !event.identified;
  $('#change-code').disabled = busy;
  const button = $('#enter-button'); button.disabled = busy;
  if (result) { button.textContent = '나의 결과 확인하기'; $('#board-hint').textContent = result.prize ? '축하해요! 당첨된 선물을 확인해 주세요.' : '오늘의 도전 완료! 결과를 다시 확인할 수 있어요.'; $('#board-status').textContent = '참여 완료'; }
  else if (!active) { button.disabled = event.identified; button.textContent = event.identified ? event.soldOut ? '준비된 경품이 모두 소진되었어요' : states[event.status] : '참여 내역 확인하기'; $('#board-hint').textContent = event.status === 'upcoming' ? `${formatDate(event.start)}부터 참여할 수 있어요.` : '기존 코드를 입력하면 당첨 결과를 확인할 수 있어요.'; $('#board-status').textContent = '신규 추첨 대기 · 결과 조회 가능'; }
  else if (!event.identified) { button.textContent = '참여 코드 입력하기'; $('#board-hint').textContent = '구매 후 받은 코드로 참여할 수 있어요.'; $('#board-status').textContent = '코드 확인 전'; }
  else { button.textContent = '지금 뽑기'; $('#board-hint').textContent = '원하는 순간에 아래 버튼을 눌러주세요.'; $('#board-status').textContent = '오늘의 행운이 기다려요'; }
  if (busy) { button.disabled = true; button.textContent = '행운을 뽑고 있어요…'; $('#board-status').textContent = '두근두근, 추첨 중'; }
  $('.draw-note').textContent = result?.prize ? '당첨 내역은 같은 코드로 다시 확인할 수 있어요.' : event.status === 'ended' || event.soldOut ? '신규 참여가 마감되었어요. 함께해 주셔서 감사합니다.' : '매일 오전 0시, 새로운 참여 기회가 열려요.';
  updateMachine();
}
$('#enter-button').addEventListener('click', () => { if (busy) return; if (!event) { location.reload(); return; } if (result) showResult(); else if (event.identified && event.status === 'active' && !event.soldOut) pick(); else codeDialog.showModal(); });
$('#change-code').addEventListener('click', () => { if (!busy) codeDialog.showModal(); });
$('#code-form').addEventListener('submit', async e => {
  e.preventDefault(); if (busy) return; ++loadVersion; const button = e.submitter; button.disabled = true; $('#code-error').textContent = '';
  try { await api('enter', { code:$('#code-input').value }, slug); await load(); codeDialog.close(); $('#code-input').value = ''; if (result) showResult(); else { toast('코드 확인 완료! 이제 행운을 뽑아보세요.'); $('#enter-button').focus({ preventScroll:true }); } }
  catch (err) { $('#code-error').textContent = err.message; } finally { button.disabled = false; }
});
async function pick() {
  if (busy || result || !event?.identified || event.status !== 'active' || event.soldOut) return;
  const x = new DOMMatrix(getComputedStyle(travel).transform).m41;
  const card = Math.max(1, Math.min(9, Math.floor((x+110)/220*9)+1));
  busy = true; ++loadVersion; updateBoard(); idleMotion?.cancel(); idleMotion = null;
  const box = machine.getBoundingClientRect();
  if (box.top < 16 || box.bottom > innerHeight-16) machine.scrollIntoView({ block:'center', behavior:reducedMotion.matches ? 'instant' : 'smooth' });
  // Start the server request immediately; never assign a prize to a visible ticket.
  let committedResult;
  const request = api('draw', { card }, slug).then(answer => { committedResult = answer; return { answer }; }, error => ({ error }));
  $('#board-hint').textContent = '집게가 당신의 행운을 만나러 가요.';
  try {
    await move(travel, [{ transform:`translateX(${x}px)` }], 0);
    await Promise.all([
      move($('#claw-drop'), [{ transform:'translateY(0)' }, { transform:'translateY(90px)' }], 800),
      move($('#claw-cable'), [{ transform:'scaleY(1)' }, { transform:'scaleY(2.40625)' }], 800)
    ]);
    const { answer, error } = await request;
    if (error) throw error;
    // A second tab may have drawn first; follow the server's saved ticket index.
    const target = Math.max(-110, Math.min(110, tickets[answer.card-1][0]+57-180));
    await move(travel, [{ transform:`translateX(${x}px)` }, { transform:`translateX(${target}px)` }], 220);
    machine.classList.add('is-lifting');
    document.querySelector(`[data-card="${answer.card}"]`).classList.add('is-picked');
    $('#board-hint').textContent = '뽑았어요! 이제 결과를 확인해 볼까요?';
    await move($('#claw-drop'), [{ transform:'translateY(90px)' }], 240);
    await Promise.all([
      move($('#claw-drop'), [{ transform:'translateY(90px)' }, { transform:'translateY(0)' }], 850),
      move($('#claw-cable'), [{ transform:'scaleY(2.40625)' }, { transform:'scaleY(1)' }], 850)
    ]);
    await move(travel, [{ transform:`translateX(${target}px)` }, { transform:'translateX(0)' }], 350);
    result = answer;
    try { await load(answer); } catch { /* The committed result remains available if refreshing fails. */ }
    showResult();
  } catch (err) {
    // Even if motion stops, settle the request before allowing another attempt.
    await request;
    if (committedResult) {
      result = committedResult;
      try { await load(committedResult); } catch {}
      showResult();
    } else {
      toast(err.message);
      try { await load(); if (result) showResult(); } catch {}
    }
  } finally {
    drawMotions.forEach(m => m.cancel()); drawMotions = [];
    busy = false; updateBoard();
  }
}
function showResult() {
  if (!result) return;
  const win = !!result.prize;
  $('#result-icon').textContent = win ? '✓' : '↗';
  $('#result-eyebrow').textContent = win ? 'A LITTLE LUCK FOUND YOU' : 'THANK YOU FOR PLAYING';
  $('#result-title').textContent = win ? `${result.prize.rank}등 당첨! 행운이 찾아왔어요.` : `꽝(${result.day}일차)`;
  const last = event.day >= event.days || event.status === 'ended';
  $('#result-description').textContent = win ? event.delivery || '기프트카드를 받을 이메일을 남겨주세요.' : last ? '함께해 주셔서 고마워요. 다음 이벤트에서 다시 만나요.' : '오늘은 조금 아쉽지만, 내일 또 다른 행운이 기다려요. 한국 시간 오전 0시 이후 다시 도전해 주세요.';
  $('#result-prize').hidden = !win; $('#result-prize').textContent = win ? `${result.prize.name} ${result.prize.detail}` : '';
  $('#claim-form').hidden = !win || result.claimed;
  $('#claim-success').hidden = !win || !result.claimed;
  $('#claim-success').textContent = result.fulfilled ? `${result.email} 주소로 경품 발급이 완료되었어요.` : `${result.email || ''}\n수령 이메일이 등록되었어요. 안내된 일정에 따라 발급해 드릴게요.`;
  $('#claim-error').textContent = '';
  if (!resultDialog.open) resultDialog.showModal();
}
$('#claim-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; $('#claim-error').textContent = '';
  try { await api('claim', { email:$('#email').value, consent:$('#consent').checked }, slug); await load(); $('#email').value = ''; $('#consent').checked = false; showResult(); }
  catch (err) { $('#claim-error').textContent = err.message; } finally { button.disabled = false; }
});
function shareUrl() { const url = new URL('/', location.origin); url.searchParams.set('event', slug); return url.href; }
async function copy() {
  try { await navigator.clipboard.writeText(shareUrl()); toast('이벤트 링크를 복사했어요.'); }
  catch { toast(`이 주소를 복사해 주세요: ${shareUrl()}`); }
}
async function share() {
  const data = { title: event?.title || '오사케다 럭키 드로우', text:'매일 한 번, 당신의 행운을 뽑아보세요. 구매 고객 전용 이벤트', url:shareUrl() };
  if (navigator.share) { try { await navigator.share(data); } catch (err) { if (err.name !== 'AbortError') await copy(); } } else await copy();
}
async function saveStory(withResult = false) {
  if (!event) return;
  const logo = document.querySelector('.wordmark img');
  await Promise.all([logo.decode(), document.fonts.ready]);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0,0,1080,1920);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(70,70,940,1780,54); ctx.fill();
  ctx.drawImage(logo,380,106,320,112);
  ctx.textAlign = 'center'; ctx.font = '700 24px "Malgun Gothic",sans-serif'; ctx.fillStyle = '#6b7684'; ctx.fillText('오사케다 럭키 드로우',540,280);
  ctx.font = 'bold 65px "Malgun Gothic",sans-serif'; ctx.fillStyle = '#191f28';
  const headline = withResult && result ? result.prize ? `${result.prize.rank}등 당첨!` : '오늘의 도전 완료!' : '당신의 행운을 뽑아보세요';
  ctx.fillText(headline,540,490,920);
  ctx.fillStyle = '#f2f6fc'; ctx.beginPath(); ctx.roundRect(230,650,620,650,42); ctx.fill();
  ctx.save(); ctx.translate(444,718); ctx.scale(4,4);
  ctx.fillStyle = '#354b38'; ctx.fill(new Path2D('M18 8h12v22c0 6 9 9 9 19v42c0 3-2 5-5 5H14c-3 0-5-2-5-5V49c0-10 9-13 9-19Z'));
  ctx.fillStyle = '#c7b58a'; ctx.fillRect(17,3,14,9); ctx.fillStyle = '#f5efdd'; ctx.fillRect(13,51,22,32);
  ctx.strokeStyle = '#d5c8a7'; ctx.lineWidth = .5; ctx.strokeRect(16,54,16,26);
  ctx.fillStyle = '#344536'; ctx.font = '15px "Batang",serif'; ctx.fillText('酒',24,72);
  ctx.fillStyle = '#a44c3b'; ctx.fillRect(27,75,4,4); ctx.restore();
  ctx.fillStyle = '#1b64da'; ctx.font = 'bold 23px "Malgun Gothic",sans-serif'; ctx.fillText('하루 한 번, 기프트카드에 도전해요',540,1215);
  ctx.fillStyle = '#191f28'; ctx.font = 'bold 33px "Malgun Gothic",sans-serif';
  const message = withResult && result?.prize ? `${result.prize.name} ${result.prize.detail}` : event.title;
  ctx.fillText(message,540,1440,880); ctx.font = '27px "Malgun Gothic",sans-serif'; ctx.fillStyle = '#6b7684'; ctx.fillText(`${formatDate(event.start)} — ${formatDate(new Date(Date.parse(event.end) - 1))}`,540,1510);
  ctx.font = '26px "Malgun Gothic",sans-serif'; ctx.fillText('구매 고객 전용 · 하루 한 번 참여',540,1640);
  if (event.test) { ctx.fillStyle = '#ad453b'; ctx.fillText('테스트 이미지 · 실제 경품 지급 없음',540,1720); }
  ctx.fillStyle = '#777d71'; ctx.font = '22px Arial'; ctx.fillText(new URL(shareUrl()).host,540,1830,950);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) return toast('이미지를 만들지 못했어요. 다시 시도해 주세요.');
  storyBlob = blob;
  if (storyUrl) URL.revokeObjectURL(storyUrl);
  storyUrl = URL.createObjectURL(blob); $('#story-preview').src = storyUrl;
  $('#story-preview').alt = `${headline} · ${message} · 오사케다 이벤트 공유 이미지`;
  $('#story-dialog').showModal();
}
$('#share').addEventListener('click', share); $('#result-share').addEventListener('click', share); $('#copy-link').addEventListener('click', copy);
$('#save-story').addEventListener('click', () => saveStory().catch(() => toast('이미지를 만들지 못했어요. 다시 시도해 주세요.'))); $('#result-story').addEventListener('click', () => saveStory(true).catch(() => toast('이미지를 만들지 못했어요. 다시 시도해 주세요.')));
$('#download-story').addEventListener('click', () => { if (storyBlob) download(storyBlob, 'osakeda-lucky-story.png'); });
load().catch(err => { $('#period').textContent = '잠시 후 다시 방문해 주세요'; $('#enter-button').textContent = '다시 불러오기'; $('#enter-button').disabled = false; $('#board-hint').textContent = err.message; });
// Refresh participation status after midnight, tab restoration, or returning from Instagram.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && !document.querySelector('dialog[open]')) load().catch(() => {}); });
setInterval(() => { if (event && !busy && !document.hidden && !document.querySelector('dialog[open]')) load().catch(() => {}); }, 60000);
